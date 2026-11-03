import { Electroview, type WebviewTagElement } from "electrobun/view";
import type { BrowserApi, BrowserState, BrowserTab, TabLayout } from "../../shared/browser";
import type { BrowserRPC } from "../../shared/rpc";
import { resolveAddress } from "../../shared/navigation.js";
import { isWebUrl, isTabId, canOpenPopup } from "../../shared/policy.js";
import { pagePreload } from "./page-preload";

type Tab = BrowserTab & { view: WebviewTagElement; lastPopup: number };
const tabs: Tab[] = [];
let activeId = 0;
let nextId = 1;
let tabLayout: TabLayout = "top";
let platform = "";
let partition = "";
const stateListeners = new Set<(state: BrowserState) => void>();
const focusListeners = new Set<() => void>();
const layer = document.createElement("div");
layer.id = "web-pages";
document.body.append(layer);
const current = () => tabs.find((tab) => tab.id === activeId)!;
const getState = (): BrowserState => ({
  activeId,
  tabLayout,
  platform,
  tabs: tabs.map(({ view: _view, lastPopup: _lastPopup, ...tab }) => ({ ...tab })),
});
const publish = () => {
  for (const listener of stateListeners) listener(getState());
};

function layout() {
  Object.assign(layer.style, {
    position: "fixed",
    top: "100px",
    bottom: "0",
    left: tabLayout === "left" ? "220px" : "0",
    right: tabLayout === "right" ? "220px" : "0",
    pointerEvents: "none",
  });
  for (const tab of tabs) {
    const visible = tab.id === activeId && !!tab.url && !tab.error;
    // Keep DOM geometry stable. Native hiding preserves the page and history.
    tab.view.style.pointerEvents = visible ? "auto" : "none";
    if (tab.view.webviewId !== null) tab.view.toggleHidden(!visible);
    tab.view.syncDimensions(true);
  }
}

async function refresh(tab: Tab) {
  if (!tabs.includes(tab)) return;
  [tab.canGoBack, tab.canGoForward] = await Promise.all([
    tab.view.canGoBack(),
    tab.view.canGoForward(),
  ]);
  if (!tabs.includes(tab)) return;
  layout();
  publish();
}

function select(id: number) {
  if (!tabs.some((tab) => tab.id === id)) return;
  activeId = id;
  layout();
  publish();
  if (!current().url) for (const listener of focusListeners) listener();
}

function createTab() {
  const view = document.createElement("electrobun-webview");
  view.setAttribute("renderer", "cef");
  view.setAttribute("sandbox", "");
  view.setAttribute("partition", partition);
  view.setAttribute(
    "navigation-rules",
    JSON.stringify(["^*", "http://*", "https://*", "about:blank"]),
  );
  view.setAttribute("preload", pagePreload);
  view.setAttribute("src", "about:blank");
  view.style.cssText =
    "display:block;position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  const tab: Tab = {
    id: nextId++,
    title: "New tab",
    url: "",
    loading: false,
    error: null,
    canGoBack: false,
    canGoForward: false,
    view,
    lastPopup: -Infinity,
  };
  let nativeReady = false;
  tabs.push(tab);
  view.on("host-message", (event) => {
    let data = event.detail;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (data?.type !== "page-metadata" || !tab.url || !isWebUrl(data.url)) return;
    // Metadata affects only its own tab; the event channel cannot invoke BrowserApi.
    tab.url = data.url;
    tab.title =
      typeof data.title === "string"
        ? data.title.slice(0, 1024) || new URL(tab.url).hostname
        : tab.title;
    tab.loading = data.loading === true;
    void refresh(tab);
  });
  const navigated = (event: CustomEvent) => {
    nativeReady = true;
    const url = typeof event.detail === "string" ? event.detail : event.detail?.url;
    if (tab.url && isWebUrl(url)) {
      tab.url = url;
      tab.error = null;
      void refresh(tab);
    }
  };
  view.on("did-navigate", navigated);
  view.on("did-commit-navigation", navigated);
  view.on("did-navigate-in-page", navigated);
  view.on("load-started", () => {
    if (tab.url) {
      tab.loading = true;
      publish();
    }
  });
  view.on("dom-ready", () => {
    nativeReady = true;
    if (tab.url) {
      tab.loading = false;
      void refresh(tab);
    }
  });
  view.on("load-finished", (event) => {
    tab.loading = false;
    let data = event.detail;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        /* URL-only event */
      }
    }
    if (data?.errorCode && data.errorCode !== -3)
      tab.error = `Could not open ${tab.url}. ${data.errorDescription || data.errorCode}`;
    void refresh(tab);
  });
  view.on("new-window-open", (event) => {
    let data = event.detail;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        data = { url: data };
      }
    }
    const url = data?.url;
    const now = performance.now();
    if (isWebUrl(url) && canOpenPopup(tab.lastPopup, now)) {
      tab.lastPopup = now;
      createTab();
      void api.navigate(url);
    }
  });
  layer.append(view);
  // Native creation is asynchronous; hiding before it completes is ignored.
  const initialized = () => {
    if (!tabs.includes(tab)) return;
    if (view.webviewId === null) requestAnimationFrame(initialized);
    else {
      layout();
      void refresh(tab);
    }
  };
  requestAnimationFrame(initialized);
  // CEF 2.0.5 may return a native view wrapper before a newly named persistent
  // request context can create its first browser. A cached context works on the
  // next creation. Retry only before any document has committed; never reload a
  // working page or mask failures later in a browsing session.
  let creationRetries = 0;
  const checkCreation = async () => {
    if (!tabs.includes(tab) || nativeReady) return;
    if (creationRetries++ >= 2) {
      tab.loading = false;
      tab.error = "The browser view could not start. Close this tab and try again.";
      layout();
      publish();
      return;
    }
    console.warn("Retrying CEF view initialization", tab.id, creationRetries);
    await rpc.request.guardTabRemoval({});
    if (!tabs.includes(tab) || nativeReady) return;
    view.remove();
    view.webviewId = null;
    layer.append(view);
    requestAnimationFrame(initialized);
    setTimeout(() => void checkCreation(), 750);
  };
  setTimeout(() => void checkCreation(), 750);
  select(tab.id);
  return tab.id;
}

const api: BrowserApi = {
  async getState() {
    return getState();
  },
  async setTabLayout(value) {
    if (!["top", "left", "right"].includes(value)) throw new Error("Invalid layout");
    tabLayout = value;
    layout();
    publish();
  },
  async newTab() {
    return createTab();
  },
  async selectTab(id) {
    if (!isTabId(id)) throw new Error("Invalid tab ID");
    select(id);
  },
  async closeTab(id) {
    if (!tabs.some((tab) => tab.id === id)) return;
    await rpc.request.guardTabRemoval({});
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const [tab] = tabs.splice(index, 1);
    tab.view.remove();
    if (!tabs.length) createTab();
    else if (activeId === id) select(tabs[Math.min(index, tabs.length - 1)].id);
    else publish();
  },
  async navigate(input) {
    if (typeof input !== "string" || input.length > 16384)
      return { error: "Enter a valid address." };
    try {
      const url = resolveAddress(input);
      const tab = current();
      tab.url = url;
      tab.error = null;
      tab.loading = !!url;
      tab.title = url ? new URL(url).hostname : "New tab";
      tab.view.loadURL(url || "about:blank");
      layout();
      publish();
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
  async back() {
    current().view.goBack();
  },
  async forward() {
    current().view.goForward();
  },
  async reload() {
    const tab = current();
    tab.error = null;
    tab.loading = true;
    tab.view.reload();
    layout();
    publish();
  },
  async stop() {
    const tab = current();
    tab.view.executeJavascript("window.stop()");
    tab.loading = false;
    publish();
  },
  onState(callback) {
    stateListeners.add(callback);
    return () => stateListeners.delete(callback);
  },
  onFocusAddress(callback) {
    focusListeners.add(callback);
    return () => focusListeners.delete(callback);
  },
};

const rpc = Electroview.defineRPC<BrowserRPC>({
  handlers: {
    requests: {},
    messages: {
      command: ({ action }) => {
        if (action === "focusAddress") {
          window.focus();
          for (const listener of focusListeners) listener();
        } else if (action === "closeTab") void api.closeTab(activeId);
        else if (action === "nextTab" || action === "previousTab") {
          const index = tabs.findIndex((tab) => tab.id === activeId);
          select(tabs[(index + (action === "nextTab" ? 1 : -1) + tabs.length) % tabs.length].id);
        } else if (action === "devTools") current().view.toggleDevTools();
        else if (action === "newTab") void api.newTab();
        else if (action === "reload" || action === "back" || action === "forward")
          void api[action]();
      },
    },
  },
});
new Electroview({ rpc });
const config = await rpc.request.config({});
platform = config.platform;
partition = config.partition;
window.browser = api;
createTab();
window.addEventListener("resize", layout);
