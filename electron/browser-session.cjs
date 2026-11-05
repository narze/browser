const crypto = require("node:crypto");
const { isWebUrl } = require("./policy.cjs");

/**
 * @typedef {import('../shared/browser').TabZone} TabZone
 * @typedef {import('../shared/browser').SplitLayout} SplitLayout
 * @typedef {{ type: 'new-tab', url?: string, spaceId?: number }
 * | { type: 'select-tab' | 'close-tab' | 'focus-tab' | 'reset-tab' | 'sleep-tab', id: number }
 * | { type: 'select-position', position: number }
 * | { type: 'cycle-tab', direction: number }
 * | { type: 'navigate', id: number, url: string }
 * | { type: 'update-tab', id: number, patch: Partial<import('../shared/browser').BrowserTab> }
 * | { type: 'toggle-split' | 'close-palette' | 'clear-archive' }
 * | { type: 'set-split-tab', side: number, id: number }
 * | { type: 'add-split-pane' }
 * | { type: 'remove-split-pane', id: number }
 * | { type: 'set-split-layout', layout: SplitLayout }
 * | { type: 'split-with', id: number, target: number, edge: 'left' | 'right' | 'top' | 'bottom' }
 * | { type: 'resize-split', ratio: number, axis?: 'columns' | 'rows', index?: number }
 * | { type: 'set-split-resizing' | 'set-sidebar-resizing', resizing: boolean }
 * | { type: 'show-settings' | 'show-archive', open: boolean }
 * | { type: 'open-palette', mode: 'navigate' | 'commands' }
 * | { type: 'move-tab', id: number, zone: TabZone, folderId?: number | null, index: number }
 * | { type: 'rename-tab', id: number, title: string }
 * | { type: 'create-folder', name?: string, tabId?: number }
 * | { type: 'rename-folder', id: number, name: string }
 * | { type: 'toggle-folder' | 'delete-folder' | 'restore-archived' | 'remove-archived', id: number }
 * | { type: 'move-folder', id: number, index: number }
 * | { type: 'tick', archiveAfter: number | null, sleepAfter: number | null, keepAwake: number[] }
 * | { type: 'create-space' }
 * | { type: 'switch-space' | 'delete-space' | 'remove-route', id: number }
 * | { type: 'cycle-space', direction: number }
 * | { type: 'rename-space', id: number, name: string }
 * | { type: 'set-space-color', id: number, color: string }
 * | { type: 'move-tab-to-space', id: number, spaceId: number }
 * | { type: 'add-route', host: string, spaceId: number }} SessionCommand
 * @typedef {{ type: 'load' | 'wake', id: number, url: string } | { type: 'focus' }
 * | { type: 'edit', kind: import('../shared/browser').EditTarget['kind'], id: number }
 * | { type: 'clear-profile', profile: string }} SessionEffect
 */

const ZONES = ["favorites", "pinned", "today"];
const SPLIT_LAYOUTS = ["columns", "rows", "grid"];
const SPLIT_EDGES = ["left", "right", "top", "bottom"];
const MAX_PANES = 4;
const ARCHIVE_LIMIT = 200;
const TITLE_LIMIT = 120;
const FAVICON = /^[a-f0-9]{32}\.(png|ico|svg|jpg|gif|webp)$/;
/** Each space browses in its own Electron session partition, persist:<profile>. */
const PROFILE = /^(browsing|space-[a-f0-9]{16})$/;
const SPACE_COLORS = ["blue", "purple", "pink", "red", "orange", "yellow", "green", "teal", "gray"];
const ROUTE_ERROR = "Enter a site, for example github.com.";
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

/** @param {string} url */
const hostname = (url) => (url ? new URL(url).hostname : "New tab");
/** @param {unknown} value */
const cleanName = (value) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, TITLE_LIMIT) : "";
/** @param {unknown} value */
const isIndex = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const randomProfile = () => `space-${crypto.randomBytes(8).toString("hex")}`;

/** A route host is a site name without "www.", for example github.com. @param {unknown} value */
function routeHost(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (!isWebUrl(url.href)) return null;
    const host = url.hostname.replace(/^www\./, "");
    return HOST.test(host) ? host : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ now?: () => number, saved?: unknown, newProfile?: () => string }} [options]
 */
function createBrowserSession({ now = Date.now, saved, newProfile = randomProfile } = {}) {
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
  /** @type {import('../shared/browser').Space[]} */
  let spaces = [];
  /** @type {import('../shared/browser').SiteRoute[]} */
  let routes = [];
  let activeSpaceId = 0;
  let nextSpaceId = 1;
  let nextRouteId = 1;
  /** The active tab and split of each space that is not shown. */
  /** @type {Map<number, { activeId: number, split: import('../shared/browser').BrowserState['split'] }>} */
  const spaceMemory = new Map();
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
      spaceId: activeSpaceId,
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

  /** @param {string} name @param {string} color @param {string} profile */
  function addSpace(name, color, profile) {
    const space = { id: nextSpaceId++, name, color, profile };
    spaces.push(space);
    return space;
  }

  restore(saved);
  if (!spaces.length) addSpace("Personal", SPACE_COLORS[0], "browsing");
  if (!spaces.some((space) => space.id === activeSpaceId)) activeSpaceId = spaces[0].id;

  /** @param {unknown} data */
  function restore(data) {
    if (!data || typeof data !== "object") return;
    const record = /** @type {Record<string, unknown>} */ (data);
    /** @type {Map<unknown, number>} */
    const spaceIds = new Map();
    if (Array.isArray(record.spaces))
      for (const space of record.spaces) {
        const name = cleanName(space?.name);
        if (!name || !PROFILE.test(space.profile) || spaceIds.has(space.id)) continue;
        const color = SPACE_COLORS.includes(space.color) ? space.color : SPACE_COLORS[0];
        spaceIds.set(space.id, addSpace(name, color, space.profile).id);
      }
    if (!spaces.length) addSpace("Personal", SPACE_COLORS[0], "browsing");
    activeSpaceId = spaceIds.get(record.activeSpaceId) ?? spaces[0].id;
    /** Version 1 data and items of a damaged space go to the first space. */
    const spaceOf = (/** @type {any} */ item) => spaceIds.get(item?.spaceId) ?? spaces[0].id;
    /** @type {Map<unknown, number>} */
    const folderIds = new Map();
    if (Array.isArray(record.folders))
      for (const folder of record.folders) {
        const name = cleanName(folder?.name);
        if (!name || folderIds.has(folder.id)) continue;
        folderIds.set(folder.id, nextFolderId);
        folders.push({
          id: nextFolderId++,
          name,
          collapsed: folder.collapsed === true,
          spaceId: spaceOf(folder),
        });
      }
    if (Array.isArray(record.tabs))
      for (const saved of record.tabs) {
        if (!saved || !["favorites", "pinned"].includes(saved.zone) || !isWebUrl(saved.homeUrl))
          continue;
        const homeTitle = cleanName(saved.homeTitle) || null;
        const folderId = (saved.zone === "pinned" && folderIds.get(saved.folderId)) || null;
        addTab(saved.homeUrl, {
          spaceId: folderId
            ? /** @type {import('../shared/browser').TabFolder} */ (
                folders.find((folder) => folder.id === folderId)
              ).spaceId
            : spaceOf(saved),
          zone: saved.zone,
          folderId,
          homeUrl: saved.homeUrl,
          homeTitle,
          title: homeTitle || cleanName(saved.title) || hostname(saved.homeUrl),
          customTitle: cleanName(saved.customTitle) || null,
          favicon:
            typeof saved.favicon === "string" && FAVICON.test(saved.favicon) ? saved.favicon : null,
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
          spaceId: spaceOf(entry),
        }));
    if (Array.isArray(record.routes))
      for (const route of record.routes) {
        const host = routeHost(route?.host);
        const spaceId = spaceIds.get(route?.spaceId);
        if (host && spaceId && !routes.some((entry) => entry.host === host))
          routes.push({ id: nextRouteId++, host, spaceId });
      }
  }

  function exportOrganization() {
    return structuredClone({
      version: 2,
      activeSpaceId,
      spaces,
      folders,
      tabs: tabs
        .filter((tab) => tab.zone !== "today" && tab.homeUrl)
        .map(({ spaceId, zone, folderId, homeUrl, homeTitle, title, customTitle, favicon }) => ({
          spaceId,
          zone,
          folderId,
          homeUrl,
          homeTitle,
          title,
          customTitle,
          favicon,
        })),
      archive: archive.map(({ url, title, reason, archivedAt, spaceId }) => ({
        url,
        title,
        reason,
        archivedAt,
        spaceId,
      })),
      routes: routes.map(({ host, spaceId }) => ({ host, spaceId })),
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
  /** @param {number} id */
  function requireSpace(id) {
    const space = spaces.find((entry) => entry.id === id);
    if (!space) throw new Error("That space no longer exists.");
    return space;
  }
  const shownIds = () => (split ? [...split.tabIds] : activeId ? [activeId] : []);
  const spaceTabs = (spaceId = activeSpaceId) => tabs.filter((tab) => tab.spaceId === spaceId);
  const spaceFolders = () => folders.filter((folder) => folder.spaceId === activeSpaceId);

  /** Equal track sizes for the panes. A grid has two columns and two rows. */
  function arrangeSplit(/** @type {number[]} */ tabIds, /** @type {SplitLayout} */ layout) {
    if (tabIds.length < 3 && layout === "grid") layout = "columns";
    const equal = (/** @type {number} */ count) => Array(count).fill(1 / count);
    const count = tabIds.length;
    split = {
      tabIds,
      layout,
      columns: equal(layout === "rows" ? 1 : layout === "grid" ? 2 : count),
      rows: equal(layout === "columns" ? 1 : layout === "grid" ? 2 : count),
    };
  }

  /** Takes a tab out of the split; one remaining pane ends the split. */
  function leaveSplit(/** @type {number} */ id) {
    if (!split) return undefined;
    const index = split.tabIds.indexOf(id);
    const rest = split.tabIds.filter((entry) => entry !== id);
    const neighbor = rest[Math.min(index, rest.length - 1)];
    if (rest.length > 1) arrangeSplit(rest, split.layout);
    else {
      split = null;
      splitResizing = false;
    }
    return neighbor;
  }

  /** The tabs in one zone or folder of a space, in visual order. */
  function container(zone, folderId = null, spaceId = activeSpaceId) {
    return spaceTabs(spaceId).filter(
      (tab) => tab.zone === zone && (zone !== "pinned" || tab.folderId === folderId),
    );
  }

  function getSections() {
    // Visual order: favorites, each folder, loose pinned tabs, then today.
    const groups = [
      { key: "favorites", ids: container("favorites").map((tab) => tab.id) },
      ...spaceFolders().map((folder) => ({
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
      folders: spaceFolders().map((folder) => ({ id: folder.id, slots: slots.get(folder.id) })),
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
      folders: spaceFolders(),
      archive,
      pages,
      spaces,
      activeSpaceId,
      routes,
    });
  }

  /** @param {number} id */
  function select(id) {
    const tab = findTab(id);
    if (!tab) return false;
    if (tab.spaceId !== activeSpaceId) enterSpace(tab.spaceId, id);
    if (split && !split.tabIds.includes(id)) {
      split.tabIds[Math.max(0, split.tabIds.indexOf(activeId))] = id;
    }
    activeId = id;
    screen = null;
    splitResizing = sidebarResizing = false;
    palette = null;
    return true;
  }

  /** @param {string} [url] @param {number} [spaceId] */
  function createTab(url = "", spaceId = activeSpaceId) {
    const tab = addTab(url, { loading: !!url, spaceId });
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
      spaceId: tab.spaceId,
    });
    archive.length = Math.min(archive.length, ARCHIVE_LIMIT);
  }

  /**
   * Takes a tab out of the active space's view and shows another tab of that space.
   * @param {number} id @param {() => void} change removes or moves the tab
   */
  function leave(id, change) {
    const order = getSections().tabSlots.flat();
    let replacement;
    if (split?.tabIds.includes(id)) {
      const neighbor = leaveSplit(id);
      if (activeId === id) replacement = neighbor;
      else replacement = activeId;
    }
    change();
    if (activeId === id && replacement === undefined) {
      const position = order.indexOf(id);
      const candidates = [...order.slice(position + 1), ...order.slice(0, position).reverse()];
      replacement =
        candidates.find((entry) => findTab(entry) && !findTab(entry)?.asleep) ??
        container("today")[0]?.id ??
        createTab();
    }
    if (replacement !== undefined && select(replacement)) effects.push({ type: "focus" });
  }

  /** Removes a tab from view: pinned tabs go to sleep at home, others close. */
  function closeTab(id) {
    const tab = findTab(id);
    if (!tab) return;
    leave(id, () => {
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
    });
  }

  /**
   * Shows a space with the tab and split it had when it was last shown.
   * @param {number} spaceId @param {number} [tabId] a tab of that space to show
   */
  function enterSpace(spaceId, tabId) {
    requireSpace(spaceId);
    if (spaceId !== activeSpaceId) {
      if (findTab(activeId)?.spaceId === activeSpaceId)
        spaceMemory.set(activeSpaceId, { activeId, split });
      activeSpaceId = spaceId;
      const memory = spaceMemory.get(spaceId);
      const inSpace = (/** @type {number} */ id) => findTab(id)?.spaceId === spaceId;
      split = memory?.split && memory.split.tabIds.every(inSpace) ? memory.split : null;
      splitResizing = false;
      activeId = 0;
      const remembered = memory && inSpace(memory.activeId) ? memory.activeId : undefined;
      activeId = tabId ?? remembered ?? getSections().tabSlots.flat()[0] ?? createTab();
      if (split && !split.tabIds.includes(activeId)) split = null;
    }
    screen = null;
    palette = null;
  }

  /** The space whose most specific route matches a URL. @param {string} url */
  function routeFor(url) {
    let host;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return undefined;
    }
    return routes
      .filter((route) => host === route.host || host.endsWith("." + route.host))
      .sort((a, b) => b.host.length - a.host.length)[0]?.spaceId;
  }

  /** @param {SessionCommand} command */
  function run(command) {
    const focus = () => effects.push({ type: "focus" });
    switch (command.type) {
      case "new-tab": {
        const opener = spaces.some((space) => space.id === command.spaceId)
          ? /** @type {number} */ (command.spaceId)
          : activeSpaceId;
        const spaceId = (command.url && routeFor(command.url)) || opener;
        select(createTab(command.url, spaceId));
        focus();
        break;
      }
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
          const other = spaceTabs().find((tab) => tab.id !== originalId);
          const otherId = other?.id ?? createTab();
          arrangeSplit([originalId, otherId], "columns");
          activeId = other ? originalId : otherId;
        }
        if (select(activeId)) focus();
        break;
      case "set-split-tab": {
        if (
          !split ||
          !isIndex(command.side) ||
          command.side >= split.tabIds.length ||
          findTab(command.id)?.spaceId !== activeSpaceId
        )
          throw new Error("Invalid split tab.");
        const current = split.tabIds.indexOf(command.id);
        if (current >= 0) split.tabIds[current] = split.tabIds[command.side];
        split.tabIds[command.side] = command.id;
        select(command.id);
        focus();
        break;
      }
      case "add-split-pane": {
        if (split && split.tabIds.length >= MAX_PANES)
          throw new Error("A split has at most four panes.");
        const id = createTab();
        arrangeSplit([...shownIds(), id], split?.layout ?? "columns");
        select(id);
        focus();
        break;
      }
      case "remove-split-pane": {
        if (!split?.tabIds.includes(command.id)) throw new Error("That tab is not in the split.");
        const neighbor = leaveSplit(command.id);
        if (select(activeId === command.id ? neighbor : activeId)) focus();
        break;
      }
      case "set-split-layout":
        if (!split || !SPLIT_LAYOUTS.includes(command.layout))
          throw new Error("Invalid split layout.");
        if (command.layout === "grid" && split.tabIds.length < 3)
          throw new Error("A grid needs three or four panes.");
        arrangeSplit(split.tabIds, command.layout);
        break;
      case "split-with": {
        const shown = shownIds();
        if (
          !SPLIT_EDGES.includes(command.edge) ||
          findTab(command.id)?.spaceId !== activeSpaceId ||
          !shown.includes(command.target)
        )
          throw new Error("Invalid split drop.");
        if (command.id === command.target) break;
        const before = command.edge === "left" || command.edge === "top";
        if (!split) {
          arrangeSplit(
            before ? [command.id, command.target] : [command.target, command.id],
            command.edge === "left" || command.edge === "right" ? "columns" : "rows",
          );
        } else if (!split.tabIds.includes(command.id) && split.tabIds.length >= MAX_PANES) {
          split.tabIds[split.tabIds.indexOf(command.target)] = command.id;
        } else {
          const rest = split.tabIds.filter((entry) => entry !== command.id);
          rest.splice(rest.indexOf(command.target) + (before ? 0 : 1), 0, command.id);
          arrangeSplit(rest, split.layout);
        }
        select(command.id);
        focus();
        break;
      }
      case "resize-split": {
        const { ratio, axis = "columns", index = 0 } = command;
        if (typeof ratio !== "number" || !Number.isFinite(ratio))
          throw new Error("Invalid split ratio.");
        if (!split) break;
        const sizes = axis === "columns" ? split.columns : axis === "rows" ? split.rows : null;
        if (!sizes || !isIndex(index) || index + 1 >= sizes.length)
          throw new Error("Invalid split divider.");
        // Each divider moves only its two neighbors; no pane gets too small to use.
        const pair = sizes[index] + sizes[index + 1];
        const min = Math.min(0.25, 0.5 / sizes.length);
        sizes[index] = Math.max(min, Math.min(pair - min, ratio * pair));
        sizes[index + 1] = pair - sizes[index];
        break;
      }
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
        if (
          folderId !== null &&
          (command.zone !== "pinned" ||
            !folders.some((f) => f.id === folderId && f.spaceId === tab.spaceId))
        )
          throw new Error("That folder no longer exists.");
        if (command.zone !== "today" && !tab.url)
          throw new Error("Open a page before pinning this tab.");
        tabs.splice(tabs.indexOf(tab), 1);
        const siblings = container(command.zone, folderId, tab.spaceId);
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
          spaceId: activeSpaceId,
        };
        if (command.tabId !== undefined) requireTab(command.tabId);
        folders.push(folder);
        if (command.tabId !== undefined)
          run({
            type: "move-tab",
            id: command.tabId,
            zone: "pinned",
            folderId: folder.id,
            index: 0,
          });
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
        const siblings = folders.filter((entry) => entry.spaceId === folder.spaceId);
        const anchor = siblings[command.index];
        const insertAt = anchor
          ? folders.indexOf(anchor)
          : siblings.length
            ? folders.indexOf(siblings[siblings.length - 1]) + 1
            : folders.length;
        folders.splice(insertAt, 0, folder);
        break;
      }
      case "restore-archived": {
        const entry = archive.find((item) => item.id === command.id);
        if (!entry) throw new Error("That page is no longer in the archive.");
        archive = archive.filter((item) => item !== entry);
        select(
          createTab(
            entry.url,
            spaces.some((space) => space.id === entry.spaceId) ? entry.spaceId : activeSpaceId,
          ),
        );
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
        // Archiving removes entries from tabs, so iterate over a separate list.
        const idle = tabs.filter((tab) => !shown.includes(tab.id) && !keepAwake.includes(tab.id));
        for (const tab of idle) {
          const idleFor = time - tab.lastActiveAt;
          if (tab.zone === "today" && archiveAfter !== null && idleFor >= archiveAfter) {
            archiveTab(tab, "auto");
            tabs.splice(tabs.indexOf(tab), 1);
          } else if (tab.url && !tab.asleep && sleepAfter !== null && idleFor >= sleepAfter)
            tab.asleep = true;
        }
        break;
      }
      case "create-space": {
        const space = addSpace(
          `Space ${spaces.length + 1}`,
          SPACE_COLORS[spaces.length % SPACE_COLORS.length],
          newProfile(),
        );
        enterSpace(space.id);
        focus();
        effects.push({ type: "edit", kind: "space", id: space.id });
        break;
      }
      case "switch-space":
        enterSpace(requireSpace(command.id).id);
        focus();
        break;
      case "cycle-space": {
        if (![1, -1].includes(command.direction)) throw new Error("Invalid space direction.");
        const index = spaces.findIndex((space) => space.id === activeSpaceId);
        enterSpace(spaces[(index + command.direction + spaces.length) % spaces.length].id);
        focus();
        break;
      }
      case "rename-space": {
        const space = requireSpace(command.id);
        space.name = cleanName(command.name) || space.name;
        break;
      }
      case "set-space-color": {
        const space = requireSpace(command.id);
        if (!SPACE_COLORS.includes(command.color)) throw new Error("Invalid space color.");
        space.color = command.color;
        break;
      }
      case "delete-space": {
        const space = requireSpace(command.id);
        if (spaces.length === 1) throw new Error("Keep at least one space.");
        if (space.id === activeSpaceId)
          enterSpace(spaces[spaces.indexOf(space) === 0 ? 1 : spaces.indexOf(space) - 1].id);
        for (const tab of spaceTabs(space.id)) {
          if (tab.zone === "today") archiveTab(tab, "closed");
          tabs.splice(tabs.indexOf(tab), 1);
        }
        spaces = spaces.filter((entry) => entry !== space);
        folders = folders.filter((folder) => folder.spaceId !== space.id);
        routes = routes.filter((route) => route.spaceId !== space.id);
        for (const entry of archive) if (entry.spaceId === space.id) entry.spaceId = activeSpaceId;
        spaceMemory.delete(space.id);
        if (!spaces.some((entry) => entry.profile === space.profile))
          effects.push({ type: "clear-profile", profile: space.profile });
        focus();
        break;
      }
      case "move-tab-to-space": {
        const tab = requireTab(command.id);
        const space = requireSpace(command.spaceId);
        if (tab.spaceId === space.id) break;
        const move = () => {
          tabs.splice(tabs.indexOf(tab), 1);
          const siblings = container(tab.zone, null, space.id);
          const last = siblings[siblings.length - 1];
          tabs.splice(last ? tabs.indexOf(last) + 1 : tabs.length, 0, tab);
          tab.spaceId = space.id;
          tab.folderId = null;
        };
        if (tab.spaceId === activeSpaceId) leave(tab.id, move);
        else move();
        break;
      }
      case "add-route": {
        const host = routeHost(command.host);
        if (!host) throw new Error(ROUTE_ERROR);
        requireSpace(command.spaceId);
        routes = routes.filter((route) => route.host !== host);
        routes.push({ id: nextRouteId++, host, spaceId: command.spaceId });
        break;
      }
      case "remove-route":
        routes = routes.filter((route) => route.id !== command.id);
        break;
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
