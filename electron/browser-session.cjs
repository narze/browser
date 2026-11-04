/**
 * @typedef {{ type: 'new-tab', url?: string }
 * | { type: 'select-tab' | 'close-tab' | 'focus-tab', id: number }
 * | { type: 'select-position', position: number }
 * | { type: 'cycle-tab', direction: number }
 * | { type: 'navigate', id: number, url: string }
 * | { type: 'update-tab', id: number, patch: Partial<import('../shared/browser').BrowserTab> }
 * | { type: 'toggle-split' | 'close-palette' }
 * | { type: 'set-split-tab', side: number, id: number }
 * | { type: 'resize-split', ratio: number }
 * | { type: 'set-split-resizing', resizing: boolean }
 * | { type: 'show-settings', open: boolean }
 * | { type: 'open-palette', mode: 'navigate' | 'commands' }} SessionCommand
 */

function createBrowserSession() {
  /** @type {import('../shared/browser').BrowserTab[]} */
  const tabs = [];
  let activeId = 0;
  let nextId = 1;
  /** @type {import('../shared/browser').BrowserState['split']} */
  let split = null;
  let splitResizing = false;
  let settingsOpen = false;
  /** @type {import('../shared/browser').BrowserState['palette']} */
  let palette = null;
  let paletteRequestId = 0;
  /** @type {number[] | null} */
  let cycleOrder = null;

  function getState() {
    /** @type {number[][]} */
    const tabSlots = [];
    let grouped = false;
    for (const tab of tabs) {
      if (!split?.tabIds.includes(tab.id)) tabSlots.push([tab.id]);
      else if (!grouped) {
        tabSlots.push([...split.tabIds]);
        grouped = true;
      }
    }
    const pages = tabs.map((tab) => ({
      id: tab.id,
      visible:
        !settingsOpen &&
        !splitResizing &&
        !!tab.url &&
        !tab.error &&
        (split ? split.tabIds.includes(tab.id) : tab.id === activeId),
    }));
    return structuredClone({
      tabs,
      activeId,
      split,
      splitResizing,
      settingsOpen,
      palette,
      tabSlots,
      pages,
    });
  }

  /** @param {number} id */
  function select(id) {
    if (!tabs.some((tab) => tab.id === id)) return false;
    if (split && !split.tabIds.includes(id)) {
      split.tabIds[split.tabIds.indexOf(activeId) === 1 ? 1 : 0] = id;
    }
    activeId = id;
    settingsOpen = splitResizing = false;
    palette = null;
    return true;
  }

  /** @param {SessionCommand} command */
  function dispatch(command) {
    // Pane replacement can move a tab slot while cycling. Keep one traversal's
    // initial visual order so every tab remains reachable in both directions.
    if (command.type !== "cycle-tab" && command.type !== "update-tab") cycleOrder = null;
    /** @type {({ type: 'load', id: number, url: string } | { type: 'focus' })[]} */
    const effects = [];
    const focus = () => effects.push({ type: "focus" });
    const createTab = (url = "") => {
      const id = nextId++;
      tabs.push({
        id,
        url,
        title: url ? new URL(url).hostname : "New tab",
        loading: !!url,
        error: null,
        canGoBack: false,
        canGoForward: false,
      });
      if (url) effects.push({ type: "load", id, url });
      return id;
    };
    switch (command.type) {
      case "new-tab":
        select(createTab(command.url));
        focus();
        break;
      case "select-tab":
        if (select(command.id)) focus();
        break;
      case "select-position":
      case "cycle-tab": {
        const order =
          command.type === "cycle-tab"
            ? (cycleOrder ??= getState().tabSlots.flat())
            : getState().tabSlots.flat();
        const index =
          command.type === "select-position"
            ? command.position === 9
              ? order.length - 1
              : command.position - 1
            : (order.indexOf(activeId) + command.direction + order.length) % order.length;
        if (select(order[index])) focus();
        break;
      }
      case "close-tab": {
        const index = tabs.findIndex((tab) => tab.id === command.id);
        if (index < 0) break;
        let replacement;
        if (split?.tabIds.includes(command.id)) {
          replacement = split.tabIds.find((id) => id !== command.id);
          split = null;
          splitResizing = false;
        }
        tabs.splice(index, 1);
        if (!tabs.length) replacement = createTab();
        else if (activeId === command.id && replacement === undefined)
          replacement = tabs[Math.min(index, tabs.length - 1)].id;
        if (replacement !== undefined && select(replacement)) focus();
        break;
      }
      case "toggle-split":
        if (split) split = null;
        else if (tabs.length) {
          const originalId = activeId;
          const other = tabs.find((tab) => tab.id !== originalId);
          const otherId = other?.id ?? createTab();
          split = { tabIds: [originalId, otherId], ratio: 0.5 };
          activeId = other ? originalId : otherId;
        }
        if (select(activeId)) focus();
        break;
      case "set-split-tab": {
        if (!split || ![0, 1].includes(command.side) || !tabs.some((tab) => tab.id === command.id))
          throw new Error("Invalid split tab.");
        const opposite = 1 - command.side;
        if (split.tabIds[opposite] === command.id)
          split.tabIds[opposite] = split.tabIds[command.side];
        split.tabIds[command.side] = command.id;
        select(command.id);
        focus();
        break;
      }
      case "resize-split":
        if (typeof command.ratio !== "number" || !Number.isFinite(command.ratio))
          throw new Error("Invalid split ratio.");
        if (split) split.ratio = Math.max(0.25, Math.min(0.75, command.ratio));
        break;
      case "set-split-resizing":
        if (typeof command.resizing !== "boolean") throw new Error("Invalid resize state.");
        splitResizing = !!split && !settingsOpen && !palette && command.resizing;
        break;
      case "show-settings":
        settingsOpen = command.open;
        splitResizing = false;
        palette = null;
        focus();
        break;
      case "open-palette":
        if (!["commands", "navigate"].includes(command.mode))
          throw new Error("Invalid palette mode.");
        splitResizing = false;
        palette = {
          mode: command.mode,
          query:
            command.mode === "navigate" ? tabs.find((tab) => tab.id === activeId)?.url || "" : "",
          requestId: ++paletteRequestId,
        };
        break;
      case "close-palette":
        palette = null;
        break;
      case "focus-tab":
        if (!settingsOpen && !splitResizing && !palette && split?.tabIds.includes(command.id))
          activeId = command.id;
        break;
      case "navigate": {
        const tab = tabs.find((tab) => tab.id === command.id);
        if (!tab) break;
        settingsOpen = false;
        palette = null;
        tab.url = command.url;
        tab.title = command.url ? new URL(command.url).hostname : "New tab";
        tab.error = null;
        tab.loading = !!command.url;
        effects.push({ type: "load", id: tab.id, url: tab.url });
        break;
      }
      case "update-tab": {
        const tab = tabs.find((tab) => tab.id === command.id);
        if (tab) Object.assign(tab, command.patch, { id: tab.id });
        break;
      }
      default:
        throw new Error("Unknown session command.");
    }
    return { state: getState(), effects };
  }

  return { dispatch, getState };
}

module.exports = { createBrowserSession };
