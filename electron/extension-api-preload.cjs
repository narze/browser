// Sandboxed frame/worker preload. Only extension contexts receive this bridge.
const { contextBridge, ipcRenderer } = require("electron");
if (process.type === "service-worker" || location.protocol === "chrome-extension:") {
  contextBridge.exposeInMainWorld("browserExtensionApi", {
    invoke: (method, ...args) => ipcRenderer.invoke("browser:extension-api", method, ...args),
    listen: (callback) =>
      ipcRenderer.on("browser:extension-event", (_event, name, args) => callback(name, args)),
  });
  contextBridge.executeInMainWorld({
    func: function () {
      const bridge = globalThis.browserExtensionApi;
      delete globalThis.browserExtensionApi;
      const events = new Map();
      const event = (name) => {
        const listeners = new Set();
        events.set(name, listeners);
        return {
          addListener: (callback) => listeners.add(callback),
          removeListener: (callback) => listeners.delete(callback),
          hasListener: (callback) => listeners.has(callback),
          hasListeners: () => listeners.size > 0,
        };
      };
      bridge.listen((name, args) => {
        for (const callback of events.get(name) ?? []) callback(...args);
      });
      const call =
        (method) =>
        (...args) => {
          const callback = typeof args.at(-1) === "function" ? args.pop() : null;
          const result = bridge.invoke(method, ...args).then((reply) => {
            if (reply.error) throw new Error(reply.error);
            return reply.value;
          });
          if (!callback) return result;
          result.then(callback, (error) => {
            console.error(error.message);
            callback();
          });
        };
      const chrome = globalThis.chrome;
      if (!chrome?.runtime?.id) return;
      chrome.debugger ??= {
        attach: call("debugger.attach"),
        detach: call("debugger.detach"),
        sendCommand: call("debugger.sendCommand"),
        onEvent: event("debugger.onEvent"),
        onDetach: event("debugger.onDetach"),
      };
      chrome.tabGroups ??= {
        TAB_GROUP_ID_NONE: -1,
        get: call("tabGroups.get"),
        query: call("tabGroups.query"),
        update: call("tabGroups.update"),
        move: call("tabGroups.move"),
        onCreated: event("tabGroups.onCreated"),
        onUpdated: event("tabGroups.onUpdated"),
        onMoved: event("tabGroups.onMoved"),
        onRemoved: event("tabGroups.onRemoved"),
      };
      Object.assign(chrome.tabs, {
        group: call("tabs.group"),
        ungroup: call("tabs.ungroup"),
        move: call("tabs.move"),
        onAttached: event("tabs.onAttached"),
        onDetached: event("tabs.onDetached"),
      });
      chrome.storage.session ??= Object.fromEntries(
        ["get", "set", "remove", "clear", "getBytesInUse"].map((name) => [
          name,
          call(`storage.session.${name}`),
        ]),
      );
      // Electron lacks this action method; the supplementary API library supplies
      // the remaining action methods. This UI does not draw text badges.
      if (chrome.action) chrome.action.setBadgeTextColor ??= call("action.setBadgeTextColor");
    },
  });
}
