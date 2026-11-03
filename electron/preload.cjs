// @ts-check
const { contextBridge, ipcRenderer } = require("electron");

/** @type {import('../shared/browser').BrowserApi} */
const browser = {
  updateSettings: (settings) => ipcRenderer.invoke("browser:update-settings", settings),
  openSettings: () => ipcRenderer.invoke("browser:open-settings"),
  closeSettings: () => ipcRenderer.invoke("browser:close-settings"),
  setTabLayout: (layout) => ipcRenderer.invoke("browser:set-tab-layout", layout),
  getState: () => ipcRenderer.invoke("browser:state"),
  newTab: () => ipcRenderer.invoke("browser:new-tab"),
  selectTab: (id) => ipcRenderer.invoke("browser:select-tab", id),
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
