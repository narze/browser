const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  Menu,
  session,
  nativeTheme,
} = require("electron");
const path = require("node:path");
const { resolveAddress } = require("./navigation.cjs");
const { isWebUrl, isTabId, canOpenPopup } = require("./policy.cjs");
const { createSettingsStore } = require("./settings.cjs");
const { createBrowserSession } = require("./browser-session.cjs");
const { normalizePageLayout } = require("./page-layout.cjs");
const {
  browserCommands,
  browserEvents,
  canInvokeCommand,
  validateCommandHandlers,
  paletteCommands,
} = require("../shared/commands.js");

// Prototype: tabs are in memory. Remote pages never receive the chrome preload.
let settingsStore;
let settings;
let window;
let browserSession;
const views = new Map();
let paletteView;
let pageRegions = [];
let commandHandlers;

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
      canGoBack: views.get(tab.id).webContents.navigationHistory.canGoBack(),
      canGoForward: views.get(tab.id).webContents.navigationHistory.canGoForward(),
    })),
  };
}

// Session transitions are pure; this adapter owns all native view side effects.
function dispatch(command) {
  const result = browserSession.dispatch(command);
  for (const tab of result.state.tabs) {
    if (!views.has(tab.id)) {
      const view = createPageView(tab.id);
      views.set(tab.id, view);
      window.contentView.addChildView(view);
    }
  }
  for (const [id, view] of views) {
    if (result.state.tabs.some((tab) => tab.id === id)) continue;
    views.delete(id);
    window.contentView.removeChildView(view);
    view.webContents.close({ waitForBeforeUnload: false });
  }
  if (!result.state.palette && paletteView?.getVisible()) {
    paletteView.setVisible(false);
    window.contentView.removeChildView(paletteView);
  }
  layout();
  publish();
  for (const effect of result.effects) {
    if (effect.type === "load") {
      const contents = views.get(effect.id).webContents;
      if (!effect.url) contents.stop();
      // did-fail-load owns visible errors, including redirects.
      void contents.loadURL(effect.url || "about:blank").catch(() => {});
    } else if (effect.type === "focus") focusActive();
  }
  return result;
}

function focusActive() {
  const state = sessionState();
  const tab = activeTab();
  if (!state.settingsOpen && tab?.url && !tab.error) activeView().webContents.focus();
  else {
    window.webContents.focus();
    if (!state.settingsOpen) window.webContents.send(browserEvents.onFocusAddress);
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
  const ids = state.split && !state.settingsOpen ? state.split.tabIds : [state.activeId];
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
    paletteView.webContents.on("before-input-event", paletteShortcut);
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

function paletteShortcut(event, input) {
  if (
    input.type !== "keyDown" ||
    !(process.platform === "darwin" ? input.meta : input.control) ||
    input.alt ||
    input.shift
  )
    return;
  const key = input.key.toLowerCase();
  if (key === "l" || key === "k") {
    event.preventDefault();
    openPalette(key === "l" ? "navigate" : "commands");
  }
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

function newTab(url = "") {
  return dispatch({ type: "new-tab", url }).state.activeId;
}

function createPageView(id) {
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: "persist:browsing",
    },
  });
  const contents = view.webContents;
  const tab = () => sessionState().tabs.find((entry) => entry.id === id);
  const update = (patch) => dispatch({ type: "update-tab", id, patch });
  contents.on("focus", () => {
    const state = sessionState();
    if (
      state.split?.tabIds.includes(id) &&
      !state.settingsOpen &&
      !state.splitResizing &&
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
      newTab(url);
    }
    return { action: "deny" };
  });
  contents.on("before-input-event", paletteShortcut);
  contents.on("before-input-event", tabShortcut);
  contents.on("before-input-event", (_event, input) => {
    if (input.type === "keyDown" && input.key === "Escape" && tab()?.loading) contents.stop();
  });
  return view;
}

function tabShortcut(event, input) {
  if (input.type !== "keyDown") return;
  if (input.control && input.key === "Tab") {
    event.preventDefault();
    cycleTab(input.shift ? -1 : 1);
  } else if ((input.meta || input.control) && /^[1-9]$/.test(input.key)) {
    event.preventDefault();
    dispatch({ type: "select-position", position: Number(input.key) });
  }
}

function closeTab(id) {
  dispatch({ type: "close-tab", id });
}

function toggleSplit() {
  dispatch({ type: "toggle-split" });
}

function cycleTab(direction) {
  dispatch({ type: "cycle-tab", direction });
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
  dispatch({ type: "show-settings", open });
}

function updateTheme() {
  if (window && !window.isDestroyed())
    window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#121722" : "#f5f7fa");
  publish();
}

function updateSettings(patch) {
  try {
    settings = settingsStore.update(patch);
    nativeTheme.themeSource = settings.theme;
    updateTheme();
    layout();
    publish();
    return {};
  } catch {
    return { error: "Could not save these settings. Please try again." };
  }
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
    openSettings: () => showSettings(true),
    closeSettings: () => showSettings(false),
    updateSettings: updateSettings,
    setTabLayout: (value) => updateSettings({ tabLayout: value }),
    getState,
    newTab: () => newTab(),
    cycleTab: (direction) => {
      if (![1, -1].includes(direction)) throw new Error("Invalid tab direction.");
      cycleTab(direction);
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
  browserSession = createBrowserSession();
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
  window.webContents.on("before-input-event", paletteShortcut);
  window.webContents.on("before-input-event", tabShortcut);
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
    browserSession = createBrowserSession();
    for (const view of closingViews) {
      if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
    }
  });
  window.webContents.on("did-finish-load", publish);
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(path.join(__dirname, "../dist/index.html"));
  newTab();
}

app.setName("Browser");
const profileDirectory = app.commandLine.getSwitchValue("user-data-dir");
if (profileDirectory) app.setPath("userData", path.resolve(profileDirectory));
app.whenReady().then(() => {
  settingsStore = createSettingsStore(path.join(app.getPath("userData"), "settings.json"));
  settings = settingsStore.get();
  nativeTheme.themeSource = settings.theme;
  nativeTheme.on("updated", updateTheme);
  session
    .fromPartition("persist:browsing")
    .setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.fromPartition("persist:browsing").setPermissionCheckHandler(() => false);
  installIpc();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      {
        label: "File",
        submenu: [
          {
            label: "New tab",
            accelerator: "CmdOrCtrl+T",
            click: () => {
              if (!window) createWindow();
              else newTab();
            },
          },
          {
            label: "Close tab",
            accelerator: "CmdOrCtrl+W",
            click: () => {
              if (window) {
                if (sessionState().palette) closePalette();
                else if (sessionState().settingsOpen) showSettings(false);
                else closeTab(sessionState().activeId);
              }
            },
          },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          {
            label: "Settings…",
            accelerator: "CmdOrCtrl+,",
            click: () => {
              if (window) showSettings(true);
            },
          },
          {
            label: "Open address palette",
            accelerator: "CmdOrCtrl+L",
            click: () => {
              if (window) openPalette("navigate");
            },
          },
          {
            label: "Command palette",
            accelerator: "CmdOrCtrl+K",
            click: () => {
              if (window) openPalette("commands");
            },
          },
          {
            label: "Reload page",
            accelerator: "CmdOrCtrl+R",
            click: () => {
              if (window) reload();
            },
          },
          { label: "Back", accelerator: "Alt+Left", click: () => history("back") },
          { label: "Forward", accelerator: "Alt+Right", click: () => history("forward") },
          {
            label: "Next tab",
            accelerator: "CmdOrCtrl+Shift+]",
            click: () => {
              if (window) cycleTab(1);
            },
          },
          {
            label: "Previous tab",
            accelerator: "CmdOrCtrl+Shift+[",
            click: () => {
              if (window) cycleTab(-1);
            },
          },
          { type: "separator" },
          { role: "togglefullscreen" },
          {
            label: "Developer tools",
            accelerator: "CmdOrCtrl+Alt+I",
            click: () => {
              if (window)
                (activeTab()?.url ? activeView().webContents : window.webContents).toggleDevTools();
            },
          },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
  createWindow();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
