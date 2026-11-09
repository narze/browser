const path = require("node:path");
const { ElectronChromeExtensions } = require("electron-chrome-extensions");

function createExtensionSupport({ ipcMain, adapter }) {
  const sessions = new Map();
  function caller(event) {
    const worker = event.type === "service-worker";
    const session = worker ? event.session : event.sender.session;
    const support = sessions.get(session);
    const source = worker ? event.serviceWorker.scope : event.senderFrame?.url;
    const url = new URL(source);
    const extension = session.extensions.getExtension(url.hostname);
    if (
      !support ||
      url.protocol !== "chrome-extension:" ||
      !extension ||
      (!worker && event.senderFrame !== event.sender.mainFrame)
    )
      throw new Error("Only an installed extension can use browser extension APIs.");
    return { support, extension, host: worker ? event.serviceWorker : event.senderFrame };
  }
  async function handle(event, method, ...args) {
    try {
      const { support, extension, host } = caller(event);
      support.hosts.set(host, extension.id);
      const permissions = extension.manifest.permissions ?? [];
      const permission = method.startsWith("debugger.")
        ? "debugger"
        : method.startsWith("storage.")
          ? "storage"
          : method.startsWith("tabGroups.") || ["tabs.group", "tabs.ungroup"].includes(method)
            ? "tabGroups"
            : null;
      if (permission && !permissions.includes(permission))
        throw new Error(`Missing ${permission} permission.`);
      return { value: await support.invoke(extension.id, method, args) };
    } catch (error) {
      return { error: error.message };
    }
  }
  ipcMain.handle("browser:extension-api", handle);
  return {
    configure(profile, session) {
      const hosts = new Map();
      const storage = new Map();
      const attachments = new Map();
      const groups = new Map();
      const membership = new Map();
      let nextGroupId = 1;
      let syncing = false;
      let chrome;
      const tabs = () => adapter.tabs(profile);
      const tab = (id) => {
        const found = tabs().find((tab) => tab.id === id);
        if (!found) throw new Error("Tab not found in this space.");
        return found;
      };
      const emit = (id, name, ...args) => {
        for (const [host, owner] of hosts) {
          try {
            if (host.isDestroyed() || (host.url && new URL(host.url).hostname !== owner)) {
              hosts.delete(host);
              continue;
            }
            if (!id || id === owner) host.send("browser:extension-event", name, args);
          } catch {
            hosts.delete(host);
          }
        }
      };
      const group = (id) => {
        const found = groups.get(id);
        if (!found) throw new Error("Tab group not found in this space.");
        return found;
      };
      const forgetEmptyGroups = () => {
        for (const [id, item] of groups)
          if (![...membership.values()].includes(id)) {
            groups.delete(id);
            emit(null, "tabGroups.onRemoved", item);
          }
      };
      const changed = (contents) => contents.emit("tab-updated");
      const invoke = async (id, method, args) => {
        if (method.startsWith("storage.session.")) {
          if (!storage.has(id)) storage.set(id, {});
          const data = storage.get(id);
          const keys = args[0];
          if (method === "storage.session.get") {
            if (keys == null) return { ...data };
            return Object.fromEntries(
              (typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys))
                .filter((key) => key in data || (typeof keys === "object" && !Array.isArray(keys)))
                .map((key) => [key, key in data ? data[key] : keys[key]]),
            );
          }
          if (method === "storage.session.getBytesInUse")
            return Buffer.byteLength(JSON.stringify(data));
          if (method === "storage.session.set") Object.assign(data, keys);
          else if (method === "storage.session.remove")
            for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
          else if (method === "storage.session.clear") storage.set(id, {});
          else throw new Error("Unsupported storage operation.");
          return;
        }
        if (method === "action.setBadgeTextColor") return; // No text badges in this UI yet.
        if (method.startsWith("debugger.")) {
          const target = args[0];
          const contents = tab(target?.tabId);
          if (!/^(https?:|about:blank$|$)/.test(contents.getURL()))
            throw new Error("This page cannot be debugged by an extension.");
          let entry = attachments.get(contents.id);
          if (method === "debugger.attach") {
            if (entry) throw new Error("A debugger is already attached.");
            contents.debugger.attach(args[1] ?? "1.3");
            entry = { owner: id, sessions: new Set() };
            attachments.set(contents.id, entry);
            const message = (_event, name, params, sessionId) => {
              if (name === "Target.attachedToTarget") entry.sessions.add(params.sessionId);
              if (name === "Target.detachedFromTarget") entry.sessions.delete(params.sessionId);
              emit(
                id,
                "debugger.onEvent",
                { tabId: contents.id, ...(sessionId ? { sessionId } : {}) },
                name,
                params,
              );
            };
            const detached = (_event, reason) => {
              attachments.delete(contents.id);
              contents.debugger.off("message", message);
              emit(id, "debugger.onDetach", { tabId: contents.id }, reason);
            };
            contents.debugger.on("message", message);
            contents.debugger.once("detach", detached);
            return;
          }
          if (!entry || entry.owner !== id)
            throw new Error("The extension has not attached to this tab.");
          if (method === "debugger.detach") {
            contents.debugger.detach();
            return;
          }
          if (method !== "debugger.sendCommand") throw new Error("Unsupported debugger operation.");
          const [, command, params = {}] = args;
          if (target.sessionId && !entry.sessions.has(target.sessionId))
            throw new Error("Unknown child debugger session.");
          if (
            typeof command !== "string" ||
            (/^(Browser|SystemInfo)\./.test(command) && command !== "Browser.getVersion") ||
            (command.startsWith("Target.") &&
              !["Target.setAutoAttach", "Target.getTargetInfo", "Target.detachFromTarget"].includes(
                command,
              )) ||
            params.targetId
          )
            throw new Error("Browser-wide debugger commands are not allowed.");
          if (command === "Page.navigate" && !/^https?:|^about:blank$/.test(params.url))
            throw new Error("Only web pages can be opened.");
          const result = await contents.debugger.sendCommand(command, params, target.sessionId);
          return result;
        }
        if (method === "tabs.group") {
          const options = args[0];
          const members = (Array.isArray(options.tabIds) ? options.tabIds : [options.tabIds]).map(
            tab,
          );
          if (!members.length) throw new Error("A tab group needs at least one tab.");
          const windowId = adapter.windowFor(members[0]).id;
          if (members.some((contents) => adapter.windowFor(contents).id !== windowId))
            throw new Error("Tabs must share a window.");
          const item =
            options.groupId === undefined
              ? { id: nextGroupId++, windowId, title: "", color: "grey", collapsed: false }
              : group(options.groupId);
          if (item.windowId !== windowId) throw new Error("Tab group belongs to another window.");
          const created = !groups.has(item.id);
          groups.set(item.id, item);
          for (const contents of members) {
            membership.set(contents.id, item.id);
            changed(contents);
          }
          if (created) emit(null, "tabGroups.onCreated", item);
          forgetEmptyGroups();
          return item.id;
        }
        if (method === "tabs.ungroup") {
          for (const contents of (Array.isArray(args[0]) ? args[0] : [args[0]]).map(tab)) {
            membership.delete(contents.id);
            changed(contents);
          }
          forgetEmptyGroups();
          return;
        }
        if (method === "tabs.move") {
          const members = (Array.isArray(args[0]) ? args[0] : [args[0]]).map(tab);
          await adapter.moveTabs(profile, members, args[1]);
          const result = members.map((contents) => chrome.api.tabs.get({}, contents.id));
          return Array.isArray(args[0]) ? result : result[0];
        }
        if (method === "tabGroups.query")
          return [...groups.values()].filter((item) =>
            Object.entries(args[0] ?? {}).every(([key, value]) => item[key] === value),
          );
        if (method === "tabGroups.get") return group(args[0]);
        if (method === "tabGroups.update") {
          const item = group(args[0]);
          for (const key of ["title", "color", "collapsed"])
            if (args[1][key] !== undefined) item[key] = args[1][key];
          emit(null, "tabGroups.onUpdated", item);
          return item;
        }
        if (method === "tabGroups.move") {
          const item = group(args[0]);
          await adapter.moveTabs(
            profile,
            tabs().filter((contents) => membership.get(contents.id) === item.id),
            args[1],
          );
          emit(null, "tabGroups.onMoved", item);
          return item;
        }
        throw new Error("Unsupported extension API.");
      };
      const support = { hosts, invoke };
      sessions.set(session, support);
      for (const type of ["frame", "service-worker"])
        session.registerPreloadScript({
          type,
          filePath: path.join(__dirname, "extension-api-preload.cjs"),
        });
      session.serviceWorkers.on("running-status-changed", ({ versionId, runningStatus }) => {
        if (runningStatus !== "starting") return;
        const worker = session.serviceWorkers.getWorkerFromVersionID(versionId);
        if (worker?.scope.startsWith("chrome-extension://"))
          worker.ipc.handle("browser:extension-api", handle);
      });
      chrome = new ElectronChromeExtensions({
        session,
        createTab: (details) => adapter.createTab(profile, details),
        selectTab: (contents) => {
          if (!syncing) adapter.selectTab(contents);
        },
        removeTab: (contents) => adapter.removeTab(contents),
        createWindow: (details) => adapter.createWindow(profile, details),
        removeWindow: (host) => {
          if (host !== adapter.mainWindow()) host.close();
          else throw new Error("The main browser window cannot be closed by an extension.");
        },
        assignTabDetails: (details, contents) => {
          details.groupId = membership.get(contents.id) ?? -1;
          adapter.assignTabDetails(details, contents);
        },
        requestPermissions: async () => false,
      });
      session.extensions.on("extension-unloaded", (_event, extension) => {
        storage.delete(extension.id);
        for (const [tabId, entry] of attachments)
          if (entry.owner === extension.id) {
            const contents = tabs().find((contents) => contents.id === tabId);
            if (contents?.debugger.isAttached()) contents.debugger.detach();
          }
      });
      return {
        activate(id, contents) {
          // The pinned library's action implementation also dispatches actions
          // without a popup, such as Browse's "lend this tab" button.
          chrome.api.browserAction.activateClick({ extensionId: id, tabId: contents.id });
        },
        addTab(contents, host) {
          syncing = true;
          try {
            chrome.addTab(contents, host);
          } finally {
            syncing = false;
          }
          contents.once("destroyed", () => {
            membership.delete(contents.id);
            forgetEmptyGroups();
          });
        },
        selectTab(contents) {
          syncing = true;
          try {
            chrome.selectTab(contents);
          } finally {
            syncing = false;
          }
        },
      };
    },
  };
}

module.exports = { createExtensionSupport };
