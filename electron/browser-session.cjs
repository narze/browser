const { isWebUrl } = require("./policy.cjs");

/**
 * @typedef {import('../shared/browser').TabZone} TabZone
 * @typedef {{ type: 'new-tab', url?: string }
 * | { type: 'select-tab' | 'close-tab' | 'focus-tab' | 'reset-tab' | 'sleep-tab', id: number }
 * | { type: 'select-position', position: number }
 * | { type: 'cycle-tab', direction: number }
 * | { type: 'navigate', id: number, url: string }
 * | { type: 'update-tab', id: number, patch: Partial<import('../shared/browser').BrowserTab> }
 * | { type: 'toggle-split' | 'close-palette' | 'clear-archive' }
 * | { type: 'set-split-tab', side: number, id: number }
 * | { type: 'resize-split', ratio: number }
 * | { type: 'set-split-resizing' | 'set-sidebar-resizing', resizing: boolean }
 * | { type: 'show-settings' | 'show-archive', open: boolean }
 * | { type: 'open-palette', mode: 'navigate' | 'commands' }
 * | { type: 'move-tab', id: number, zone: TabZone, folderId?: number | null, index: number }
 * | { type: 'rename-tab', id: number, title: string }
 * | { type: 'create-folder', name?: string, tabId?: number }
 * | { type: 'rename-folder', id: number, name: string }
 * | { type: 'toggle-folder' | 'delete-folder' | 'restore-archived' | 'remove-archived', id: number }
 * | { type: 'move-folder', id: number, index: number }
 * | { type: 'tick', archiveAfter: number | null, sleepAfter: number | null, keepAwake: number[] }} SessionCommand
 * @typedef {{ type: 'load' | 'wake', id: number, url: string } | { type: 'focus' } | { type: 'edit', kind: 'tab' | 'folder', id: number }} SessionEffect
 */

const ZONES = ["favorites", "pinned", "today"];
const ARCHIVE_LIMIT = 200;
const TITLE_LIMIT = 120;
const FAVICON = /^[a-f0-9]{32}\.(png|ico|svg|jpg|gif|webp)$/;

/** @param {string} url */
const hostname = (url) => (url ? new URL(url).hostname : "New tab");
/** @param {unknown} value */
const cleanName = (value) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, TITLE_LIMIT) : "";
/** @param {unknown} value */
const isIndex = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * @param {{ now?: () => number, saved?: unknown }} [options]
 */
function createBrowserSession({ now = Date.now, saved } = {}) {
  /** @type {import('../shared/browser').BrowserTab[]} */
  const tabs = [];
  /** @type {import('../shared/browser').TabFolder[]} */
  let folders = [];
  /** @type {import('../shared/browser').ArchiveEntry[]} */
  let archive = [];
  let activeId = 0;
  let nextId = 1;
  let nextFolderId = 1;
  let nextArchiveId = 1;
  /** @type {import('../shared/browser').BrowserState['split']} */
  let split = null;
  let splitResizing = false;
  let sidebarResizing = false;
  /** @type {'settings' | 'archive' | null} */
  let screen = null;
  /** @type {import('../shared/browser').BrowserState['palette']} */
  let palette = null;
  let paletteRequestId = 0;
  /** @type {number[] | null} */
  let cycleOrder = null;
  /** @type {SessionEffect[]} */
  let effects = [];

  /** @param {string} url @param {Partial<import('../shared/browser').BrowserTab>} [fields] */
  function addTab(url, fields = {}) {
    const tab = {
      id: nextId++,
      url,
      title: hostname(url),
      loading: false,
      error: null,
      canGoBack: false,
      canGoForward: false,
      zone: /** @type {TabZone} */ ("today"),
      folderId: null,
      homeUrl: null,
      homeTitle: null,
      customTitle: null,
      favicon: null,
      asleep: false,
      lastActiveAt: now(),
      ...fields,
    };
    tabs.push(tab);
    return tab;
  }

  restore(saved);

  /** @param {unknown} data */
  function restore(data) {
    if (!data || typeof data !== "object") return;
    const record = /** @type {Record<string, unknown>} */ (data);
    /** @type {Map<unknown, number>} */
    const folderIds = new Map();
    if (Array.isArray(record.folders))
      for (const folder of record.folders) {
        const name = cleanName(folder?.name);
        if (!name || folderIds.has(folder.id)) continue;
        folderIds.set(folder.id, nextFolderId);
        folders.push({ id: nextFolderId++, name, collapsed: folder.collapsed === true });
      }
    if (Array.isArray(record.tabs))
      for (const saved of record.tabs) {
        if (!saved || !["favorites", "pinned"].includes(saved.zone) || !isWebUrl(saved.homeUrl))
          continue;
        const homeTitle = cleanName(saved.homeTitle) || null;
        addTab(saved.homeUrl, {
          zone: saved.zone,
          folderId: (saved.zone === "pinned" && folderIds.get(saved.folderId)) || null,
          homeUrl: saved.homeUrl,
          homeTitle,
          title: homeTitle || cleanName(saved.title) || hostname(saved.homeUrl),
          customTitle: cleanName(saved.customTitle) || null,
          favicon: typeof saved.favicon === "string" && FAVICON.test(saved.favicon) ? saved.favicon : null,
          asleep: true,
        });
      }
    if (Array.isArray(record.archive))
      archive = record.archive
        .filter((entry) => entry && isWebUrl(entry.url))
        .slice(0, ARCHIVE_LIMIT)
        .map((entry) => ({
          id: nextArchiveId++,
          url: entry.url,
          title: cleanName(entry.title) || hostname(entry.url),
          reason: entry.reason === "auto" ? "auto" : "closed",
          archivedAt: Number.isFinite(entry.archivedAt) ? entry.archivedAt : now(),
        }));
  }

  function exportOrganization() {
    return structuredClone({
      version: 1,
      folders,
      tabs: tabs
        .filter((tab) => tab.zone !== "today" && tab.homeUrl)
        .map(({ zone, folderId, homeUrl, homeTitle, title, customTitle, favicon }) => ({
          zone,
          folderId,
          homeUrl,
          homeTitle,
          title,
          customTitle,
          favicon,
        })),
      archive: archive.map(({ url, title, reason, archivedAt }) => ({ url, title, reason, archivedAt })),
    });
  }

  /** @param {number} id */
  const findTab = (id) => tabs.find((tab) => tab.id === id);
  /** @param {number} id */
  function requireTab(id) {
    const tab = findTab(id);
    if (!tab) throw new Error("That tab is no longer open.");
    return tab;
  }
  /** @param {number} id */
  function requireFolder(id) {
    const folder = folders.find((entry) => entry.id === id);
    if (!folder) throw new Error("That folder no longer exists.");
    return folder;
  }
  const shownIds = () => (split ? [...split.tabIds] : activeId ? [activeId] : []);

  /** The tabs in one zone or folder, in visual order. */
  function container(zone, folderId = null) {
    return tabs.filter(
      (tab) => tab.zone === zone && (zone !== "pinned" || tab.folderId === folderId),
    );
  }

  function getSections() {
    // Visual order: favorites, each folder, loose pinned tabs, then today.
    const groups = [
      { key: "favorites", ids: container("favorites").map((tab) => tab.id) },
      ...folders.map((folder) => ({
        key: folder.id,
        ids: container("pinned", folder.id).map((tab) => tab.id),
      })),
      { key: "pinned", ids: container("pinned").map((tab) => tab.id) },
      { key: "today", ids: container("today").map((tab) => tab.id) },
    ];
    let grouped = false;
    /** @type {Map<string | number, number[][]>} */
    const slots = new Map();
    for (const group of groups) {
      /** @type {number[][]} */
      const entries = [];
      for (const id of group.ids) {
        if (!split?.tabIds.includes(id)) entries.push([id]);
        else if (!grouped) {
          entries.push([...split.tabIds]);
          grouped = true;
        }
      }
      slots.set(group.key, entries);
    }
    const sections = {
      favorites: slots.get("favorites"),
      folders: folders.map((folder) => ({ id: folder.id, slots: slots.get(folder.id) })),
      pinned: slots.get("pinned"),
      today: slots.get("today"),
    };
    const tabSlots = [
      ...sections.favorites,
      ...sections.folders.flatMap((folder) => folder.slots),
      ...sections.pinned,
      ...sections.today,
    ];
    return { sections, tabSlots };
  }

  function getState() {
    const { sections, tabSlots } = getSections();
    const pages = tabs
      .filter((tab) => !tab.asleep)
      .map((tab) => ({
        id: tab.id,
        visible:
          !screen &&
          !splitResizing &&
          !sidebarResizing &&
          !!tab.url &&
          !tab.error &&
          (split ? split.tabIds.includes(tab.id) : tab.id === activeId),
      }));
    return structuredClone({
      tabs,
      activeId,
      split,
      splitResizing,
      sidebarResizing,
      settingsOpen: screen === "settings",
      archiveOpen: screen === "archive",
      palette,
      tabSlots,
      sections,
      folders,
      archive,
      pages,
    });
  }

  /** @param {number} id */
  function select(id) {
    if (!findTab(id)) return false;
    if (split && !split.tabIds.includes(id)) {
      split.tabIds[split.tabIds.indexOf(activeId) === 1 ? 1 : 0] = id;
    }
    activeId = id;
    screen = null;
    splitResizing = sidebarResizing = false;
    palette = null;
    return true;
  }

  /** @param {string} [url] */
  function createTab(url = "") {
    const tab = addTab(url, { loading: !!url });
    if (url) effects.push({ type: "load", id: tab.id, url });
    return tab.id;
  }

  /** @param {import('../shared/browser').BrowserTab} tab @param {'closed' | 'auto'} reason */
  function archiveTab(tab, reason) {
    if (!tab.url) return;
    archive.unshift({
      id: nextArchiveId++,
      url: tab.url,
      title: tab.customTitle || tab.title,
      reason,
      archivedAt: now(),
    });
    archive.length = Math.min(archive.length, ARCHIVE_LIMIT);
  }

  /** Removes a tab from view: pinned tabs go to sleep at home, others close. */
  function closeTab(id) {
    const tab = findTab(id);
    if (!tab) return;
    const order = getSections().tabSlots.flat();
    let replacement;
    if (split?.tabIds.includes(id)) {
      replacement = split.tabIds.find((entry) => entry !== id);
      split = null;
      splitResizing = false;
    }
    if (tab.zone === "today") {
      archiveTab(tab, "closed");
      tabs.splice(tabs.indexOf(tab), 1);
    } else {
      tab.asleep = true;
      tab.loading = false;
      tab.error = null;
      if (tab.homeUrl && tab.url !== tab.homeUrl) {
        tab.url = tab.homeUrl;
        tab.title = tab.homeTitle || hostname(tab.homeUrl);
      }
    }
    if (activeId === id && replacement === undefined) {
      const position = order.indexOf(id);
      const candidates = [...order.slice(position + 1), ...order.slice(0, position).reverse()];
      replacement =
        candidates.find((entry) => !findTab(entry)?.asleep) ??
        tabs.find((entry) => entry.zone === "today")?.id ??
        createTab();
    }
    if (replacement !== undefined && select(replacement)) effects.push({ type: "focus" });
  }

  /** @param {SessionCommand} command */
  function run(command) {
    const focus = () => effects.push({ type: "focus" });
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
            ? (cycleOrder ??= getSections().tabSlots.flat())
            : getSections().tabSlots.flat();
        const index =
          command.type === "select-position"
            ? command.position === 9
              ? order.length - 1
              : command.position - 1
            : (order.indexOf(activeId) + command.direction + order.length) % order.length;
        if (select(order[index])) focus();
        break;
      }
      case "close-tab":
        closeTab(command.id);
        break;
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
        if (!split || ![0, 1].includes(command.side) || !findTab(command.id))
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
        splitResizing = !!split && !screen && !palette && command.resizing;
        break;
      case "set-sidebar-resizing":
        if (typeof command.resizing !== "boolean") throw new Error("Invalid resize state.");
        sidebarResizing = !screen && !palette && command.resizing;
        break;
      case "show-settings":
      case "show-archive":
        screen = command.open ? (command.type === "show-settings" ? "settings" : "archive") : null;
        splitResizing = sidebarResizing = false;
        palette = null;
        focus();
        break;
      case "open-palette":
        if (!["commands", "navigate"].includes(command.mode))
          throw new Error("Invalid palette mode.");
        splitResizing = sidebarResizing = false;
        palette = {
          mode: command.mode,
          query: command.mode === "navigate" ? findTab(activeId)?.url || "" : "",
          requestId: ++paletteRequestId,
        };
        break;
      case "close-palette":
        palette = null;
        break;
      case "focus-tab":
        if (
          !screen &&
          !splitResizing &&
          !sidebarResizing &&
          !palette &&
          split?.tabIds.includes(command.id)
        )
          activeId = command.id;
        break;
      case "navigate": {
        const tab = findTab(command.id);
        if (!tab) break;
        screen = null;
        palette = null;
        tab.url = command.url;
        tab.title = hostname(command.url);
        tab.error = null;
        tab.loading = !!command.url;
        effects.push({ type: "load", id: tab.id, url: tab.url });
        break;
      }
      case "update-tab": {
        const tab = findTab(command.id);
        if (!tab) break;
        Object.assign(tab, command.patch, { id: tab.id });
        if (tab.homeUrl && tab.url === tab.homeUrl && command.patch.title)
          tab.homeTitle = tab.title;
        break;
      }
      case "move-tab": {
        const tab = requireTab(command.id);
        const folderId = command.folderId ?? null;
        if (!ZONES.includes(command.zone) || !isIndex(command.index))
          throw new Error("Invalid tab position.");
        if (folderId !== null && (command.zone !== "pinned" || !folders.some((f) => f.id === folderId)))
          throw new Error("That folder no longer exists.");
        if (command.zone !== "today" && !tab.url)
          throw new Error("Open a page before pinning this tab.");
        tabs.splice(tabs.indexOf(tab), 1);
        const siblings = container(command.zone, folderId);
        const anchor = siblings[command.index];
        const insertAt = anchor
          ? tabs.indexOf(anchor)
          : siblings.length
            ? tabs.indexOf(siblings[siblings.length - 1]) + 1
            : tabs.length;
        tabs.splice(insertAt, 0, tab);
        tab.zone = command.zone;
        tab.folderId = folderId;
        if (command.zone === "today") tab.homeUrl = tab.homeTitle = null;
        else if (!tab.homeUrl) {
          tab.homeUrl = tab.url;
          tab.homeTitle = tab.title;
        }
        break;
      }
      case "rename-tab": {
        const tab = requireTab(command.id);
        if (typeof command.title !== "string") throw new Error("Enter a tab name.");
        tab.customTitle = cleanName(command.title) || null;
        break;
      }
      case "reset-tab": {
        const tab = requireTab(command.id);
        if (!tab.homeUrl) break;
        tab.url = tab.homeUrl;
        tab.title = tab.homeTitle || hostname(tab.homeUrl);
        tab.error = null;
        if (tab.asleep) break;
        tab.loading = true;
        effects.push({ type: "load", id: tab.id, url: tab.url });
        break;
      }
      case "sleep-tab": {
        const tab = requireTab(command.id);
        if (shownIds().includes(tab.id)) throw new Error("Switch to another tab first.");
        if (tab.url) tab.asleep = true;
        break;
      }
      case "create-folder": {
        const folder = {
          id: nextFolderId++,
          name: cleanName(command.name) || "New folder",
          collapsed: false,
        };
        if (command.tabId !== undefined) requireTab(command.tabId);
        folders.push(folder);
        if (command.tabId !== undefined)
          run({ type: "move-tab", id: command.tabId, zone: "pinned", folderId: folder.id, index: 0 });
        effects.push({ type: "edit", kind: "folder", id: folder.id });
        break;
      }
      case "rename-folder": {
        const folder = requireFolder(command.id);
        folder.name = cleanName(command.name) || folder.name;
        break;
      }
      case "toggle-folder": {
        const folder = requireFolder(command.id);
        folder.collapsed = !folder.collapsed;
        break;
      }
      case "delete-folder": {
        requireFolder(command.id);
        folders = folders.filter((folder) => folder.id !== command.id);
        for (const tab of tabs) if (tab.folderId === command.id) tab.folderId = null;
        break;
      }
      case "move-folder": {
        const folder = requireFolder(command.id);
        if (!isIndex(command.index)) throw new Error("Invalid folder position.");
        folders.splice(folders.indexOf(folder), 1);
        folders.splice(Math.min(command.index, folders.length), 0, folder);
        break;
      }
      case "restore-archived": {
        const entry = archive.find((item) => item.id === command.id);
        if (!entry) throw new Error("That page is no longer in the archive.");
        archive = archive.filter((item) => item !== entry);
        select(createTab(entry.url));
        focus();
        break;
      }
      case "remove-archived":
        archive = archive.filter((item) => item.id !== command.id);
        break;
      case "clear-archive":
        archive = [];
        break;
      case "tick": {
        const { archiveAfter, sleepAfter, keepAwake } = command;
        const valid = (value) => value === null || (typeof value === "number" && value > 0);
        if (!valid(archiveAfter) || !valid(sleepAfter) || !Array.isArray(keepAwake))
          throw new Error("Invalid tick.");
        const time = now();
        const shown = shownIds();
        for (const tab of [...tabs]) {
          if (shown.includes(tab.id) || keepAwake.includes(tab.id)) continue;
          const idle = time - tab.lastActiveAt;
          if (tab.zone === "today" && archiveAfter !== null && idle >= archiveAfter) {
            archiveTab(tab, "auto");
            tabs.splice(tabs.indexOf(tab), 1);
          } else if (tab.url && !tab.asleep && sleepAfter !== null && idle >= sleepAfter)
            tab.asleep = true;
        }
        break;
      }
      default:
        throw new Error("Unknown session command.");
    }
  }

  /** @param {SessionCommand} command */
  function dispatch(command) {
    // Pane replacement can move a tab slot while cycling. Keep one traversal's
    // initial visual order so every tab remains reachable in both directions.
    if (!["cycle-tab", "update-tab", "tick"].includes(command.type)) cycleOrder = null;
    effects = [];
    const before = shownIds();
    run(command);
    const time = now();
    for (const id of new Set([...before, ...shownIds()])) {
      const tab = findTab(id);
      if (!tab) continue;
      // A tab is in use while it is shown; leaving it starts its idle time.
      tab.lastActiveAt = time;
      if (tab.asleep && shownIds().includes(id)) {
        tab.asleep = false;
        effects.push({ type: "wake", id, url: tab.url });
      }
    }
    return { state: getState(), effects };
  }

  return { dispatch, getState, exportOrganization };
}

module.exports = { createBrowserSession };
