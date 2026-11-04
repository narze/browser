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

// Prototype: tabs are in memory. Remote pages never receive the chrome preload.
const CHROME_HEIGHT = 100;
const SIDEBAR_WIDTH = 220;
let settingsStore;
let settings;
let settingsOpen = false;
let window;
let tabs = [];
let activeId;
let nextId = 1;
let split = null;
let splitResizing = false;
let palette = null;
let paletteView;
let paletteRequestId = 0;

const activeTab = () => tabs.find((tab) => tab.id === activeId);

function getState() {
  return {
    palette,
    split,
    splitResizing,
    resolvedTheme: nativeTheme.shouldUseDarkColors ? "dark" : "light",
    tabLayout: settings.tabLayout,
    settings,
    settingsOpen,
    activeId,
    platform: process.platform,
    tabs: tabs.map(({ id, url, title, loading, error, view }) => ({
      id,
      url,
      title,
      loading,
      error,
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
    })),
  };
}

function publish() {
  if (window && !window.isDestroyed()) window.webContents.send("browser:state-changed", getState());
  if (paletteView && !paletteView.webContents.isDestroyed())
    paletteView.webContents.send("browser:state-changed", getState());
}

function layout() {
  if (!window || window.isDestroyed()) return;
  const [width, height] = window.getContentSize();
  if (paletteView && palette) paletteView.setBounds({ x: 0, y: 0, width, height });
  const sidebarWidth = settings.tabLayout === "top" ? 0 : SIDEBAR_WIDTH;
  const contentWidth = width - sidebarWidth;
  const originX = settings.tabLayout === "left" ? sidebarWidth : 0;
  const leftWidth = split ? Math.round((contentWidth - 8) * split.ratio) : contentWidth;
  for (const tab of tabs) {
    const side = split ? split.tabIds.indexOf(tab.id) : -1;
    const inSplit = side !== -1;
    tab.view.setBounds({
      x: originX + (side === 1 ? leftWidth + 8 : 0),
      y: CHROME_HEIGHT + (inSplit ? 36 : 0),
      width: Math.max(
        1,
        inSplit ? (side === 0 ? leftWidth : contentWidth - leftWidth - 8) : contentWidth,
      ),
      height: Math.max(1, height - CHROME_HEIGHT - (inSplit ? 36 : 0)),
    });
    tab.view.setVisible(
      !settingsOpen &&
        !splitResizing &&
        (split ? inSplit : tab.id === activeId) &&
        !!tab.url &&
        !tab.error,
    );
  }
}

// The palette is a trusted local view above the page views, never a website preload.
function openPalette(mode = "commands") {
  if (!window || !["navigate", "commands"].includes(mode)) return;
  splitResizing = false;
  palette = {
    query: mode === "navigate" ? activeTab()?.url || "" : "",
    mode,
    requestId: ++paletteRequestId,
  };
  if (!paletteView) {
    paletteView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
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
      if (palette) paletteView.webContents.focus();
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
  if (!palette) return;
  palette = null;
  paletteView.setVisible(false);
  window.contentView.removeChildView(paletteView);
  publish();
  if (restoreFocus) {
    const tab = activeTab();
    if (!settingsOpen && tab?.url && !tab.error) tab.view.webContents.focus();
    else window.webContents.focus();
  }
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
  if (!palette || !action || typeof action !== "object")
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
        tab.view.webContents.focus();
      }
    } else if (action.type === "tab") {
      if (!isTabId(action.id) || !tabs.some((tab) => tab.id === action.id))
        throw new Error("That tab is no longer open.");
      selectTab(action.id);
    } else if (action.type === "command") {
      const preferences = {
        "theme-system": { theme: "system" },
        "theme-light": { theme: "light" },
        "theme-dark": { theme: "dark" },
        "tabs-top": { tabLayout: "top" },
        "tabs-left": { tabLayout: "left" },
        "tabs-right": { tabLayout: "right" },
      };
      const commands = {
        "new-tab": () => newTab(),
        "close-tab": () => closeTab(activeId),
        settings: () => showSettings(true),
        split: toggleSplit,
        reload,
        back: () => history("back"),
        forward: () => history("forward"),
      };
      if (Object.hasOwn(preferences, action.id)) {
        const result = updateSettings(preferences[action.id]);
        if (result.error) return result;
        closePalette();
      } else if (Object.hasOwn(commands, action.id)) {
        closePalette();
        commands[action.id]();
      } else throw new Error("Unknown command.");
    } else throw new Error("Unknown palette action.");
    return {};
  } catch (error) {
    return { error: error.message };
  }
}

function focusAddress() {
  if (settingsOpen) showSettings(false);
  window.webContents.focus();
  window.webContents.send("browser:focus-address");
}

function selectTab(id) {
  if (!tabs.some((tab) => tab.id === id)) return;
  closePalette(false);
  if (split && !split.tabIds.includes(id)) {
    split.tabIds[split.tabIds.indexOf(activeId) === 1 ? 1 : 0] = id;
  }
  splitResizing = false;
  settingsOpen = false;
  activeId = id;
  layout();
  publish();
  const tab = activeTab();
  if (tab.url && !tab.error) tab.view.webContents.focus();
  else focusAddress();
}

function load(tab, url) {
  closePalette(false);
  settingsOpen = false;
  tab.url = url;
  tab.error = null;
  tab.loading = !!url;
  if (!url) {
    tab.title = "New tab";
    tab.view.webContents.stop();
    // Release the previous page when returning to the new-tab screen.
    void tab.view.webContents.loadURL("about:blank").catch(() => {});
  } else {
    tab.title = new URL(url).hostname;
    void tab.view.webContents.loadURL(url).catch(() => {
      // did-fail-load owns the visible error state, including redirects.
    });
  }
  layout();
  publish();
}

function newTab(url = "") {
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: "persist:browsing",
    },
  });
  const tab = { id: nextId++, url: "", title: "New tab", loading: false, error: null, view };
  tabs.push(tab);
  window.contentView.addChildView(view);
  const contents = view.webContents;
  contents.on("focus", () => {
    if (
      split &&
      split.tabIds.includes(tab.id) &&
      !settingsOpen &&
      !splitResizing &&
      activeId !== tab.id
    ) {
      activeId = tab.id;
      publish();
    }
  });
  let lastPopupAt = -Infinity;
  contents.on("did-start-loading", () => {
    if (tab.url) tab.loading = true;
    publish();
  });
  contents.on("did-stop-loading", () => {
    tab.loading = false;
    publish();
  });
  contents.on("page-title-updated", (_event, title) => {
    if (tab.url) tab.title = title || new URL(tab.url).hostname;
    publish();
  });
  const navigated = (_event, nextUrl) => {
    if (!isWebUrl(nextUrl)) return;
    tab.url = nextUrl;
    tab.error = null;
    layout();
    publish();
  };
  contents.on("did-navigate", navigated);
  contents.on("did-navigate-in-page", (event, nextUrl, isMainFrame) => {
    if (isMainFrame) navigated(event, nextUrl);
  });
  contents.on("did-fail-load", (_event, code, description, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3 || !tab.url) return;
    tab.loading = false;
    tab.error = `Could not open ${failedUrl || tab.url}. ${description}`;
    layout();
    publish();
  });
  contents.on("render-process-gone", () => {
    tab.loading = false;
    tab.error = "This tab stopped responding. Reload to try again.";
    layout();
    publish();
  });
  for (const event of ["will-navigate", "will-redirect"]) {
    contents.on(event, (event, targetUrl) => {
      if (!isWebUrl(targetUrl)) event.preventDefault();
    });
  }
  contents.setWindowOpenHandler(({ url: targetUrl }) => {
    const now = performance.now();
    if (isWebUrl(targetUrl) && canOpenPopup(lastPopupAt, now)) {
      lastPopupAt = now;
      newTab(targetUrl);
    }
    return { action: "deny" };
  });
  contents.on("before-input-event", paletteShortcut);
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.control && input.key === "Tab") {
      event.preventDefault();
      cycleTab(input.shift ? -1 : 1);
    }
    if ((input.meta || input.control) && /^[1-9]$/.test(input.key)) {
      const index = input.key === "9" ? tabs.length - 1 : Number(input.key) - 1;
      if (tabs[index]) {
        event.preventDefault();
        selectTab(tabs[index].id);
      }
    }
    if (input.key === "Escape" && tab.loading) contents.stop();
  });
  if (url) load(tab, url);
  selectTab(tab.id);
  return tab.id;
}

function closeTab(id) {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  if (split?.tabIds.includes(id)) {
    activeId = split.tabIds.find((tabId) => tabId !== id);
    split = null;
    splitResizing = false;
  }
  const [tab] = tabs.splice(index, 1);
  window.contentView.removeChildView(tab.view);
  tab.view.webContents.close({ waitForBeforeUnload: false });
  if (!tabs.length) newTab();
  else if (activeId === id) selectTab(tabs[Math.min(index, tabs.length - 1)].id);
  else {
    layout();
    publish();
  }
}

function toggleSplit() {
  if (split) {
    split = null;
    splitResizing = false;
    selectTab(activeId);
    return;
  }
  const originalId = activeId;
  const other = tabs.find((tab) => tab.id !== originalId);
  const otherId = other?.id ?? newTab();
  split = { tabIds: [originalId, otherId], ratio: 0.5 };
  selectTab(other ? originalId : otherId);
}

function cycleTab(direction) {
  const index = tabs.findIndex((tab) => tab.id === activeId);
  selectTab(tabs[(index + direction + tabs.length) % tabs.length].id);
}

function reload() {
  const tab = activeTab();
  if (!tab?.url) return;
  if (tab.error) load(tab, tab.url);
  else tab.view.webContents.reload();
}

function history(direction) {
  const navigation = activeTab()?.view.webContents.navigationHistory;
  if (direction === "back" && navigation?.canGoBack()) navigation.goBack();
  if (direction === "forward" && navigation?.canGoForward()) navigation.goForward();
}

function showSettings(open) {
  closePalette(false);
  splitResizing = false;
  settingsOpen = open;
  layout();
  publish();
  if (!open && activeTab()?.url && !activeTab()?.error) activeTab().view.webContents.focus();
  else window.webContents.focus();
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
    "palette-open": (mode) => {
      if (!["navigate", "commands"].includes(mode)) throw new Error("Invalid palette mode.");
      openPalette(mode);
    },
    "palette-close": () => closePalette(),
    "palette-execute": executePalette,
    "toggle-split": toggleSplit,
    "set-split-tab": (side, id) => {
      if (!split || ![0, 1].includes(side) || !isTabId(id) || !tabs.some((tab) => tab.id === id))
        throw new Error("Invalid split tab.");
      const opposite = 1 - side;
      if (split.tabIds[opposite] === id) split.tabIds[opposite] = split.tabIds[side];
      split.tabIds[side] = id;
      selectTab(id);
    },
    "resize-split": (ratio) => {
      if (typeof ratio !== "number" || !Number.isFinite(ratio))
        throw new Error("Invalid split ratio.");
      if (split) {
        split.ratio = Math.max(0.25, Math.min(0.75, ratio));
        layout();
        publish();
      }
    },
    "set-split-resizing": (resizing) => {
      if (typeof resizing !== "boolean") throw new Error("Invalid resize state.");
      splitResizing = !!split && !settingsOpen && resizing;
      layout();
      publish();
    },
    "open-settings": () => showSettings(true),
    "close-settings": () => showSettings(false),
    "update-settings": updateSettings,
    "set-tab-layout": (value) => updateSettings({ tabLayout: value }),
    state: getState,
    "new-tab": () => newTab(),
    "select-tab": (id) => {
      if (!isTabId(id)) throw new Error("Invalid tab ID.");
      selectTab(id);
    },
    "close-tab": (id) => {
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
        if (url) tab.view.webContents.focus();
        return {};
      } catch (error) {
        return { error: error.message };
      }
    },
    back: () => history("back"),
    forward: () => history("forward"),
    reload,
    stop: () => activeTab()?.view.webContents.stop(),
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(`browser:${channel}`, (event, ...args) => {
      const fromChrome = event.sender === window?.webContents;
      const fromPalette =
        event.sender === paletteView?.webContents &&
        ["state", "palette-close", "palette-execute"].includes(channel);
      if ((!fromChrome && !fromPalette) || event.senderFrame !== event.sender.mainFrame) {
        throw new Error("Browser controls are only available to the app interface.");
      }
      return handler(...args);
    });
  }
}

function createWindow() {
  settingsOpen = false;
  split = null;
  splitResizing = false;
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
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on("before-input-event", paletteShortcut);
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.on("resize", layout);
  window.on("closed", () => {
    palette = null;
    if (paletteView && !paletteView.webContents.isDestroyed())
      paletteView.webContents.close({ waitForBeforeUnload: false });
    paletteView = null;
    const closingTabs = tabs;
    tabs = [];
    window = null;
    for (const tab of closingTabs) {
      if (!tab.view.webContents.isDestroyed())
        tab.view.webContents.close({ waitForBeforeUnload: false });
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
                if (palette) closePalette();
                else if (settingsOpen) showSettings(false);
                else closeTab(activeId);
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
                (activeTab()?.url
                  ? activeTab().view.webContents
                  : window.webContents
                ).toggleDevTools();
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
