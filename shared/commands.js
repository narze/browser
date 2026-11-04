// @ts-check
import { settingsSchema } from "./settings.js";

/** @satisfies {Record<Exclude<keyof import('./browser').BrowserApi, 'onState' | 'onFocusAddress'>, { channel: string, palette: boolean }>} */
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
  setSplitResizing: { channel: "browser:set-split-resizing", palette: false },
  openSettings: { channel: "browser:open-settings", palette: false },
  closeSettings: { channel: "browser:close-settings", palette: false },
  updateSettings: { channel: "browser:update-settings", palette: false },
  setTabLayout: { channel: "browser:set-tab-layout", palette: false },
};

export const browserEvents = {
  onState: "browser:state-changed",
  onFocusAddress: "browser:focus-address",
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

/**
 * @typedef {{ id: string, title: string, detail: string, icon: string, hint: string, command: keyof typeof browserCommands, args: unknown[] }} PaletteCommand
 * @param {import('./browser').BrowserState} state
 * @returns {PaletteCommand[]}
 */
export function paletteCommands(state) {
  const active = state.tabs.find((tab) => tab.id === state.activeId);
  const modifier = state.platform === "darwin" ? "⌘" : "Ctrl+";
  /** @type {PaletteCommand[]} */
  const commands = [
    {
      id: "new-tab",
      title: "New tab",
      detail: "Start with a blank page",
      icon: "plus",
      hint: `${modifier}T`,
      command: "newTab",
      args: [],
    },
    {
      id: "settings",
      title: "Open settings",
      detail: "Appearance and browsing preferences",
      icon: "settings",
      hint: `${modifier},`,
      command: "openSettings",
      args: [],
    },
    {
      id: "split",
      title: state.split ? "Exit split view" : "Split tabs",
      detail: state.split ? "Return to one page" : "Browse two pages side by side",
      icon: "split",
      hint: "",
      command: "toggleSplit",
      args: [],
    },
    {
      id: "close-tab",
      title: "Close current tab",
      detail: active?.title || "New tab",
      icon: "close",
      hint: `${modifier}W`,
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
      hint: `${modifier}R`,
      command: "reload",
      args: [],
    });
  if (active?.canGoBack)
    commands.push({
      id: "back",
      title: "Go back",
      detail: "Previous page in this tab",
      icon: "back",
      hint: "Alt+←",
      command: "back",
      args: [],
    });
  if (active?.canGoForward)
    commands.push({
      id: "forward",
      title: "Go forward",
      detail: "Next page in this tab",
      icon: "forward",
      hint: "Alt+→",
      command: "forward",
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
