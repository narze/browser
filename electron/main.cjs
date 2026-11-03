const { app, BrowserWindow, WebContentsView, ipcMain, Menu, session } = require("electron");
const path = require("node:path");
const { resolveAddress } = require("./navigation.cjs");
const { isWebUrl, isTabId, canOpenPopup } = require("./policy.cjs");

// Prototype: tabs are in memory. Remote pages never receive the chrome preload.
const CHROME_HEIGHT = 100;
const SIDEBAR_WIDTH = 220;
let tabLayout = "top";
let window;
let tabs = [];
let activeId;
let nextId = 1;

const activeTab = () => tabs.find((tab) => tab.id === activeId);

function getState() {
  return {
    tabLayout,
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
}

function layout() {
  if (!window || window.isDestroyed()) return;
  const [width, height] = window.getContentSize();
  const sidebarWidth = tabLayout === "top" ? 0 : SIDEBAR_WIDTH;
  for (const tab of tabs) {
    tab.view.setBounds({
      x: tabLayout === "left" ? sidebarWidth : 0,
      y: CHROME_HEIGHT,
      width: Math.max(1, width - sidebarWidth),
      height: Math.max(1, height - CHROME_HEIGHT),
    });
    tab.view.setVisible(tab.id === activeId && !!tab.url && !tab.error);
  }
}

function focusAddress() {
  window.webContents.focus();
  window.webContents.send("browser:focus-address");
}

function selectTab(id) {
  if (!tabs.some((tab) => tab.id === id)) return;
  activeId = id;
  layout();
  publish();
  const tab = activeTab();
  if (tab.url && !tab.error) tab.view.webContents.focus();
  else focusAddress();
}

function load(tab, url) {
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
  const [tab] = tabs.splice(index, 1);
  window.contentView.removeChildView(tab.view);
  tab.view.webContents.close({ waitForBeforeUnload: false });
  if (!tabs.length) newTab();
  else if (activeId === id) selectTab(tabs[Math.min(index, tabs.length - 1)].id);
  else publish();
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

function installIpc() {
  const handlers = {
    "set-tab-layout": (value) => {
      if (!["top", "left", "right"].includes(value)) throw new Error("Invalid tab layout.");
      tabLayout = value;
      layout();
      publish();
    },
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
        const url = resolveAddress(input);
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
      if (
        event.sender !== window?.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      ) {
        throw new Error("Browser controls are only available to the app interface.");
      }
      return handler(...args);
    });
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 640,
    minHeight: 420,
    title: "Browser",
    backgroundColor: "#f5f7fa",
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
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.on("resize", layout);
  window.on("closed", () => {
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
app.whenReady().then(() => {
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
              if (window) closeTab(activeId);
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
            label: "Focus address",
            accelerator: "CmdOrCtrl+L",
            click: () => {
              if (window) focusAddress();
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
