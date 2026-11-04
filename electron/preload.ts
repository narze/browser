import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { browserCommands, browserEvents } from "../shared/commands.js";
import type { BrowserApi } from "../shared/browser";

// Bundled into one CommonJS file: sandboxed preloads cannot require local modules.
const commands = Object.entries(browserCommands).map(([name, { channel }]) => [
  name,
  (...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
]);
const events = Object.entries(browserEvents).map(([name, channel]) => [
  name,
  (callback: (...args: unknown[]) => void) => {
    const listener = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
]);

// The registry is checked against BrowserApi; only callbacks and arguments cross the bridge.
const browser = Object.fromEntries([...commands, ...events]) as unknown as BrowserApi;
contextBridge.exposeInMainWorld("browser", browser);
