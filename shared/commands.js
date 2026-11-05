// @ts-check
import { settingsSchema } from "./settings.js";
import { formatAccelerator, resolveShortcuts } from "./shortcuts.js";

/** @satisfies {Record<Exclude<keyof import('./browser').BrowserApi, 'onState' | 'onFocusAddress' | 'onEdit' | 'onPageEdge'>, { channel: string, palette: boolean }>} */
export const browserCommands = {
  getState: { channel: "browser:state", palette: true },
  openPalette: { channel: "browser:palette-open", palette: false },
  closePalette: { channel: "browser:palette-close", palette: true },
  executePalette: { channel: "browser:palette-execute", palette: true },
  reportPageLayout: { channel: "browser:page-layout", palette: false },
  newTab: { channel: "browser:new-tab", palette: false },
  selectTab: { channel: "browser:select-tab", palette: false },
  closeTab: { channel: "browser:close-tab", palette: false },
  cycleTab: { channel: "browser:cycle-tab", palette: false },
  selectTabPosition: { channel: "browser:select-tab-position", palette: false },
  navigate: { channel: "browser:navigate", palette: false },
  back: { channel: "browser:back", palette: false },
  forward: { channel: "browser:forward", palette: false },
  reload: { channel: "browser:reload", palette: false },
  stop: { channel: "browser:stop", palette: false },
  toggleSplit: { channel: "browser:toggle-split", palette: false },
  setSplitTab: { channel: "browser:set-split-tab", palette: false },
  resizeSplit: { channel: "browser:resize-split", palette: false },
  addSplitPane: { channel: "browser:add-split-pane", palette: false },
  removeSplitPane: { channel: "browser:remove-split-pane", palette: false },
  setSplitLayout: { channel: "browser:set-split-layout", palette: false },
  splitWith: { channel: "browser:split-with", palette: false },
  setSplitResizing: { channel: "browser:set-split-resizing", palette: false },
  setSidebarResizing: { channel: "browser:set-sidebar-resizing", palette: false },
  capturePages: { channel: "browser:capture-pages", palette: false },
  setTabDragging: { channel: "browser:set-tab-dragging", palette: false },
  toggleSidebar: { channel: "browser:toggle-sidebar", palette: false },
  toggleCompactMode: { channel: "browser:toggle-compact-mode", palette: false },
  setChromeRevealed: { channel: "browser:chrome-revealed", palette: false },
  openSettings: { channel: "browser:open-settings", palette: false },
  closeSettings: { channel: "browser:close-settings", palette: false },
  updateSettings: { channel: "browser:update-settings", palette: false },
  setShortcutRecording: { channel: "browser:shortcut-recording", palette: false },
  setTabLayout: { channel: "browser:set-tab-layout", palette: false },
  moveTab: { channel: "browser:move-tab", palette: false },
  renameTab: { channel: "browser:rename-tab", palette: false },
  resetTab: { channel: "browser:reset-tab", palette: false },
  sleepTab: { channel: "browser:sleep-tab", palette: false },
  showTabMenu: { channel: "browser:tab-menu", palette: false },
  createFolder: { channel: "browser:create-folder", palette: false },
  renameFolder: { channel: "browser:rename-folder", palette: false },
  toggleFolder: { channel: "browser:toggle-folder", palette: false },
  deleteFolder: { channel: "browser:delete-folder", palette: false },
  moveFolder: { channel: "browser:move-folder", palette: false },
  showFolderMenu: { channel: "browser:folder-menu", palette: false },
  openArchive: { channel: "browser:open-archive", palette: false },
  closeArchive: { channel: "browser:close-archive", palette: false },
  restoreArchived: { channel: "browser:restore-archived", palette: false },
  removeArchived: { channel: "browser:remove-archived", palette: false },
  clearArchive: { channel: "browser:clear-archive", palette: false },
  editTab: { channel: "browser:edit-tab", palette: false },
  createSpace: { channel: "browser:create-space", palette: false },
  switchSpace: { channel: "browser:switch-space", palette: false },
  cycleSpace: { channel: "browser:cycle-space", palette: false },
  renameSpace: { channel: "browser:rename-space", palette: false },
  deleteSpace: { channel: "browser:delete-space", palette: false },
  showSpaceMenu: { channel: "browser:space-menu", palette: false },
  moveTabToSpace: { channel: "browser:move-tab-to-space", palette: false },
  addRoute: { channel: "browser:add-route", palette: false },
  removeRoute: { channel: "browser:remove-route", palette: false },
};

export const browserEvents = {
  onState: "browser:state-changed",
  onPageEdge: "browser:page-edge",
  onFocusAddress: "browser:focus-address",
  onEdit: "browser:edit",
};

/** @param {string} name @param {string} source @param {boolean} mainFrame */
export function canInvokeCommand(name, source, mainFrame) {
  if (!mainFrame || !Object.hasOwn(browserCommands, name)) return false;
  return (
    source === "chrome" ||
    (source === "palette" &&
      browserCommands[/** @type {keyof typeof browserCommands} */ (name)].palette)
  );
}

/** @param {Record<string, unknown>} handlers */
export function validateCommandHandlers(handlers) {
  if (
    Object.keys(handlers).length !== Object.keys(browserCommands).length ||
    Object.keys(browserCommands).some(
      (name) => !Object.hasOwn(handlers, name) || typeof handlers[name] !== "function",
    )
  )
    throw new Error("Browser command handlers must match the shared command table.");
}

const LAYOUT_TITLES = /** @type {const} */ ({ columns: "columns", rows: "rows", grid: "a grid" });

/**
 * @param {NonNullable<import('./browser').BrowserState['split']>} split
 * @returns {PaletteCommand[]}
 */
function splitCommands(split) {
  /** @type {PaletteCommand[]} */
  const commands = [];
  if (split.tabIds.length < 4)
    commands.push({
      id: "add-split-pane",
      title: "Add split pane",
      detail: "Show up to four pages at once",
      icon: "addPane",
      hint: "",
      command: "addSplitPane",
      args: [],
    });
  for (const layout of /** @type {const} */ (["columns", "rows", "grid"])) {
    if (layout === split.layout || (layout === "grid" && split.tabIds.length < 3)) continue;
    commands.push({
      id: `split-${layout}`,
      title: `Arrange panes in ${LAYOUT_TITLES[layout]}`,
      detail: "Split view layout",
      icon: layout === "columns" ? "split" : layout === "rows" ? "splitRows" : "splitGrid",
      hint: "",
      command: "setSplitLayout",
      args: [layout],
    });
  }
  return commands;
}

/**
 * @typedef {{ id: string, title: string, detail: string, icon: string, hint: string, command: keyof typeof browserCommands, args: unknown[] }} PaletteCommand
 * @param {import('./browser').BrowserState} state
 * @returns {PaletteCommand[]}
 */
export function paletteCommands(state) {
  const active = state.tabs.find((tab) => tab.id === state.activeId);
  const keys = resolveShortcuts(state.settings.shortcuts ?? {});
  /** @param {string} id */
  const shortcut = (id) => formatAccelerator(keys[id] ?? "", state.platform);
  /** @type {PaletteCommand[]} */
  const commands = [
    {
      id: "new-tab",
      title: "New tab",
      detail: "Start with a blank page",
      icon: "plus",
      hint: shortcut("newTab"),
      command: "newTab",
      args: [],
    },
    {
      id: "settings",
      title: "Open settings",
      detail: "Appearance and browsing preferences",
      icon: "settings",
      hint: shortcut("settings"),
      command: "openSettings",
      args: [],
    },
    {
      id: "split",
      title: state.split ? "Exit split view" : "Split tabs",
      detail: state.split ? "Return to one page" : "Browse two pages side by side",
      icon: "split",
      hint: shortcut("toggleSplit"),
      command: "toggleSplit",
      args: [],
    },
    ...(state.split ? splitCommands(state.split) : []),
    {
      id: "close-tab",
      title: "Close current tab",
      detail: active?.title || "New tab",
      icon: "close",
      hint: shortcut("closeTab"),
      command: "closeTab",
      args: [state.activeId],
    },
  ];
  if (active?.url)
    commands.push({
      id: "reload",
      title: "Reload page",
      detail: active.title,
      icon: "reload",
      hint: shortcut("reload"),
      command: "reload",
      args: [],
    });
  if (active?.canGoBack)
    commands.push({
      id: "back",
      title: "Go back",
      detail: "Previous page in this tab",
      icon: "back",
      hint: shortcut("back"),
      command: "back",
      args: [],
    });
  if (active?.canGoForward)
    commands.push({
      id: "forward",
      title: "Go forward",
      detail: "Next page in this tab",
      icon: "forward",
      hint: shortcut("forward"),
      command: "forward",
      args: [],
    });
  const end = Number.MAX_SAFE_INTEGER;
  if (active?.url) {
    const pinned = active.zone === "pinned";
    const favorite = active.zone === "favorites";
    commands.push(
      {
        id: "pin-tab",
        title: pinned ? "Unpin tab" : "Pin tab",
        detail: pinned ? "Move this tab back to today" : "Keep this tab in the pinned section",
        icon: "pin",
        hint: shortcut("togglePin"),
        command: "moveTab",
        args: pinned ? [active.id, "today", null, 0] : [active.id, "pinned", null, end],
      },
      {
        id: "favorite-tab",
        title: favorite ? "Remove from favorites" : "Add to favorites",
        detail: favorite
          ? "Move this tab back to today"
          : "Keep this tab at the top of the tab bar",
        icon: "star",
        hint: shortcut("toggleFavorite"),
        command: "moveTab",
        args: favorite ? [active.id, "today", null, 0] : [active.id, "favorites", null, end],
      },
    );
    if (active.homeUrl && active.url !== active.homeUrl)
      commands.push({
        id: "reset-tab",
        title: "Back to pinned page",
        detail: active.homeUrl,
        icon: "home",
        hint: "",
        command: "resetTab",
        args: [active.id],
      });
  }
  if (active)
    commands.push({
      id: "rename-tab",
      title: "Rename tab",
      detail: active.customTitle || active.title,
      icon: "edit",
      hint: "",
      command: "editTab",
      args: [active.id],
    });
  commands.push(
    {
      id: "new-folder",
      title: "New folder",
      detail: "Group pinned tabs",
      icon: "folder",
      hint: shortcut("newFolder"),
      command: "createFolder",
      args: [],
    },
    {
      id: "new-space",
      title: "New space",
      detail: "A new set of tabs with its own logins",
      icon: "space",
      hint: shortcut("newSpace"),
      command: "createSpace",
      args: [],
    },
    {
      id: "archive",
      title: "Open archive",
      detail: "Closed and auto-archived tabs",
      icon: "archive",
      hint: shortcut("archive"),
      command: "openArchive",
      args: [],
    },
  );
  if (state.tabLayout !== "top")
    commands.push({
      id: "toggle-sidebar",
      title: state.settings.sidebarVisible ? "Hide tab sidebar" : "Show tab sidebar",
      detail: state.settings.sidebarVisible ? "Give pages the full width" : "Bring back your tabs",
      icon: "split",
      hint: shortcut("toggleSidebar"),
      command: "toggleSidebar",
      args: [],
    });
  for (const space of state.spaces) {
    if (space.id === state.activeSpaceId) continue;
    commands.push({
      id: `space-${space.id}`,
      title: `Switch to ${space.name}`,
      detail: "Space",
      icon: "space",
      hint: "",
      command: "switchSpace",
      args: [space.id],
    });
    if (active?.url)
      commands.push({
        id: `move-to-space-${space.id}`,
        title: `Move tab to ${space.name}`,
        detail: active.customTitle || active.title,
        icon: "space",
        hint: "",
        command: "moveTabToSpace",
        args: [active.id, space.id],
      });
  }
  commands.push({
    id: "compact-mode",
    title: state.settings.compactMode ? "Turn off compact mode" : "Turn on compact mode",
    detail: state.settings.compactMode
      ? "Always show the toolbar and tabs"
      : "Hide the toolbar and tabs until you point at the window edge",
    icon: "compact",
    hint: shortcut("toggleCompactMode"),
    command: "toggleCompactMode",
    args: [],
  });
  for (const { value, label } of settingsSchema.theme.options)
    commands.push({
      id: `theme-${value}`,
      title: `${label} theme`,
      detail: value === "system" ? "Follow your system appearance" : `Use the ${value} appearance`,
      icon: "settings",
      hint: state.settings.theme === value ? "Current" : "",
      command: "updateSettings",
      args: [{ theme: value }],
    });
  for (const { value } of settingsSchema.tabLayout.options)
    commands.push({
      id: `tabs-${value}`,
      title: `Tabs on the ${value}`,
      detail: value === "top" ? "Horizontal tab bar" : "Vertical tab sidebar",
      icon: "split",
      hint: state.tabLayout === value ? "Current" : "",
      command: "updateSettings",
      args: [{ tabLayout: value }],
    });
  return commands;
}
