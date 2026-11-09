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
  systemPreferences,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { resolveAddress } = require("./navigation.cjs");
const { isWebUrl, isTabId, canOpenPopup, sameSite } = require("./policy.cjs");
const { createSettingsStore } = require("./settings.cjs");
const { createExtensionManager } = require("./extensions.cjs");
const { createExtensionSupport } = require("./extension-apis.cjs");
const { createWebStore } = require("./web-store.cjs");
const { downloadExtension } = require("electron-chrome-web-store");
const { createTabStore } = require("./tab-store.cjs");
const { readLimited } = require("./read-limited.cjs");
const { pageContextMenu } = require("./context-menu.cjs");
const { installSitePermissions } = require("./permissions.cjs");
const { askSystemAccess } = require("./system-access.cjs");
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
const { peekLayout, QUICK_TOOLBAR_HEIGHT } = require("../shared/float-layout.js");
const {
  browserCommands,
  browserEvents,
  canInvokeCommand,
  validateCommandHandlers,
  paletteCommands,
} = require("../shared/commands.js");

// Prototype: tabs, splits, spaces, folders, routes, and the archive persist in
// tabs.json and return asleep after a restart. Remote pages never receive the
// chrome preload. Each space browses in its own session partition.
let settingsStore;
let extensions;
let webStore;
let extensionSupport;
const extensionProfiles = new Map();
const extensionWindows = new Map();
let tabStore;
let faviconDirectory;
// Sleeping tabs keep their back/forward list here, outside the session state.
const sleepingHistory = new Map();
// The back/forward list of each archive entry from this app session, for reopening.
const archivedHistory = new Map();
// Media playback of each page view, "playing" or "paused", in the order it started.
const mediaPlayback = new Map();
// Tabs whose video moved to picture in picture when the user left them.
const pictureInPicture = new Set();
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
// The peek frame: a trusted view with the backdrop and card, under the peeked page.
let peekView;
let peekShown = false;
// The quick window, a small separate window with one page.
let miniWindow;
// The window that shows each page view, and the page views with rounded corners.
const viewHosts = new Map();
const roundedViews = new Set();
let pageRegions = [];
let commandHandlers;
let shortcuts = new Map();
// While the chrome records a new shortcut, keys reach it instead of running actions.
let shortcutRecording = false;
// Mouse events carry no modifier keys, so Alt+click reads the Alt key from key events.
let altHeld = false;
function trackAlt(_event, input) {
  if (input.type === "keyDown" || input.type === "keyUp")
    altHeld = input.key === "Alt" ? input.type === "keyDown" : input.alt;
}
// Compact mode: whether the chrome shows its toolbar and tabs, and the last edge
// state sent to it (null makes the next page pointer move report again).
let chromeRevealed = false;
let pointerAtEdge = false;

const sessionState = () => browserSession.getState();
const shownTabs = (state) => (state.split ? state.split.tabIds : [state.activeId]);
const activeTab = () => sessionState().tabs.find((tab) => tab.id === sessionState().activeId);
const activeView = () => views.get(sessionState().activeId);

function getState() {
  const { pages: _pages, ...state } = sessionState();
  return {
    ...state,
    resolvedTheme: nativeTheme.shouldUseDarkColors ? "dark" : "light",
    media: mediaState(),
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

// Tabs with media, sound, or a mute, newest playback first.
function mediaState() {
  const started = [...mediaPlayback.keys()].reverse();
  const ids = [...started, ...[...views.keys()].filter((id) => !mediaPlayback.has(id))];
  return ids.flatMap((tabId) => {
    const contents = views.get(tabId)?.webContents;
    if (!contents || contents.isDestroyed()) return [];
    const entry = {
      tabId,
      playback: mediaPlayback.get(tabId) ?? null,
      audible: contents.isCurrentlyAudible(),
      muted: contents.isAudioMuted(),
    };
    return entry.playback || entry.audible || entry.muted ? [entry] : [];
  });
}

// An optional macOS-only module; without it, location stays up to Chromium.
function locationPermissions() {
  try {
    return require("node-mac-permissions");
  } catch {
    return null;
  }
}

const partition = (profile) => `persist:${profile}`;
const configuredProfiles = new Set();
// Each space gets its own site consent; other permissions remain denied.
function browsingSession(profile) {
  const browsing = session.fromPartition(partition(profile));
  if (!configuredProfiles.has(profile)) {
    configuredProfiles.add(profile);
    extensionProfiles.set(profile, extensionSupport.configure(profile, browsing));
    browsing.registerPreloadScript({
      type: "frame",
      filePath: path.join(__dirname, "site-preload.cjs"),
    });
    webStore.addSession(profile, browsing);
    installSitePermissions(browsing, {
      prompt: async (contents, origin, types) => {
        const devices = types
          .filter((type) => type === "audio" || type === "video")
          .map((type) => (type === "audio" ? "microphone" : "camera"))
          .join(" and ");
        const action = devices
          ? `use your ${devices}`
          : {
              geolocation: "know your location",
              notifications: "show notifications",
              "clipboard-read": "see text and images you copy",
            }[types[0]];
        const options = {
          type: "question",
          title: "Site permission",
          message: `Allow ${origin} to ${action}?`,
          detail:
            "Access lasts until you quit Browser, in this space's profile. Your system may also ask for permission.",
          buttons: ["Deny", "Allow for this session"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        };
        const host = [...views].find(([, view]) => view.webContents === contents);
        const parent = host && viewHosts.get(host[0]);
        const result = await (parent && !parent.isDestroyed()
          ? dialog.showMessageBox(parent, options)
          : dialog.showMessageBox(options));
        if (result.response !== 1) return false;
        if (process.platform !== "darwin") return true;
        return askSystemAccess(types, {
          // Fake test devices need no system access.
          systemPreferences: app.commandLine.hasSwitch("use-fake-device-for-media-stream")
            ? null
            : systemPreferences,
          // Electron.app in development has no location usage description, so
          // macOS cannot ask for it there.
          locationPermissions: app.isPackaged ? locationPermissions() : null,
        });
      },
    });
  }
  return browsing;
}
const profileOf = (state, tab) => state.spaces.find((space) => space.id === tab.spaceId).profile;
// Tabs, and the pages outside the tab list: the peek and the quick window's page.
const pageTabs = (state) => [...state.tabs, ...[state.peek, state.mini].filter(Boolean)];
const hostFor = (state, id) => (state.mini?.id === id ? miniWindow : window);
function attach(id, view, host) {
  host.contentView.addChildView(view);
  viewHosts.set(id, host);
  extensionProfiles.get(viewProfiles.get(id))?.addTab(view.webContents, host);
}
function detach(id, view) {
  const host = viewHosts.get(id);
  if (host && !host.isDestroyed()) host.contentView.removeChildView(view);
  viewHosts.delete(id);
  roundedViews.delete(id);
}

// Session transitions are pure; this adapter owns all native view side effects.
function dispatch(command) {
  const shownBefore = shownTabs(sessionState());
  const result = browserSession.dispatch(command);
  const pages = pageTabs(result.state);
  if (result.state.mini) createQuickWindow();
  // The frame goes in first, so the peeked page shows above it.
  if (result.state.peek) showPeekFrame();
  // A tab moved to a space with another profile gets a new view in that profile.
  const moved = [];
  for (const [id, view] of views) {
    const tab = pages.find((entry) => entry.id === id);
    if (!tab || tab.asleep || viewProfiles.get(id) === profileOf(result.state, tab)) continue;
    views.delete(id);
    viewProfiles.delete(id);
    mediaPlayback.delete(id);
    detach(id, view);
    view.webContents.close({ waitForBeforeUnload: false });
    if (tab.url) moved.push(tab);
  }
  for (const tab of pages) {
    if (!tab.asleep && !views.has(tab.id)) {
      const profile = profileOf(result.state, tab);
      const view = createPageView(tab.id, profile);
      views.set(tab.id, view);
      viewProfiles.set(tab.id, profile);
      attach(tab.id, view, hostFor(result.state, tab.id));
    }
  }
  // The quick window's page moves to the main window with its view when it becomes a tab.
  for (const [id, view] of views) {
    const tab = pages.find((entry) => entry.id === id);
    const host = hostFor(result.state, id);
    if (tab && !tab.asleep && host && viewHosts.get(id) !== host) {
      detach(id, view);
      attach(id, view, host);
    }
  }
  // The history of tabs that close, for archive effects below.
  const closedHistory = new Map();
  for (const [id, view] of views) {
    const tab = pages.find((entry) => entry.id === id);
    if (tab && !tab.asleep) continue;
    views.delete(id);
    viewProfiles.delete(id);
    detach(id, view);
    const navigation = view.webContents.navigationHistory;
    (tab ? sleepingHistory : closedHistory).set(id, {
      entries: navigation.getAllEntries(),
      index: navigation.getActiveIndex(),
    });
    view.webContents.close({ waitForBeforeUnload: false });
  }
  for (const id of mediaPlayback.keys()) if (!views.has(id)) mediaPlayback.delete(id);
  for (const id of pictureInPicture) if (!views.has(id)) pictureInPicture.delete(id);
  for (const [id, saved] of sleepingHistory)
    if (!result.state.tabs.some((tab) => tab.id === id)) {
      sleepingHistory.delete(id);
      closedHistory.set(id, saved);
    }
  const reopenedHistory = new Map();
  for (const effect of result.effects)
    if (effect.type === "archive" && closedHistory.has(effect.id))
      archivedHistory.set(effect.archiveId, closedHistory.get(effect.id));
    else if (effect.type === "restore")
      reopenedHistory.set(effect.id, archivedHistory.get(effect.archiveId));
  for (const id of archivedHistory.keys())
    if (!result.state.archive.some((entry) => entry.id === id)) archivedHistory.delete(id);
  // A divider drag saves once, when it ends.
  if (!result.state.splitResizing)
    try {
      tabStore.save(browserSession.exportOrganization());
    } catch (error) {
      console.error("Could not save tabs:", error);
    }
  if (!result.state.palette && paletteView?.getVisible()) {
    paletteView.setVisible(false);
    window.contentView.removeChildView(paletteView);
  }
  if (!result.state.peek && peekShown) {
    peekShown = false;
    peekView.setVisible(false);
    window.contentView.removeChildView(peekView);
  }
  if (!result.state.mini && miniWindow) {
    const quick = miniWindow;
    miniWindow = null;
    quick.destroy();
  }
  layout();
  publish();
  const selected = views.get(result.state.activeId)?.webContents;
  if (selected) extensionProfiles.get(viewProfiles.get(result.state.activeId))?.selectTab(selected);
  followMedia(shownBefore, shownTabs(result.state));
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
    } else if (effect.type === "wake") {
      wake(effect.id, effect.url, sleepingHistory.get(effect.id));
      sleepingHistory.delete(effect.id);
    } else if (effect.type === "restore")
      wake(effect.id, effect.url, reopenedHistory.get(effect.id));
    else if (effect.type === "edit") edit(effect);
    else if (effect.type === "clear-profile") clearProfile(effect.profile);
    else if (effect.type === "focus") focusActive();
  }
  return result;
}

// Restore the back/forward list when the tab still shows the page it slept or closed on.
function wake(id, url, saved) {
  const contents = views.get(id)?.webContents;
  if (!contents) return;
  if (saved?.entries[saved.index]?.url === url)
    void contents.navigationHistory.restore(saved).catch(() => contents.loadURL(url));
  else void contents.loadURL(url || "about:blank").catch(() => {});
}

// Page scripts for media controls. They run in every frame, as if the user acted.
const PAUSED_MEDIA = 'Symbol.for("browser.pausedMedia")';
const PAUSE_MEDIA = `(() => {
  const paused = (window[${PAUSED_MEDIA}] = new Set());
  for (const media of document.querySelectorAll("video, audio"))
    if (!media.paused) paused.add(media), media.pause();
  return paused.size > 0;
})()`;
const PLAY_MEDIA = `(() => {
  const paused = window[${PAUSED_MEDIA}];
  const media = paused?.size
    ? [...paused]
    : [...document.querySelectorAll("video, audio")].filter((m) => m.currentTime > 0 && !m.ended);
  for (const item of media) item.play().catch(() => {});
  paused?.clear();
  return media.length > 0;
})()`;
const ENTER_PICTURE_IN_PICTURE = `(async () => {
  if (document.pictureInPictureElement) return true;
  const video = [...document.querySelectorAll("video")].find(
    (v) => !v.paused && !v.ended && v.readyState >= 2 && !v.disablePictureInPicture,
  );
  if (!video || !document.pictureInPictureEnabled) return false;
  return video.requestPictureInPicture().then(() => true, () => false);
})()`;
const EXIT_PICTURE_IN_PICTURE = `document.pictureInPictureElement
  ? document.exitPictureInPicture().then(() => true, () => false)
  : false`;

/** Runs a script in each frame of a page; with `first`, stops at the first true result. */
async function runInFrames(contents, code, first = false) {
  if (contents.isDestroyed()) return false;
  let result = false;
  for (const frame of contents.mainFrame.framesInSubtree) {
    try {
      result = (await frame.executeJavaScript(code, true)) === true || result;
    } catch {
      // A frame can navigate or close while the script runs.
    }
    if (result && first) break;
  }
  return result;
}

// Auto picture in picture: a playing video keeps showing after the user leaves its
// tab, and goes back into the page when the user returns.
function followMedia(before, after) {
  for (const id of before)
    if (
      !after.includes(id) &&
      settings.autoPictureInPicture &&
      mediaPlayback.get(id) === "playing" &&
      views.has(id)
    )
      void runInFrames(views.get(id).webContents, ENTER_PICTURE_IN_PICTURE, true).then(
        (entered) => entered && views.has(id) && pictureInPicture.add(id),
      );
  for (const id of after)
    if (!before.includes(id) && pictureInPicture.delete(id) && views.has(id))
      void runInFrames(views.get(id).webContents, EXIT_PICTURE_IN_PICTURE);
}

function toggleMute(id) {
  const contents = views.get(id)?.webContents;
  if (!contents) return;
  contents.setAudioMuted(!contents.isAudioMuted());
  publish();
}

function toggleMediaPlayback(id) {
  const contents = views.get(id)?.webContents;
  if (!contents) return;
  void runInFrames(contents, mediaPlayback.get(id) === "playing" ? PAUSE_MEDIA : PLAY_MEDIA);
}

function copyUrl() {
  const url = activeTab()?.url;
  if (!url || !window || window.isDestroyed()) return;
  clipboard.writeText(url);
  window.webContents.send(browserEvents.onToast, "Copied");
}

// A deleted space takes its cookies, logins, and cache with it.
function clearProfile(profile) {
  const browsing = browsingSession(profile);
  closeExtensionWindows(profile);
  void extensions
    .clearProfile(profile)
    .then(() => Promise.all([browsing.clearStorageData(), browsing.clearCache()]))
    .catch((error) => console.error("Could not clear the space profile:", error));
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
  if (state.peek) {
    if (state.peek.url && !state.peek.error) views.get(state.peek.id).webContents.focus();
    else peekView?.webContents.focus();
    return;
  }
  const tab = activeTab();
  const screenOpen = state.settingsOpen || state.archiveOpen;
  if (!screenOpen && tab?.url && !tab.error) activeView().webContents.focus();
  else {
    window.webContents.focus();
    if (!screenOpen) window.webContents.send(browserEvents.onFocusAddress);
  }
}

function publish() {
  if (!window || window.isDestroyed()) return;
  const state = getState();
  for (const contents of [
    window.webContents,
    paletteView?.webContents,
    peekView?.webContents,
    miniWindow?.webContents,
  ])
    if (contents && !contents.isDestroyed()) contents.send(browserEvents.onState, state);
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
    if (page.id === state.peek?.id) {
      if (peekView) peekView.setBounds({ x: 0, y: 0, width, height });
      round(page.id, view, 8);
      view.setBounds(peekLayout(width, height).page);
      view.setVisible(page.visible);
      continue;
    }
    if (page.id === state.mini?.id) {
      const [quickWidth, quickHeight] = miniWindow.getContentSize();
      view.setBounds({
        x: 0,
        y: QUICK_TOOLBAR_HEIGHT,
        width: quickWidth,
        height: Math.max(0, quickHeight - QUICK_TOOLBAR_HEIGHT),
      });
      view.setVisible(page.visible);
      continue;
    }
    round(page.id, view, 0);
    const region = currentLayout ? regions.find((entry) => entry.id === page.id) : undefined;
    if (region?.bounds.width > 0 && region.bounds.height > 0) {
      view.setBounds(region.bounds);
      view.setVisible(page.visible);
    } else view.setVisible(false);
  }
}

// A peeked page has rounded corners inside its card; a tab page has none.
function round(id, view, radius) {
  if (roundedViews.has(id) === radius > 0) return;
  view.setBorderRadius(radius);
  if (radius) roundedViews.add(id);
  else roundedViews.delete(id);
}

/** Loads the trusted interface, at a hash route for the small views and windows. */
function loadInterface(contents, hash) {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void contents.loadURL(hash ? new URL(`#${hash}`, devUrl).href : devUrl);
  else void contents.loadFile(path.join(__dirname, "../dist/index.html"), hash ? { hash } : {});
}

/** A transparent trusted view above the pages, never a website preload. */
function createOverlayView(hash) {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "../dist/preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  view.setBackgroundColor("#00000000");
  view.webContents.on("will-navigate", (event) => event.preventDefault());
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("before-input-event", shortcutKey);
  view.webContents.on("before-input-event", trackAlt);
  loadInterface(view.webContents, hash);
  return view;
}

function showPeekFrame() {
  if (!peekView) {
    peekView = createOverlayView("peek");
    peekView.webContents.on("did-finish-load", publish);
    peekView.webContents.on("render-process-gone", () => {
      const gone = peekView;
      peekView = null;
      if (peekShown) window?.contentView.removeChildView(gone);
      peekShown = false;
      gone.webContents.close({ waitForBeforeUnload: false });
      if (sessionState().peek) dispatch({ type: "close-float", kind: "peek" });
    });
  }
  if (peekShown) return;
  peekShown = true;
  window.contentView.addChildView(peekView);
  peekView.setVisible(true);
}

function openPeek(url) {
  try {
    dispatch({ type: "open-float", kind: "peek", url });
  } catch {
    // Settings or the archive are open; the link stays where it is.
  }
}

function createQuickWindow() {
  if (miniWindow) return;
  const quick = new BrowserWindow({
    width: 560,
    height: 700,
    minWidth: 380,
    minHeight: 320,
    title: "Quick window",
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
  miniWindow = quick;
  quick.webContents.on("before-input-event", (event, input) =>
    shortcutKey(event, input, quick.webContents),
  );
  quick.webContents.on("before-input-event", trackAlt);
  quick.on("blur", () => (altHeld = false));
  quick.webContents.on("will-navigate", (event) => event.preventDefault());
  quick.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  quick.webContents.on("did-finish-load", publish);
  quick.on("resize", layout);
  // The page view must leave the window before the window goes away.
  quick.on("close", () => {
    if (miniWindow !== quick) return;
    miniWindow = null;
    const id = sessionState().mini?.id;
    if (views.has(id)) detach(id, views.get(id));
    dispatch({ type: "close-float", kind: "mini" });
  });
  loadInterface(quick.webContents, "mini");
}

function openQuickWindow(url = "") {
  if (!window) createWindow();
  dispatch({ type: "open-float", kind: "mini", url });
  miniWindow.show();
  miniWindow.focus();
  if (url) views.get(sessionState().mini.id).webContents.focus();
  else miniWindow.webContents.send(browserEvents.onFocusAddress);
}

function moveQuickWindowToTab() {
  dispatch({ type: "expand-float", kind: "mini" });
  window.show();
  window.focus();
  focusActive();
}

// Links from other apps open in the quick window.
const linksIn = (argv) => argv.filter((value) => isWebUrl(value));
const waitingLinks = [];
let initialized = false;
function openLink(url) {
  if (!isWebUrl(url)) return;
  if (!initialized) waitingLinks.push(url);
  else openQuickWindow(url);
}

// The palette is a trusted local view above the page views, never a website preload.
function openPalette(mode = "commands") {
  if (!window || !["navigate", "commands"].includes(mode)) return;
  dispatch({ type: "open-palette", mode });
  if (!paletteView) {
    paletteView = createOverlayView("palette");
    paletteView.webContents.on("did-finish-load", () => {
      publish();
      if (sessionState().palette) paletteView.webContents.focus();
    });
    paletteView.webContents.on("render-process-gone", () => {
      closePalette();
      paletteView.webContents.close({ waitForBeforeUnload: false });
      paletteView = null;
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
function shortcutKey(event, input, source) {
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
  const quickPage = views.get(sessionState().mini?.id)?.webContents;
  runShortcut(id, !!miniWindow && [miniWindow.webContents, quickPage].includes(source));
}

function runPaletteCommand(id) {
  const command = paletteCommands(getState()).find((entry) => entry.id === id);
  if (command) commandHandlers[command.command](...command.args);
}

// Page actions in the quick window act on its page; other actions are for the main window.
function runQuickShortcut(id) {
  const page = sessionState().mini;
  const contents = views.get(page?.id)?.webContents;
  switch (id) {
    case "closeTab":
      dispatch({ type: "close-float", kind: "mini" });
      return true;
    case "newQuickWindow":
    case "openAddress":
      miniWindow.webContents.focus();
      miniWindow.webContents.send(browserEvents.onFocusAddress);
      return true;
    case "reload":
      if (page?.error) dispatch({ type: "open-float", kind: "mini", url: page.url });
      else if (page?.url) contents.reload();
      return true;
    case "back":
    case "forward": {
      const navigation = contents?.navigationHistory;
      if (id === "back" && navigation?.canGoBack()) navigation.goBack();
      if (id === "forward" && navigation?.canGoForward()) navigation.goForward();
      return true;
    }
    case "copyUrl":
      if (page?.url) clipboard.writeText(page.url);
      return true;
    case "devTools":
      (page?.url ? contents : miniWindow.webContents).toggleDevTools();
      return true;
  }
  window?.focus();
  return false;
}

function runShortcut(id, quick = false) {
  if (quick && miniWindow && runQuickShortcut(id)) return;
  if (id === "newQuickWindow") return openQuickWindow();
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
      return copyUrl();
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
      click: (_item, focused) => runShortcut(id, !!miniWindow && focused === miniWindow),
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
          item("newQuickWindow"),
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
  // Background tabs may never have appeared in a DOM layout report. Keep a
  // usable viewport for extension automation; visible tabs receive exact bounds.
  const [initialWidth, initialHeight] = window.getContentSize();
  view.setBounds({ x: 0, y: 0, width: initialWidth, height: initialHeight });
  contents.on("context-menu", (_event, params) => {
    const host = viewHosts.get(id);
    if (!host || host.isDestroyed()) return;
    Menu.buildFromTemplate(
      pageContextMenu(contents, params, {
        copyText: (text) => clipboard.writeText(text),
        openTab: (url) => newTab(url, tab()?.spaceId),
      }),
    ).popup({ window: host });
  });
  const tab = () => pageTabs(sessionState()).find((entry) => entry.id === id);
  // The link under the pointer, so a click on it can open in a peek.
  let hovered = "";
  contents.on("update-target-url", (_event, url) => (hovered = url));
  // Alt+click on a link peeks at it, except in the quick window.
  contents.on("before-mouse-event", (event, mouse) => {
    if (
      mouse.type === "mouseDown" &&
      mouse.button === "left" &&
      altHeld &&
      isWebUrl(hovered) &&
      sessionState().mini?.id !== id
    ) {
      event.preventDefault();
      openPeek(hovered);
    }
  });
  // A pinned tab keeps its site: a link to another site opens in a peek.
  // A pinned tab or favorite peeks at a clicked link to another site, so the tab stays on its site.
  const peeksLinks = (url) =>
    tab()?.homeUrl &&
    tab().zone !== "today" &&
    url === hovered &&
    !sameSite(url, view.webContents.getURL());
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
  // A new document starts without media; same-document navigations keep it.
  contents.on("did-navigate", () => {
    if (views.get(id) === view) mediaPlayback.delete(id);
  });
  contents.on("did-navigate", navigated);
  contents.on("media-started-playing", () => {
    if (views.get(id) !== view) return;
    mediaPlayback.delete(id);
    mediaPlayback.set(id, "playing");
    publish();
  });
  contents.on("media-paused", () => {
    if (views.get(id) !== view || !mediaPlayback.has(id)) return;
    mediaPlayback.set(id, "paused");
    publish();
  });
  contents.on("audio-state-changed", () => {
    if (views.get(id) === view) publish();
  });
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
  contents.on("will-navigate", (event, url) => {
    if (!event.isMainFrame || !peeksLinks(url)) return;
    event.preventDefault();
    openPeek(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url) && peeksLinks(url)) {
      openPeek(url);
      return { action: "deny" };
    }
    const now = performance.now();
    if (isWebUrl(url) && canOpenPopup(lastPopupAt, now)) {
      lastPopupAt = now;
      // A popup opens in its opener's space, with its login, unless a route says otherwise.
      newTab(url, tab()?.spaceId);
    }
    return { action: "deny" };
  });
  contents.on("before-input-event", (event, input) => shortcutKey(event, input, contents));
  contents.on("before-input-event", trackAlt);
  contents.on("input-event", (_event, input) => {
    if (sessionState().mini?.id !== id) pagePointer(view, input);
  });
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.key !== "Escape") return;
    // Escape closes a peek, like a click outside it.
    if (sessionState().peek?.id === id) {
      event.preventDefault();
      dispatch({ type: "close-float", kind: "peek" });
    } else if (tab()?.loading) contents.stop();
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

function extensionProfile(spaceId) {
  const space = sessionState().spaces.find((entry) => entry.id === spaceId);
  if (!isTabId(spaceId) || !space) throw new Error("Space not found.");
  return space.profile;
}

function closeExtensionWindows(profile, id) {
  for (const [host, entry] of extensionWindows) {
    if (entry.profile === profile && (!id || entry.id === id)) host.destroy();
  }
}

// Extension pages use the browsing profile and never receive the app preload.
// Keep them out of browser tabs, whose navigation policy only permits web URLs.
async function openExtensionPage(spaceId, id, kind) {
  if (!["popup", "options"].includes(kind)) throw new Error("Invalid extension page.");
  const profile = extensionProfile(spaceId);
  const url = extensions.resource(profile, id, kind);
  closeExtensionWindows(profile, id);
  await createExtensionWindow(profile, id, url, kind);
}

async function createExtensionWindow(profile, id, url, kind = "options", dimensions = {}) {
  const spaceId = sessionState().spaces.find((space) => space.profile === profile)?.id;
  if (!spaceId) throw new Error("Space no longer exists.");
  const host = new BrowserWindow({
    parent: window,
    width: kind === "popup" ? 420 : 800,
    height: kind === "popup" ? 560 : 650,
    show: false,
    title: kind === "popup" ? "Extension" : "Extension options",
    autoHideMenuBar: true,
    ...dimensions,
    webPreferences: {
      session: browsingSession(profile),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  extensionWindows.set(host, { profile, id });
  host.on("closed", () => extensionWindows.delete(host));
  const ownResource = (target) => {
    try {
      const parsed = new URL(target);
      return parsed.protocol === "chrome-extension:" && parsed.hostname === id;
    } catch {
      return false;
    }
  };
  const openWebLink = (target) => {
    if (isWebUrl(target) && sessionState().spaces.some((space) => space.id === spaceId))
      newTab(target, spaceId);
  };
  for (const event of ["will-navigate", "will-redirect"]) {
    host.webContents.on(event, (event, target) => {
      if (ownResource(target)) return;
      event.preventDefault();
      openWebLink(target);
    });
  }
  host.webContents.setWindowOpenHandler(({ url: target }) => {
    openWebLink(target);
    return { action: "deny" };
  });
  host.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape" && kind === "popup") {
      event.preventDefault();
      host.close();
    }
  });
  try {
    await host.loadURL(url);
    if (!host.isDestroyed()) host.show();
  } catch (error) {
    if (!host.isDestroyed()) host.destroy();
    throw error;
  }
  return host;
}

async function extensionResult(operation) {
  try {
    await operation();
    return {};
  } catch (error) {
    return { error: error.message };
  }
}

function showExtensionsMenu() {
  const spaceId = sessionState().activeSpaceId;
  const installed = extensions.list(extensionProfile(spaceId));
  const open = (id, kind) =>
    void extensionResult(() => openExtensionPage(spaceId, id, kind)).then((result) => {
      if (result.error && window && !window.isDestroyed())
        window.webContents.send(browserEvents.onToast, result.error);
    });
  Menu.buildFromTemplate([
    ...installed.map((extension) => ({
      label:
        extension.name +
        (!extension.enabled ? " (disabled)" : extension.error ? " (failed to load)" : ""),
      submenu: [
        {
          label: "Run action on current tab",
          enabled: extension.enabled && extension.loaded && !!activeView(),
          click: () => {
            const contents = activeView()?.webContents;
            if (contents)
              extensionProfiles.get(extensionProfile(spaceId))?.activate(extension.id, contents);
          },
        },
        {
          label: "Open popup",
          enabled: extension.hasPopup,
          click: () => open(extension.id, "popup"),
        },
        {
          label: "Options",
          enabled: extension.hasOptions,
          click: () => open(extension.id, "options"),
        },
      ],
    })),
    ...(installed.length
      ? [{ type: "separator" }]
      : [{ label: "No extensions in this space", enabled: false }]),
    { label: "Manage extensions…", click: () => showSettings(true) },
  ]).popup({ window });
}

function updateTheme() {
  for (const target of [window, miniWindow])
    if (target && !target.isDestroyed())
      target.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#121722" : "#f5f7fa");
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
            label: folderPath(state.folders, folder),
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

/** A nested folder's menu label names its parents too, for example "Archives / ZMK". */
function folderPath(folders, folder) {
  const parent = folders.find((entry) => entry.id === folder.parentId);
  return parent ? `${folderPath(folders, parent)} / ${folder.name}` : folder.name;
}

function folderMenu(id) {
  const state = sessionState();
  const folder = state.folders.find((entry) => entry.id === id);
  if (!folder) return null;
  const otherSpaces = state.spaces.filter((space) => space.id !== folder.spaceId);
  return [
    { label: "New folder inside", click: () => dispatch({ type: "create-folder", parentId: id }) },
    { label: "Rename folder…", click: () => edit({ kind: "folder", id }) },
    ...(otherSpaces.length
      ? [
          {
            label: "Move to space",
            submenu: otherSpaces.map((space) => ({
              label: space.name,
              click: () => dispatch({ type: "move-folder-to-space", id, spaceId: space.id }),
            })),
          },
        ]
      : []),
    { type: "separator" },
    {
      label: "Delete folder",
      toolTip: "Its subfolders and tabs move up one level.",
      click: () => dispatch({ type: "delete-folder", id }),
    },
  ];
}

function showFolderMenu(id) {
  const template = window && folderMenu(id);
  if (template) Menu.buildFromTemplate(template).popup({ window });
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
    // A tab whose video shows in picture in picture stays awake too.
    keepAwake: [...audible, ...pictureInPicture],
  });
}

// The sidebar only exists for side tab layouts; top tabs ignore the toggle.
// Compact mode hides the tabs in every layout, so there it keeps them shown, or not.
function toggleSidebar() {
  if (settings.compactMode) return updateSettings({ compactTabs: !settings.compactTabs });
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
  // Kept side tabs sit on their edge, so only the top edge reveals the toolbar then.
  const sideEdge =
    !settings.compactTabs &&
    ((settings.tabLayout === "left" && x < EDGE) ||
      (settings.tabLayout === "right" && x >= width - EDGE));
  const atEdge = y < EDGE || sideEdge;
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
/** JPEG images of the shown pages; the chrome shows them while a tab drag hides the pages. */
async function capturePages() {
  const shown = sessionState().pages.filter(
    (page) => page.visible && views.get(page.id)?.getVisible(),
  );
  const snapshots = await Promise.all(
    shown.map(async ({ id }) => {
      const image = await views.get(id).webContents.capturePage();
      return image.isEmpty()
        ? null
        : { id, image: `data:image/jpeg;base64,${image.toJPEG(85).toString("base64")}` };
    }),
  );
  return snapshots.filter(Boolean);
}

// Kept tabs on the top or left leave room for them; on the right they would cover the page.
function updateWindowButtons() {
  const tabsHoldButtons = settings.compactTabs && settings.tabLayout !== "right";
  if (process.platform === "darwin" && window && !window.isDestroyed())
    window.setWindowButtonVisibility(!settings.compactMode || chromeRevealed || tabsHoldButtons);
}

function installIpc() {
  const handlers = {
    getExtensions: (spaceId) => extensions.list(extensionProfile(spaceId)),
    loadExtension: (spaceId) =>
      extensionResult(async () => {
        extensionProfile(spaceId);
        const { canceled, filePaths } = await dialog.showOpenDialog(window, {
          title: "Load unpacked Chrome extension",
          properties: ["openDirectory"],
          buttonLabel: "Load extension",
        });
        if (canceled || !filePaths.length) return;
        await extensions.install(extensionProfile(spaceId), filePaths[0]);
      }),
    setExtensionEnabled: (spaceId, id, enabled) =>
      extensionResult(async () => {
        const profile = extensionProfile(spaceId);
        await extensions.setEnabled(profile, id, enabled);
        if (!enabled) closeExtensionWindows(profile, id);
      }),
    reloadExtension: (spaceId, id) =>
      extensionResult(async () => {
        const profile = extensionProfile(spaceId);
        closeExtensionWindows(profile, id);
        await extensions.reload(profile, id);
      }),
    removeExtension: (spaceId, id) =>
      extensionResult(async () => {
        const profile = extensionProfile(spaceId);
        await extensions.remove(profile, id);
        closeExtensionWindows(profile, id);
      }),
    openExtensionPage: (spaceId, id, kind) =>
      extensionResult(() => openExtensionPage(spaceId, id, kind)),
    showExtensionsMenu,
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
    resizeSplit: (ratio, axis, index) => dispatch({ type: "resize-split", ratio, axis, index }),
    addSplitPane: () => dispatch({ type: "add-split-pane" }),
    removeSplitPane: (id) => {
      if (!isTabId(id)) throw new Error("Invalid tab ID.");
      dispatch({ type: "remove-split-pane", id });
    },
    setSplitLayout: (layout) => dispatch({ type: "set-split-layout", layout }),
    splitWith: (id, target, edge) => {
      if (!isTabId(id) || !isTabId(target)) throw new Error("Invalid tab ID.");
      dispatch({ type: "split-with", id, target, edge });
    },
    setSplitResizing: (resizing) => dispatch({ type: "set-split-resizing", resizing }),
    setSidebarResizing: (resizing) => dispatch({ type: "set-sidebar-resizing", resizing }),
    capturePages,
    setTabDragging: (dragging) => dispatch({ type: "set-tab-dragging", dragging }),
    closePeek: () => dispatch({ type: "close-float", kind: "peek" }),
    expandPeek: () => dispatch({ type: "expand-float", kind: "peek" }),
    openQuickWindow: () => openQuickWindow(),
    navigateQuickWindow: (input) => {
      if (typeof input !== "string" || input.length > 16_384)
        return { error: "Enter a valid address." };
      try {
        const url = resolveAddress(input, settings.searchEngine);
        if (!url) return { error: "Enter an address or a search." };
        dispatch({ type: "open-float", kind: "mini", url });
        views.get(sessionState().mini.id).webContents.focus();
        return {};
      } catch (error) {
        return { error: error.message };
      }
    },
    moveQuickWindowToTab,
    closeQuickWindow: () => dispatch({ type: "close-float", kind: "mini" }),
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
    createFolder: (name, tabId, parentId) => {
      if (tabId !== undefined && !isTabId(tabId)) throw new Error("Invalid tab ID.");
      if (parentId !== undefined && !isTabId(parentId)) throw new Error("Invalid folder ID.");
      dispatch({ type: "create-folder", name, tabId, parentId });
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
    moveFolder: (id, index, parentId) => {
      if (!isTabId(id) || (parentId != null && !isTabId(parentId)))
        throw new Error("Invalid folder ID.");
      dispatch({ type: "move-folder", id, index, parentId: parentId ?? null });
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
    copyUrl,
    toggleMute: (id) => {
      if (!isTabId(id)) throw new Error("Invalid tab ID.");
      toggleMute(id);
    },
    toggleMediaPlayback: (id) => {
      if (!isTabId(id)) throw new Error("Invalid tab ID.");
      toggleMediaPlayback(id);
    },
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
            : event.sender === peekView?.webContents
              ? "peek"
              : event.sender === miniWindow?.webContents
                ? "mini"
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
  window.webContents.on("before-input-event", trackAlt);
  window.on("blur", () => (altHeld = false));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.on("resize", layout);
  window.on("closed", () => {
    for (const host of extensionWindows.keys()) host.destroy();
    if (paletteView && !paletteView.webContents.isDestroyed())
      paletteView.webContents.close({ waitForBeforeUnload: false });
    paletteView = null;
    if (peekView && !peekView.webContents.isDestroyed())
      peekView.webContents.close({ waitForBeforeUnload: false });
    peekView = null;
    peekShown = false;
    // The quick window shares the session of the main window, so it closes too.
    const quick = miniWindow;
    miniWindow = null;
    quick?.destroy();
    viewHosts.clear();
    roundedViews.clear();
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
  loadInterface(window.webContents);
  // Session restore: show the saved tab and split after the chrome loads, so the
  // browser controls come first. Without a saved tab, start with a new tab.
  const restoredId = sessionState().activeId;
  if (!restoredId) newTab();
  else
    window.webContents.once("did-finish-load", () => {
      if (sessionState().activeId === restoredId) dispatch({ type: "select-tab", id: restoredId });
    });
}

// favicon://icon/<name> serves cached tab icons to the trusted chrome.
protocol.registerSchemesAsPrivileged([
  { scheme: "favicon", privileges: { standard: true, secure: true } },
]);
app.setName("Browser");
// Electron never answers clicks on the <usermedia> and <geolocation> permission
// elements. Without them, sites such as Google Meet fall back to a button that calls
// getUserMedia, which shows this browser's permission dialog.
app.commandLine.appendSwitch("disable-blink-features", "UserMediaElement,GeolocationElement");
// End-to-end tests set BROWSER_BACKGROUND=1. The app then shows its windows but can
// never become the active app, so a local test run does not take focus.
if (process.env.BROWSER_BACKGROUND === "1" && process.platform === "darwin")
  app.setActivationPolicy("prohibited");
const profileDirectory = app.commandLine.getSwitchValue("user-data-dir");
if (profileDirectory) app.setPath("userData", path.resolve(profileDirectory));
// One app per profile: a second launch hands its links to the first and quits.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on("second-instance", (_event, argv) => {
  const links = linksIn(argv.slice(1));
  if (links.length) links.forEach(openLink);
  else if (!initialized) return;
  else if (!window) createWindow();
  else window.focus();
});
app.on("open-url", (event, url) => {
  event.preventDefault();
  openLink(url);
});
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  settingsStore = createSettingsStore(path.join(app.getPath("userData"), "settings.json"));
  settings = settingsStore.get();
  tabStore = createTabStore(path.join(app.getPath("userData"), "tabs.json"));
  extensions = createExtensionManager(
    path.join(app.getPath("userData"), "extensions.json"),
    browsingSession,
  );
  const tabIdForContents = (contents) =>
    [...views].find(([, view]) => view.webContents === contents)?.[0];
  extensionSupport = createExtensionSupport({
    ipcMain,
    adapter: {
      mainWindow: () => window,
      tabs: (profile) =>
        [...views]
          .filter(([id]) => viewProfiles.get(id) === profile)
          .map(([, view]) => view.webContents),
      windowFor: (contents) => viewHosts.get(tabIdForContents(contents)),
      selectTab: (contents) => {
        const id = tabIdForContents(contents);
        if (id && sessionState().activeId !== id) selectTab(id);
      },
      removeTab: (contents) => {
        const id = tabIdForContents(contents);
        if (id) closeTab(id);
      },
      createTab: async (profile, details) => {
        const url = details.url ?? "about:blank";
        if (url.startsWith("chrome-extension://")) {
          const parsed = new URL(url);
          if (!browsingSession(profile).extensions.getExtension(parsed.hostname))
            throw new Error("Unknown extension.");
          const host = await createExtensionWindow(profile, parsed.hostname, url);
          return [host.webContents, host];
        }
        if (url !== "about:blank" && !isWebUrl(url))
          throw new Error("Only web pages can be opened.");
        const space = sessionState().spaces.find((space) => space.profile === profile);
        if (!space) throw new Error("Space no longer exists.");
        const previous = sessionState().activeId;
        // Extension-created tabs belong to the caller's profile. User link
        // routes must not move them into another space's cookies or logins.
        const id = newTab("", space.id);
        if (url !== "about:blank")
          load(
            sessionState().tabs.find((tab) => tab.id === id),
            url,
          );
        const contents = views.get(id).webContents;
        // The app's empty New Tab has no document. CDP Page.enable needs a real
        // renderer even when an agent asks to start from about:blank.
        if (url === "about:blank") await contents.loadURL("about:blank");
        if (details.active === false && previous !== id) selectTab(previous);
        return [contents, viewHosts.get(id)];
      },
      createWindow: async (profile, details) => {
        const url = Array.isArray(details.url) ? details.url[0] : details.url;
        const parsed = new URL(url);
        if (
          parsed.protocol !== "chrome-extension:" ||
          !browsingSession(profile).extensions.getExtension(parsed.hostname)
        )
          throw new Error("Only extension windows are supported.");
        return createExtensionWindow(profile, parsed.hostname, url, "options", {
          width: details.width ?? 800,
          height: details.height ?? 650,
        });
      },
      assignTabDetails: (details, contents) => {
        const id = tabIdForContents(contents);
        const tab = sessionState().tabs.find((tab) => tab.id === id);
        if (tab) {
          details.pinned = tab.zone !== "today";
          details.index = sessionState()
            .tabs.filter((entry) => entry.spaceId === tab.spaceId)
            .findIndex((entry) => entry.id === id);
          details.active = sessionState().activeId === id;
        }
      },
      moveTabs: async (_profile, contents, details) => {
        for (const [offset, page] of contents.entries()) {
          const id = tabIdForContents(page);
          const tab = sessionState().tabs.find((tab) => tab.id === id);
          if (tab)
            dispatch({
              type: "move-tab",
              id,
              zone: tab.zone,
              folderId: tab.folderId,
              index: Math.max(0, details.index + offset),
            });
        }
      },
    },
  });
  webStore = createWebStore({
    ipcMain,
    manager: extensions,
    extensionsPath: path.join(app.getPath("userData"), "store-extensions"),
    preloadPath: require.resolve("electron-chrome-web-store/preload"),
    downloadExtension,
    chromeVersion: process.versions.chrome,
    closeWindows: closeExtensionWindows,
    prompt: async ({ kind, profile, name, permissions, event }) => {
      const space = sessionState().spaces.find((entry) => entry.profile === profile);
      if (!space || event.sender.isDestroyed()) return false;
      const removing = kind === "remove";
      const options = {
        type: "question",
        title: removing ? "Remove extension" : "Install Chrome extension",
        message: `${removing ? "Remove" : "Install"} ${name} ${removing ? "from" : "in"} ${space.name}?`,
        detail: removing
          ? "You can install this extension again from Chrome Web Store."
          : `Permissions:\n${permissions.length ? permissions.join("\n") : "No additional permissions"}\n\nOnly install extensions you trust. Some Chrome APIs are unavailable in this browser.`,
        buttons: ["Cancel", removing ? "Remove extension" : "Add extension"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      const page = [...views].find(([, view]) => view.webContents === event.sender);
      const parent = page && viewHosts.get(page[0]);
      const result = await (parent && !parent.isDestroyed()
        ? dialog.showMessageBox(parent, options)
        : dialog.showMessageBox(options));
      return (
        result.response === 1 &&
        !event.sender.isDestroyed() &&
        sessionState().spaces.some((entry) => entry.profile === profile)
      );
    },
  });
  // Load before restoring pages so content scripts run on their first navigation.
  await extensions.restore(
    newSession()
      .getState()
      .spaces.map((space) => space.profile),
  );
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
      // Native context menus cannot be clicked from tests; this runs one menu item.
      clickFolderMenu: (id, ...labels) => {
        let items = folderMenu(id) ?? [];
        for (const label of labels.slice(0, -1))
          items = items.find((item) => item.label === label)?.submenu ?? [];
        const item = items.find((entry) => entry.label === labels[labels.length - 1]);
        if (!item?.click) throw new Error(`No folder menu item: ${labels.join(" > ")}`);
        item.click();
      },
    };
  nativeTheme.themeSource = settings.theme;
  nativeTheme.on("updated", updateTheme);
  browsingSession("browsing");
  installIpc();
  installMenu();
  createWindow();
  initialized = true;
  for (const url of [...linksIn(process.argv.slice(1)), ...waitingLinks.splice(0)])
    openQuickWindow(url);
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
