// @ts-check
const { contextBridge, ipcRenderer } = require("electron");

/** @type {import('../shared/browser').BrowserApi} */
const browser = {
  reportPageLayout: (regions) => ipcRenderer.invoke("browser:page-layout", regions),
  openPalette: (mode = "commands") => ipcRenderer.invoke("browser:palette-open", mode),
  closePalette: () => ipcRenderer.invoke("browser:palette-close"),
  executePalette: (action) => ipcRenderer.invoke("browser:palette-execute", action),
  toggleSplit: () => ipcRenderer.invoke("browser:toggle-split"),
  setSplitTab: (side, id) => ipcRenderer.invoke("browser:set-split-tab", side, id),
  resizeSplit: (ratio) => ipcRenderer.invoke("browser:resize-split", ratio),
  setSplitResizing: (resizing) => ipcRenderer.invoke("browser:set-split-resizing", resizing),
  updateSettings: (settings) => ipcRenderer.invoke("browser:update-settings", settings),
  openSettings: () => ipcRenderer.invoke("browser:open-settings"),
  closeSettings: () => ipcRenderer.invoke("browser:close-settings"),
  setTabLayout: (layout) => ipcRenderer.invoke("browser:set-tab-layout", layout),
  getState: () => ipcRenderer.invoke("browser:state"),
  newTab: () => ipcRenderer.invoke("browser:new-tab"),
  selectTab: (id) => ipcRenderer.invoke("browser:select-tab", id),
  cycleTab: (direction) => ipcRenderer.invoke("browser:cycle-tab", direction),
  selectTabPosition: (position) => ipcRenderer.invoke("browser:select-tab-position", position),
  closeTab: (id) => ipcRenderer.invoke("browser:close-tab", id),
  navigate: (input) => ipcRenderer.invoke("browser:navigate", input),
  back: () => ipcRenderer.invoke("browser:back"),
  forward: () => ipcRenderer.invoke("browser:forward"),
  reload: () => ipcRenderer.invoke("browser:reload"),
  stop: () => ipcRenderer.invoke("browser:stop"),
  onState: (callback) => {
    /** @param {import('electron').IpcRendererEvent} _event
     * @param {import('../shared/browser').BrowserState} state */
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("browser:state-changed", listener);
    return () => {
      ipcRenderer.removeListener("browser:state-changed", listener);
    };
  },
  onFocusAddress: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("browser:focus-address", listener);
    return () => {
      ipcRenderer.removeListener("browser:focus-address", listener);
    };
  },
};

contextBridge.exposeInMainWorld("browser", browser);
