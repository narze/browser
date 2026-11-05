const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  Menu,
  clipboard,
  dialog,
  session,
  nativeTheme,
  protocol,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { resolveAddress } = require("./navigation.cjs");
const { isWebUrl, isTabId, canOpenPopup } = require("./policy.cjs");
const { createSettingsStore } = require("./settings.cjs");
const { createTabStore } = require("./tab-store.cjs");
const { readLimited } = require("./read-limited.cjs");
const { durationMs } = require("../shared/settings.js");
const {
  shortcutActions,
  acceleratorFromKey,
  normalizeAccelerator,
  resolveShortcuts,
  shortcutLookup,
} = require("../shared/shortcuts.js");
const { createBrowserSession } = require("./browser-session.cjs");
const { normalizePageLayout } = require("./page-layout.cjs");
const {
  browserCommands,
  browserEvents,
  canInvokeCommand,
  validateCommandHandlers,
  paletteCommands,
} = require("../shared/commands.js");

// Prototype: today tabs are in memory; spaces, favorites, pinned tabs, folders,
// routes, and the archive persist in tabs.json. Remote pages never receive the
// chrome preload. Each space browses in its own session partition.
let settingsStore;
let tabStore;
let faviconDirectory;
// Sleeping tabs keep their back/forward list here, outside the session state.
const sleepingHistory = new Map();
let clockOffset = 0;
const now = () => Date.now() + clockOffset;
const newSession = () => createBrowserSession({ now, saved: tabStore?.get() });
let settings;
let window;
let browserSession;
const views = new Map();
// The profile each page view was created with. A view cannot change its partition.
const viewProfiles = new Map();
let paletteView;
let pageRegions = [];
let commandHandlers;
let shortcuts = new Map();
// While the chrome records a new shortcut, keys reach it instead of running actions.
let shortcutRecording = false;
// Compact mode: whether the chrome shows its toolbar and tabs, and the last edge
// state sent to it (null makes the next page pointer move report again).
let chromeRevealed = false;
let pointerAtEdge = false;

const sessionState = () => browserSession.getState();
const activeTab = () => sessionState().tabs.find((tab) => tab.id === sessionState().activeId);
const activeView = () => views.get(sessionState().activeId);

function getState() {
  const { pages: _pages, ...state } = sessionState();
  return {
    ...state,
    resolvedTheme: nativeTheme.shouldUseDarkColors ? "dark" : "light",
    tabLayout: settings.tabLayout,
    settings,
    platform: process.platform,
    tabs: state.tabs.map((tab) => ({
      ...tab,
      canGoBack: !!views.get(tab.id)?.webContents.navigationHistory.canGoBack(),
      canGoForward: !!views.get(tab.id)?.webContents.navigationHistory.canGoForward(),
    })),
  };
}

const partition = (profile) => `persist:${profile}`;
const configuredProfiles = new Set();
// Every space profile denies permission prompts, like the original browsing profile.
function browsingSession(profile) {
  const browsing = session.fromPartition(partition(profile));
  if (!configuredProfiles.has(profile)) {
    configuredProfiles.add(profile);
    browsing.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browsing.setPermissionCheckHandler(() => false);
  }
  return browsing;
}
const profileOf = (state, tab) => state.spaces.find((space) => space.id === tab.spaceId).profile;

// Session transitions are pure; this adapter owns all native view side effects.
function dispatch(command) {
  const result = browserSession.dispatch(command);
  // A tab moved to a space with another profile gets a new view in that profile.
  const moved = [];
  for (const [id, view] of views) {
    const tab = result.state.tabs.find((entry) => entry.id === id);
    if (!tab || tab.asleep || viewProfiles.get(id) === profileOf(result.state, tab)) continue;
    views.delete(id);
    viewProfiles.delete(id);
    window.contentView.removeChildView(view);
    view.webContents.close({ waitForBeforeUnload: false });
    if (tab.url) moved.push(tab);
  }
  for (const tab of result.state.tabs) {
    if (!tab.asleep && !views.has(tab.id)) {
      const profile = profileOf(result.state, tab);
      const view = createPageView(tab.id, profile);
      views.set(tab.id, view);
      viewProfiles.set(tab.id, profile);
      window.contentView.addChildView(view);
    }
  }
  for (const [id, view] of views) {
    const tab = result.state.tabs.find((entry) => entry.id === id);
    if (tab && !tab.asleep) continue;
    views.delete(id);
    viewProfiles.delete(id);
    window.contentView.removeChildView(view);
    const navigation = view.webContents.navigationHistory;
    if (tab)
      sleepingHistory.set(id, {
        entries: navigation.getAllEntries(),
        index: navigation.getActiveIndex(),
      });
    view.webContents.close({ waitForBeforeUnload: false });
  }
  for (const id of sleepingHistory.keys())
    if (!result.state.tabs.some((tab) => tab.id === id)) sleepingHistory.delete(id);
  try {
    tabStore.save(browserSession.exportOrganization());
  } catch (error) {
    console.error("Could not save tabs:", error);
  }
  if (!result.state.palette && paletteView?.getVisible()) {
    paletteView.setVisible(false);
    window.contentView.removeChildView(paletteView);
  }
  layout();
  publish();
  for (const tab of moved)
    void views
      .get(tab.id)
      .webContents.loadURL(tab.url)
      .catch(() => {});
  for (const effect of result.effects) {
    if (effect.type === "load") {
      const contents = views.get(effect.id).webContents;
      if (!effect.url) contents.stop();
      // did-fail-load owns visible errors, including redirects.
      void contents.loadURL(effect.url || "about:blank").catch(() => {});
    } else if (effect.type === "wake") wake(effect.id, effect.url);
    else if (effect.type === "edit") edit(effect);
    else if (effect.type === "clear-profile") clearProfile(effect.profile);
    else if (effect.type === "focus") focusActive();
  }
  return result;
}

// Restore the back/forward list when the tab still shows the page it slept on.
function wake(id, url) {
  const contents = views.get(id)?.webContents;
  if (!contents) return;
  const saved = sleepingHistory.get(id);
  sleepingHistory.delete(id);
  if (saved?.entries[saved.index]?.url === url)
    void contents.navigationHistory.restore(saved).catch(() => contents.loadURL(url));
  else void contents.loadURL(url || "about:blank").catch(() => {});
}

// A deleted space takes its cookies, logins, and cache with it.
function clearProfile(profile) {
  const browsing = browsingSession(profile);
  void Promise.all([browsing.clearStorageData(), browsing.clearCache()]).catch((error) =>
    console.error("Could not clear the space profile:", error),
  );
}

function edit(target) {
  if (!window || window.isDestroyed()) return;
  window.webContents.focus();
  window.webContents.send(browserEvents.onEdit, { kind: target.kind, id: target.id });
}

const FAVICON_TYPES = {
  "image/png": "png",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/svg+xml": "svg",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
const FAVICON_NAME = /^[a-f0-9]{32}\.(png|ico|svg|jpg|gif|webp)$/;
const faviconCache = new Map();

// Icons are fetched with the browsing session and served to the chrome from disk,
// so favorites keep their icons after a restart without loading the page.
async function cacheFavicon(url, profile) {
  if (faviconCache.has(url)) return faviconCache.get(url);
  const key = crypto.createHash("sha256").update(url).digest("hex").slice(0, 32);
  try {
    const response = url.startsWith("data:")
      ? await fetch(url)
      : await browsingSession(profile).fetch(url);
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    // Servers often send .ico files without an image type, but never accept text or HTML.
    const untyped = !type || type === "application/octet-stream";
    const extension = FAVICON_TYPES[type] ?? (untyped && /\.ico(\?|$)/i.test(url) ? "ico" : null);
    if (!response.ok || !extension) {
      await response.body?.cancel();
      return null;
    }
    const bytes = await readLimited(response, 256 * 1024);
    if (!bytes?.length) return null;
    const name = `${key}.${extension}`;
    fs.mkdirSync(faviconDirectory, { recursive: true });
    fs.writeFileSync(path.join(faviconDirectory, name), bytes);
    faviconCache.set(url, name);
    return name;
  } catch {
    return null;
  }
}

function serveFavicon(request) {
  const name = new URL(request.url).pathname.slice(1);
  if (!FAVICON_NAME.test(name)) return new Response(null, { status: 404 });
  try {
    const bytes = fs.readFileSync(path.join(faviconDirectory, name));
    const type = Object.keys(FAVICON_TYPES).find((key) => name.endsWith("." + FAVICON_TYPES[key]));
    return new Response(bytes, {
      headers: { "content-type": type, "cache-control": "max-age=31536000, immutable" },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

function focusActive() {
  const state = sessionState();
  const tab = activeTab();
  const screenOpen = state.settingsOpen || state.archiveOpen;
  if (!screenOpen && tab?.url && !tab.error) activeView().webContents.focus();
  else {
    window.webContents.focus();
    if (!screenOpen) window.webContents.send(browserEvents.onFocusAddress);
  }
}

function publish() {
  if (window && !window.isDestroyed()) window.webContents.send(browserEvents.onState, getState());
  if (paletteView && !paletteView.webContents.isDestroyed())
    paletteView.webContents.send(browserEvents.onState, getState());
}

function layout() {
  if (!window || window.isDestroyed()) return;
  const state = sessionState();
  const [width, height] = window.getContentSize();
  if (paletteView && state.palette) paletteView.setBounds({ x: 0, y: 0, width, height });
  const ids =
    state.split && !state.settingsOpen && !state.archiveOpen
      ? state.split.tabIds
      : [state.activeId];
  const currentLayout = pageRegions.map((region) => region.id).join() === ids.join();
  const regions = normalizePageLayout(pageRegions, width, height);
  for (const page of state.pages) {
    const view = views.get(page.id);
    const region = currentLayout ? regions.find((entry) => entry.id === page.id) : undefined;
    if (region?.bounds.width > 0 && region.bounds.height > 0) {
      view.setBounds(region.bounds);
      view.setVisible(page.visible);
    } else view.setVisible(false);
  }
}

// The palette is a trusted local view above the page views, never a website preload.
function openPalette(mode = "commands") {
  if (!window || !["navigate", "commands"].includes(mode)) return;
  dispatch({ type: "open-palette", mode });
  if (!paletteView) {
    paletteView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, "../dist/preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    paletteView.setBackgroundColor("#00000000");
    paletteView.webContents.on("will-navigate", (event) => event.preventDefault());
    paletteView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    paletteView.webContents.on("before-input-event", shortcutKey);
    paletteView.webContents.on("did-finish-load", () => {
      publish();
      if (sessionState().palette) paletteView.webContents.focus();
    });
    paletteView.webContents.on("render-process-gone", () => {
      closePalette();
      paletteView.webContents.close({ waitForBeforeUnload: false });
      paletteView = null;
    });
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) void paletteView.webContents.loadURL(new URL("#palette", devUrl).href);
    else
      void paletteView.webContents.loadFile(path.join(__dirname, "../dist/index.html"), {
        hash: "palette",
      });
  }
  window.contentView.addChildView(paletteView);
  paletteView.setVisible(true);
  layout();
  publish();
  paletteView.webContents.focus();
}

function closePalette(restoreFocus = true) {
  if (!sessionState().palette) return;
  dispatch({ type: "close-palette" });
  if (restoreFocus) focusActive();
}

// Browser shortcuts run before the page sees the key, so websites cannot take them.
// Page-priority shortcuts are left to the menu, which runs only for unhandled keys.
function shortcutKey(event, input) {
  if (input.type !== "keyDown" || shortcutRecording) return;
  const accelerator = acceleratorFromKey(
    {
      key: input.key,
      code: input.code,
      ctrl: input.control,
      meta: input.meta,
      alt: input.alt,
      shift: input.shift,
    },
    process.platform,
  );
  const id = accelerator && shortcuts.get(accelerator);
  if (!id || shortcutActions.find((action) => action.id === id).pagePriority) return;
  event.preventDefault();
  runShortcut(id);
}

function runPaletteCommand(id) {
  const command = paletteCommands(getState()).find((entry) => entry.id === id);
  if (command) commandHandlers[command.command](...command.args);
}

function runShortcut(id) {
  if (id === "newTab") {
    if (!window) createWindow();
    else newTab();
    return;
  }
  if (!window || window.isDestroyed()) return;
  const state = sessionState();
  const position = /^selectTab([1-8])$/.exec(id);
  if (position) return dispatch({ type: "select-position", position: Number(position[1]) });
  switch (id) {
    case "closeTab":
      if (state.palette) closePalette();
      else if (state.settingsOpen) showSettings(false);
      else if (state.archiveOpen) dispatch({ type: "show-archive", open: false });
      else closeTab(state.activeId);
      break;
    case "reopenClosedTab": {
      const entry = state.archive.find((item) => item.reason === "closed");
      if (entry) dispatch({ type: "restore-archived", id: entry.id });
      break;
    }
    case "openAddress":
      return openPalette("navigate");
    case "commandPalette":
      return openPalette("commands");
    case "reload":
      return reload();
    case "back":
    case "forward":
      return history(id);
    case "copyUrl":
      if (activeTab()?.url) clipboard.writeText(activeTab().url);
      break;
    case "nextTab":
    case "nextTabAlternate":
      return cycleTab(1);
    case "previousTab":
    case "previousTabAlternate":
      return cycleTab(-1);
    case "selectLastTab":
      return dispatch({ type: "select-position", position: 9 });
    case "togglePin":
      return runPaletteCommand("pin-tab");
    case "toggleFavorite":
      return runPaletteCommand("favorite-tab");
    case "newFolder":
      return runPaletteCommand("new-folder");
    case "toggleSplit":
      return toggleSplit();
    case "toggleSidebar":
      return toggleSidebar();
    case "nextSpace":
    case "previousSpace":
      return dispatch({ type: "cycle-space", direction: id === "nextSpace" ? 1 : -1 });
    case "newSpace":
      return dispatch({ type: "create-space" });
    case "toggleCompactMode":
      return toggleCompactMode();
    case "settings":
      return showSettings(true);
    case "archive":
      return dispatch({ type: "show-archive", open: true });
    case "devTools":
      return (activeTab()?.url ? activeView().webContents : window.webContents).toggleDevTools();
  }
}

function setShortcutRecording(recording) {
  if (shortcutRecording === recording) return;
  shortcutRecording = recording;
  installMenu();
}

// Menus show the current shortcuts. Their accelerators also cover keys that reach
// no web contents, and page-priority shortcuts that the page did not handle.
function installMenu() {
  shortcuts = shortcutLookup(settings.shortcuts, process.platform);
  const keys = resolveShortcuts(settings.shortcuts);
  const item = (id) => {
    const action = shortcutActions.find((entry) => entry.id === id);
    const accelerator = shortcutRecording ? null : normalizeAccelerator(keys[id], process.platform);
    return {
      label: id === "settings" ? "Settings…" : action.label,
      click: () => runShortcut(id),
      ...(accelerator ? { accelerator } : {}),
    };
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      {
        label: "File",
        submenu: [
          item("newTab"),
          item("closeTab"),
          item("reopenClosedTab"),
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          item("settings"),
          item("archive"),
          item("openAddress"),
          item("commandPalette"),
          item("reload"),
          item("back"),
          item("forward"),
          item("copyUrl"),
          item("toggleSplit"),
          item("toggleSidebar"),
          item("toggleCompactMode"),
          { type: "separator" },
          { role: "togglefullscreen" },
          item("devTools"),
        ],
      },
      {
        label: "Tab",
        submenu: [
          item("nextTab"),
          item("previousTab"),
          item("nextTabAlternate"),
          item("previousTabAlternate"),
          { type: "separator" },
          ...[1, 2, 3, 4, 5, 6, 7, 8].map((position) => item(`selectTab${position}`)),
          item("selectLastTab"),
          { type: "separator" },
          item("togglePin"),
          item("toggleFavorite"),
          item("newFolder"),
        ],
      },
      {
        label: "Spaces",
        submenu: [item("nextSpace"), item("previousSpace"), item("newSpace")],
      },
      { role: "windowMenu" },
    ]),
  );
}

function executePalette(action) {
  if (!sessionState().palette || !action || typeof action !== "object")
    return { error: "Open the command palette first." };
  try {
    if (action.type === "navigate") {
      if (
        typeof action.input !== "string" ||
        action.input.length > 16_384 ||
        !action.input.trim() ||
        typeof action.newTab !== "boolean"
      )
        throw new Error("Enter a valid address or search.");
      const url = resolveAddress(action.input, settings.searchEngine);
      closePalette(false);
      if (action.newTab) newTab(url);
      else {
        const tab = activeTab();
        load(tab, url);
        activeView().webContents.focus();
      }
    } else if (action.type === "tab") {
      if (!isTabId(action.id) || !sessionState().tabs.some((tab) => tab.id === action.id))
        throw new Error("That tab is no longer open.");
      selectTab(action.id);
    } else if (action.type === "command") {
      const command = paletteCommands(getState()).find((entry) => entry.id === action.id);
      if (!command) throw new Error("Unknown command.");
      if (command.command === "updateSettings") {
        const result = commandHandlers[command.command](...command.args);
        if (result.error) return result;
        closePalette();
      } else {
        closePalette();
        commandHandlers[command.command](...command.args);
      }
    } else throw new Error("Unknown palette action.");
    return {};
  } catch (error) {
    return { error: error.message };
  }
}

function selectTab(id) {
  dispatch({ type: "select-tab", id });
}

function load(tab, url) {
  dispatch({ type: "navigate", id: tab.id, url });
}

function newTab(url = "", spaceId) {
  return dispatch({ type: "new-tab", url, spaceId }).state.activeId;
}

function createPageView(id, profile) {
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      session: browsingSession(profile),
    },
  });
  const contents = view.webContents;
  const tab = () => sessionState().tabs.find((entry) => entry.id === id);
  // A sleeping or closed tab's page can still report events while it shuts down.
  const update = (patch) => {
    if (views.get(id) === view) dispatch({ type: "update-tab", id, patch });
  };
  contents.on("focus", () => {
    const state = sessionState();
    if (
      state.split?.tabIds.includes(id) &&
      !state.settingsOpen &&
      !state.splitResizing &&
      !state.sidebarResizing &&
      !state.palette &&
      state.activeId !== id
    )
      dispatch({ type: "focus-tab", id });
  });
  let lastPopupAt = -Infinity;
  contents.on("did-start-loading", () => {
    if (tab()?.url) update({ loading: true });
  });
  contents.on("did-stop-loading", () => update({ loading: false }));
  contents.on("page-title-updated", (_event, title) => {
    if (tab()?.url) update({ title: title || new URL(tab().url).hostname });
  });
  const navigated = (_event, url) => {
    if (isWebUrl(url)) update({ url, error: null });
  };
  contents.on("did-navigate", navigated);
  contents.on("page-favicon-updated", async (_event, favicons) => {
    const source = favicons.find((url) => isWebUrl(url) || url.startsWith("data:image/"));
    const name = source ? await cacheFavicon(source, profile) : null;
    if (name && tab()?.favicon !== name) update({ favicon: name });
  });
  contents.on("did-navigate-in-page", (event, url, isMainFrame) => {
    if (isMainFrame) navigated(event, url);
  });
  contents.on("did-fail-load", (_event, code, description, failedUrl, isMainFrame) => {
    if (isMainFrame && code !== -3 && tab()?.url)
      update({ loading: false, error: `Could not open ${failedUrl || tab().url}. ${description}` });
  });
  contents.on("render-process-gone", () =>
    update({ loading: false, error: "This tab stopped responding. Reload to try again." }),
  );
  for (const event of ["will-navigate", "will-redirect"]) {
    contents.on(event, (event, targetUrl) => {
      if (!isWebUrl(targetUrl)) event.preventDefault();
    });
  }
  contents.setWindowOpenHandler(({ url }) => {
    const now = performance.now();
    if (isWebUrl(url) && canOpenPopup(lastPopupAt, now)) {
      lastPopupAt = now;
      // A popup opens in its opener's space, with its login, unless a route says otherwise.
      newTab(url, tab()?.spaceId);
    }
    return { action: "deny" };
  });
  contents.on("before-input-event", shortcutKey);
  contents.on("input-event", (_event, input) => pagePointer(view, input));
  contents.on("before-input-event", (_event, input) => {
    if (input.type === "keyDown" && input.key === "Escape" && tab()?.loading) contents.stop();
  });
  return view;
}

function closeTab(id) {
  dispatch({ type: "close-tab", id });
}

function toggleSplit() {
  dispatch({ type: "toggle-split" });
}

function cycleTab(direction) {
  return dispatch({ type: "cycle-tab", direction }).state.activeId;
}

function reload() {
  const tab = activeTab();
  if (!tab?.url) return;
  if (tab.error) load(tab, tab.url);
  else activeView().webContents.reload();
}

function history(direction) {
  const navigation = activeView()?.webContents.navigationHistory;
  if (direction === "back" && navigation?.canGoBack()) navigation.goBack();
  if (direction === "forward" && navigation?.canGoForward()) navigation.goForward();
}

function showSettings(open) {
  if (!open) setShortcutRecording(false);
  dispatch({ type: "show-settings", open });
}

function updateTheme() {
  if (window && !window.isDestroyed())
    window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#121722" : "#f5f7fa");
  publish();
}

function updateSettings(patch) {
  try {
    // Moving tabs to a side should never land on a hidden, empty sidebar.
    if (
      patch?.tabLayout &&
      patch.tabLayout !== settings.tabLayout &&
      !Object.hasOwn(patch, "sidebarVisible")
    )
      patch = { ...patch, sidebarVisible: true };
    settings = settingsStore.update(patch);
    nativeTheme.themeSource = settings.theme;
    updateWindowButtons();
    if ("shortcuts" in patch) installMenu();
    updateTheme();
    layout();
    publish();
    return {};
  } catch {
    return { error: "Could not save these settings. Please try again." };
  }
}

function moveTab(id, zone, folderId = null, index = Number.MAX_SAFE_INTEGER) {
  dispatch({ type: "move-tab", id, zone, folderId, index });
}

// Native menus draw above the page views, so they work in every tab layout.
function showTabMenu(id) {
  const state = sessionState();
  const tab = state.tabs.find((entry) => entry.id === id);
  if (!window || !tab) return;
  const shown = state.split ? state.split.tabIds : [state.activeId];
  const template = [{ label: "Rename tab…", click: () => edit({ kind: "tab", id }) }];
  const otherSpaces = state.spaces.filter((space) => space.id !== tab.spaceId);
  if (tab.url) {
    template.push(
      tab.zone === "favorites"
        ? { label: "Remove from favorites", click: () => moveTab(id, "today", null, 0) }
        : { label: "Add to favorites", click: () => moveTab(id, "favorites") },
      tab.zone === "pinned"
        ? { label: "Unpin tab", click: () => moveTab(id, "today", null, 0) }
        : { label: "Pin tab", click: () => moveTab(id, "pinned") },
      {
        label: "Move to folder",
        submenu: [
          ...state.folders.map((folder) => ({
            label: folder.name,
            type: "checkbox",
            checked: tab.folderId === folder.id,
            click: () => moveTab(id, "pinned", folder.id),
          })),
          ...(state.folders.length ? [{ type: "separator" }] : []),
          { label: "New folder…", click: () => dispatch({ type: "create-folder", tabId: id }) },
        ],
      },
    );
    if (otherSpaces.length)
      template.push({
        label: "Move to space",
        submenu: otherSpaces.map((space) => ({
          label: space.name,
          click: () => dispatch({ type: "move-tab-to-space", id, spaceId: space.id }),
        })),
      });
  }
  if (tab.homeUrl && tab.url !== tab.homeUrl)
    template.push({
      label: "Back to pinned page",
      click: () => dispatch({ type: "reset-tab", id }),
    });
  template.push(
    { type: "separator" },
    {
      label: "Put tab to sleep",
      enabled: !!tab.url && !tab.asleep && !shown.includes(id),
      click: () => dispatch({ type: "sleep-tab", id }),
    },
    { label: "Close tab", click: () => closeTab(id) },
  );
  Menu.buildFromTemplate(template).popup({ window });
}

function showFolderMenu(id) {
  if (!window || !sessionState().folders.some((folder) => folder.id === id)) return;
  Menu.buildFromTemplate([
    { label: "Rename folder…", click: () => edit({ kind: "folder", id }) },
    {
      label: "Delete folder",
      toolTip: "Its tabs stay pinned.",
      click: () => dispatch({ type: "delete-folder", id }),
    },
  ]).popup({ window });
}

const SPACE_COLOR_LABELS = {
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  teal: "Teal",
  gray: "Gray",
};

function showSpaceMenu(id) {
  const state = sessionState();
  const space = state.spaces.find((entry) => entry.id === id);
  if (!window || !space) return;
  Menu.buildFromTemplate([
    { label: "Rename space…", click: () => edit({ kind: "space", id }) },
    {
      label: "Color",
      submenu: Object.entries(SPACE_COLOR_LABELS).map(([color, label]) => ({
        label,
        type: "radio",
        checked: space.color === color,
        click: () => dispatch({ type: "set-space-color", id, color }),
      })),
    },
    { type: "separator" },
    {
      label: "Delete space…",
      enabled: state.spaces.length > 1,
      click: () => confirmDeleteSpace(id),
    },
  ]).popup({ window });
}

// Deleting a space closes its tabs and erases its logins, so ask first.
function confirmDeleteSpace(id) {
  const space = sessionState().spaces.find((entry) => entry.id === id);
  if (!window || !space) return;
  const answer = dialog.showMessageBoxSync(window, {
    type: "warning",
    buttons: ["Delete space", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: `Delete the space “${space.name}”?`,
    detail: "Its tabs close and go to the archive. Its cookies, logins, and site data are deleted.",
  });
  if (answer === 0) dispatch({ type: "delete-space", id });
}

function tick() {
  if (!window || window.isDestroyed()) return;
  const audible = [...views]
    .filter(([, view]) => view.webContents.isCurrentlyAudible())
    .map(([id]) => id);
  dispatch({
    type: "tick",
    archiveAfter: durationMs("archiveAfter", settings.archiveAfter),
    sleepAfter: durationMs("sleepAfter", settings.sleepAfter),
    keepAwake: audible,
  });
}

// The sidebar only exists for side tab layouts; top tabs ignore the toggle.
function toggleSidebar() {
  if (settings.tabLayout === "top") return;
  dispatch({ type: "set-sidebar-resizing", resizing: false });
  updateSettings({ sidebarVisible: !settings.sidebarVisible });
}

function toggleCompactMode() {
  updateSettings({ compactMode: !settings.compactMode });
}

// Compact mode hides the toolbar and tabs. The pointer at the edge where they
// live (the top, or the side of the tab sidebar) brings them back; the chrome
// decides when to show them, because it also knows about focus and drags.
const EDGE = 4;
function pagePointer(view, input) {
  if (input.type !== "mouseMove" || !settings.compactMode || !window || window.isDestroyed())
    return;
  const bounds = view.getBounds();
  const x = bounds.x + input.x;
  const y = bounds.y + input.y;
  const width = window.getContentSize()[0];
  const atEdge =
    y < EDGE ||
    (settings.tabLayout === "left" && x < EDGE) ||
    (settings.tabLayout === "right" && x >= width - EDGE);
  if (atEdge === pointerAtEdge) return;
  pointerAtEdge = atEdge;
  window.webContents.send(browserEvents.onPageEdge, atEdge);
}

function setChromeRevealed(revealed) {
  if (typeof revealed !== "boolean") throw new Error("Invalid reveal state.");
  chromeRevealed = revealed;
  // While the chrome shows, the next pointer move over a page reports, so it can hide.
  pointerAtEdge = revealed ? null : false;
  updateWindowButtons();
}

// The macOS window buttons would cover the page while the chrome hides.
function updateWindowButtons() {
  if (process.platform === "darwin" && window && !window.isDestroyed())
    window.setWindowButtonVisibility(!settings.compactMode || chromeRevealed);
}

function installIpc() {
  const handlers = {
    reportPageLayout: (regions) => {
      pageRegions = normalizePageLayout(regions, ...window.getContentSize());
      layout();
    },
    openPalette: (mode = "commands") => {
      if (!["navigate", "commands"].includes(mode)) throw new Error("Invalid palette mode.");
      openPalette(mode);
    },
    closePalette: () => closePalette(),
    executePalette: executePalette,
    toggleSplit: toggleSplit,
    setSplitTab: (side, id) => dispatch({ type: "set-split-tab", side, id }),
    resizeSplit: (ratio) => dispatch({ type: "resize-split", ratio }),
    setSplitResizing: (resizing) => dispatch({ type: "set-split-resizing", resizing }),
    setSidebarResizing: (resizing) => dispatch({ type: "set-sidebar-resizing", resizing }),
    toggleSidebar,
    toggleCompactMode,
    setChromeRevealed,
    openSettings: () => showSettings(true),
    closeSettings: () => showSettings(false),
    setShortcutRecording: (recording) => {
      if (typeof recording !== "boolean") throw new Error("Invalid recording state.");
      setShortcutRecording(recording);
    },
    updateSettings: updateSettings,
    setTabLayout: (value) => updateSettings({ tabLayout: value }),
    getState,
    newTab: () => newTab(),
    cycleTab: (direction) => {
      if (![1, -1].includes(direction)) throw new Error("Invalid tab direction.");
      return cycleTab(direction);
    },
    selectTabPosition: (position) => {
      if (!Number.isInteger(position) || position < 1 || position > 9)
        throw new Error("Invalid tab position.");
      dispatch({ type: "select-position", position });
    },
    selectTab: (id) => {
      if (!isTabId(id)) throw new Error("Invalid tab ID.");
      selectTab(id);
    },
    closeTab: (id) => {
      if (!isTabId(id)) throw new Error("Invalid tab ID.");
      closeTab(id);
    },
    navigate: (input) => {
      if (typeof input !== "string" || input.length > 16_384)
        return { error: "Enter a valid address." };
      try {
        const tab = activeTab();
        const url = resolveAddress(input, settings.searchEngine);
        load(tab, url);
        if (url) activeView().webContents.focus();
        return {};
      } catch (error) {
        return { error: error.message };
      }
    },
    moveTab: (id, zone, folderId, index) => {
      if (!isTabId(id) || (folderId !== null && !isTabId(folderId)))
        throw new Error("Invalid tab position.");
      dispatch({ type: "move-tab", id, zone, folderId, index });
    },
    renameTab: (id, title) => {
      if (!isTabId(id)) throw new Error("Invalid tab ID.");
      dispatch({ type: "rename-tab", id, title });
    },
    editTab: (id) => {
      if (!isTabId(id) || !sessionState().tabs.some((tab) => tab.id === id))
        throw new Error("Invalid tab ID.");
      edit({ kind: "tab", id });
    },
    resetTab: (id) => {
      if (!isTabId(id)) throw new Error("Invalid tab ID.");
      dispatch({ type: "reset-tab", id });
    },
    sleepTab: (id) => {
      if (!isTabId(id)) return { error: "Invalid tab ID." };
      try {
        dispatch({ type: "sleep-tab", id });
        return {};
      } catch (error) {
        return { error: error.message };
      }
    },
    showTabMenu: (id) => {
      if (!isTabId(id)) throw new Error("Invalid tab ID.");
      showTabMenu(id);
    },
    createFolder: (name, tabId) => {
      if (tabId !== undefined && !isTabId(tabId)) throw new Error("Invalid tab ID.");
      dispatch({ type: "create-folder", name, tabId });
    },
    renameFolder: (id, name) => {
      if (!isTabId(id)) throw new Error("Invalid folder ID.");
      dispatch({ type: "rename-folder", id, name });
    },
    toggleFolder: (id) => {
      if (!isTabId(id)) throw new Error("Invalid folder ID.");
      dispatch({ type: "toggle-folder", id });
    },
    deleteFolder: (id) => {
      if (!isTabId(id)) throw new Error("Invalid folder ID.");
      dispatch({ type: "delete-folder", id });
    },
    moveFolder: (id, index) => {
      if (!isTabId(id)) throw new Error("Invalid folder ID.");
      dispatch({ type: "move-folder", id, index });
    },
    showFolderMenu: (id) => {
      if (!isTabId(id)) throw new Error("Invalid folder ID.");
      showFolderMenu(id);
    },
    openArchive: () => dispatch({ type: "show-archive", open: true }),
    closeArchive: () => dispatch({ type: "show-archive", open: false }),
    restoreArchived: (id) => {
      if (!isTabId(id)) throw new Error("Invalid archive ID.");
      dispatch({ type: "restore-archived", id });
    },
    removeArchived: (id) => {
      if (!isTabId(id)) throw new Error("Invalid archive ID.");
      dispatch({ type: "remove-archived", id });
    },
    clearArchive: () => dispatch({ type: "clear-archive" }),
    createSpace: () => dispatch({ type: "create-space" }),
    switchSpace: (id) => {
      if (!isTabId(id)) throw new Error("Invalid space ID.");
      dispatch({ type: "switch-space", id });
    },
    cycleSpace: (direction) => dispatch({ type: "cycle-space", direction }),
    renameSpace: (id, name) => {
      if (!isTabId(id)) throw new Error("Invalid space ID.");
      dispatch({ type: "rename-space", id, name });
    },
    deleteSpace: (id) => {
      if (!isTabId(id)) throw new Error("Invalid space ID.");
      confirmDeleteSpace(id);
    },
    showSpaceMenu: (id) => {
      if (!isTabId(id)) throw new Error("Invalid space ID.");
      showSpaceMenu(id);
    },
    moveTabToSpace: (id, spaceId) => {
      if (!isTabId(id) || !isTabId(spaceId)) throw new Error("Invalid tab or space ID.");
      dispatch({ type: "move-tab-to-space", id, spaceId });
    },
    addRoute: (host, spaceId) => {
      try {
        dispatch({ type: "add-route", host, spaceId });
        return {};
      } catch (error) {
        return { error: error.message };
      }
    },
    removeRoute: (id) => {
      if (!isTabId(id)) throw new Error("Invalid route ID.");
      dispatch({ type: "remove-route", id });
    },
    back: () => history("back"),
    forward: () => history("forward"),
    reload,
    stop: () => activeView()?.webContents.stop(),
  };
  validateCommandHandlers(handlers);
  commandHandlers = handlers;
  for (const [name, { channel }] of Object.entries(browserCommands)) {
    ipcMain.handle(channel, (event, ...args) => {
      const source =
        event.sender === window?.webContents
          ? "chrome"
          : event.sender === paletteView?.webContents
            ? "palette"
            : "remote";
      if (!canInvokeCommand(name, source, event.senderFrame === event.sender.mainFrame))
        throw new Error("Browser controls are only available to the app interface.");
      return handlers[name](...args);
    });
  }
}

function createWindow() {
  browserSession = newSession();
  pageRegions = [];
  window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 640,
    minHeight: 420,
    title: "Browser",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121722" : "#f5f7fa",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 16 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../dist/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on("before-input-event", shortcutKey);
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.on("resize", layout);
  window.on("closed", () => {
    if (paletteView && !paletteView.webContents.isDestroyed())
      paletteView.webContents.close({ waitForBeforeUnload: false });
    paletteView = null;
    const closingViews = [...views.values()];
    views.clear();
    window = null;
    browserSession = newSession();
    for (const view of closingViews) {
      if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
    }
  });
  window.webContents.on("did-finish-load", () => {
    setShortcutRecording(false);
    chromeRevealed = false;
    updateWindowButtons();
    publish();
  });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(path.join(__dirname, "../dist/index.html"));
  newTab();
}

// favicon://icon/<name> serves cached tab icons to the trusted chrome.
protocol.registerSchemesAsPrivileged([
  { scheme: "favicon", privileges: { standard: true, secure: true } },
]);
app.setName("Browser");
const profileDirectory = app.commandLine.getSwitchValue("user-data-dir");
if (profileDirectory) app.setPath("userData", path.resolve(profileDirectory));
app.whenReady().then(() => {
  settingsStore = createSettingsStore(path.join(app.getPath("userData"), "settings.json"));
  settings = settingsStore.get();
  tabStore = createTabStore(path.join(app.getPath("userData"), "tabs.json"));
  faviconDirectory = path.join(app.getPath("userData"), "favicons");
  protocol.handle("favicon", serveFavicon);
  setInterval(tick, 60_000);
  if (process.env.BROWSER_TEST_HOOKS === "1")
    // End-to-end tests move the clock forward to check idle timers.
    globalThis.browserTest = {
      advanceClock: (ms) => {
        clockOffset += ms;
        tick();
      },
    };
  nativeTheme.themeSource = settings.theme;
  nativeTheme.on("updated", updateTheme);
  browsingSession("browsing");
  installIpc();
  installMenu();
  createWindow();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
