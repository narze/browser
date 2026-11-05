import { describe, expect, it } from "vite-plus/test";
import {
  browserCommands,
  canInvokeCommand,
  validateCommandHandlers,
  paletteCommands,
} from "../shared/commands.js";
import { defaultSettings } from "../shared/settings.js";
import type { BrowserState } from "../shared/browser";

const state: BrowserState = {
  palette: null,
  split: null,
  splitResizing: false,
  sidebarResizing: false,
  settingsOpen: false,
  archiveOpen: false,
  archive: [],
  folders: [],
  spaces: [{ id: 1, name: "Personal", color: "blue", profile: "browsing" }],
  activeSpaceId: 1,
  routes: [],
  sections: { favorites: [], folders: [], pinned: [], today: [[1]] },
  activeId: 1,
  platform: "darwin",
  tabSlots: [[1]],
  tabLayout: "top",
  resolvedTheme: "light",
  settings: { ...defaultSettings },
  tabs: [
    {
      id: 1,
      url: "",
      title: "New tab",
      loading: false,
      error: null,
      canGoBack: false,
      canGoForward: false,
      spaceId: 1,
      zone: "today",
      folderId: null,
      homeUrl: null,
      homeTitle: null,
      customTitle: null,
      favicon: null,
      asleep: false,
      lastActiveAt: 0,
    },
  ],
};

describe("browser command contract", () => {
  it("limits the palette to state and validated palette actions", () => {
    for (const name of Object.keys(browserCommands)) {
      expect(canInvokeCommand(name, "chrome", true)).toBe(true);
      expect(canInvokeCommand(name, "palette", true)).toBe(
        ["getState", "closePalette", "executePalette"].includes(name),
      );
      expect(canInvokeCommand(name, "remote", true)).toBe(false);
      expect(canInvokeCommand(name, "chrome", false)).toBe(false);
      expect(canInvokeCommand(name, "palette", false)).toBe(false);
    }
    expect(canInvokeCommand("constructor", "chrome", true)).toBe(false);
    expect(canInvokeCommand("missing", "chrome", true)).toBe(false);
  });

  it("rejects missing, nonfunction, and unregistered command handlers", () => {
    const handlers = Object.fromEntries(
      Object.keys(browserCommands).map((name) => [name, () => {}]),
    );
    expect(() => validateCommandHandlers(handlers)).not.toThrow();
    expect(() => validateCommandHandlers({ ...handlers, getState: undefined })).toThrow();
    expect(() => validateCommandHandlers({ ...handlers, unexpected: () => {} })).toThrow();
    delete handlers.getState;
    expect(() => validateCommandHandlers(handlers)).toThrow();
  });

  it("defines executable palette choices with current settings and tab context", () => {
    const choices = paletteCommands(state);
    expect(choices.find((command) => command.id === "theme-dark")).toMatchObject({
      title: "Dark theme",
      command: "updateSettings",
      args: [{ theme: "dark" }],
    });
    expect(choices.find((command) => command.id === "tabs-left")).toMatchObject({
      command: "updateSettings",
      args: [{ tabLayout: "left" }],
    });
    expect(choices.find((command) => command.id === "close-tab")).toMatchObject({
      command: "closeTab",
      args: [1],
    });
    expect(choices.some((command) => command.id === "back")).toBe(false);
    const navigable: BrowserState = {
      ...state,
      split: { tabIds: [1, 2], ratio: 0.5 },
      tabs: [{ ...state.tabs[0], url: "https://example.com/", canGoBack: true }],
    };
    expect(paletteCommands(navigable).find((command) => command.id === "split")?.title).toBe(
      "Exit split view",
    );
    expect(paletteCommands(navigable).some((command) => command.id === "back")).toBe(true);
  });

  it("offers tab organization commands for the current tab", () => {
    const blank = paletteCommands(state);
    expect(blank.some((command) => command.id === "pin-tab")).toBe(false);
    expect(blank.find((command) => command.id === "archive")).toMatchObject({
      command: "openArchive",
      args: [],
    });
    expect(blank.find((command) => command.id === "new-folder")?.command).toBe("createFolder");
    expect(blank.find((command) => command.id === "rename-tab")).toMatchObject({
      command: "editTab",
      args: [1],
    });
    const page = { ...state.tabs[0], url: "https://example.com/a" };
    const today = paletteCommands({ ...state, tabs: [page] });
    expect(today.find((command) => command.id === "pin-tab")).toMatchObject({
      title: "Pin tab",
      command: "moveTab",
      args: [1, "pinned", null, Number.MAX_SAFE_INTEGER],
    });
    expect(today.find((command) => command.id === "favorite-tab")).toMatchObject({
      title: "Add to favorites",
      args: [1, "favorites", null, Number.MAX_SAFE_INTEGER],
    });
    expect(today.some((command) => command.id === "reset-tab")).toBe(false);
    const pinned = { ...page, zone: "favorites" as const, homeUrl: "https://example.com/" };
    const choices = paletteCommands({ ...state, tabs: [pinned] });
    expect(choices.find((command) => command.id === "favorite-tab")).toMatchObject({
      title: "Remove from favorites",
      args: [1, "today", null, 0],
    });
    expect(choices.find((command) => command.id === "pin-tab")?.title).toBe("Pin tab");
    expect(choices.find((command) => command.id === "reset-tab")).toMatchObject({
      command: "resetTab",
      args: [1],
    });
  });
  it("offers space commands", () => {
    const work = {
      id: 2,
      name: "Work",
      color: "green" as const,
      profile: "space-0000000000000001",
    };
    const page = { ...state.tabs[0], url: "https://example.com/" };
    const choices = paletteCommands({ ...state, tabs: [page], spaces: [...state.spaces, work] });
    expect(choices.find((command) => command.id === "new-space")).toMatchObject({
      command: "createSpace",
      args: [],
    });
    expect(choices.find((command) => command.id === "space-2")).toMatchObject({
      title: "Switch to Work",
      command: "switchSpace",
      args: [2],
    });
    expect(choices.some((command) => command.id === "space-1")).toBe(false);
    expect(choices.find((command) => command.id === "move-to-space-2")).toMatchObject({
      title: "Move tab to Work",
      command: "moveTabToSpace",
      args: [1, 2],
    });
    expect(paletteCommands(state).some((command) => command.id.startsWith("space-"))).toBe(false);
  });
  it("shows the current keyboard shortcut for each palette command", () => {
    const hints = (choices: ReturnType<typeof paletteCommands>) =>
      Object.fromEntries(choices.map((command) => [command.id, command.hint]));
    const page = { ...state.tabs[0], url: "https://example.com/", title: "Example" };
    expect(hints(paletteCommands({ ...state, tabs: [page] }))).toMatchObject({
      "new-tab": "⌘T",
      settings: "⌘,",
      split: "⌃⇧=",
      "close-tab": "⌘W",
      reload: "⌘R",
      "pin-tab": "⌘D",
      archive: "⇧⌘A",
    });
    const custom = {
      ...state,
      platform: "linux",
      tabs: [page],
      settings: { ...state.settings, shortcuts: { newTab: "Ctrl+Alt+N", reload: "" } },
    };
    expect(hints(paletteCommands(custom))).toMatchObject({
      "new-tab": "Ctrl+Alt+N",
      reload: "",
      "close-tab": "Ctrl+W",
    });
  });

  it("offers the sidebar toggle only for side tab layouts", () => {
    expect(paletteCommands(state).some((command) => command.id === "toggle-sidebar")).toBe(false);
    const side: BrowserState = { ...state, tabLayout: "left" };
    expect(paletteCommands(side).find((command) => command.id === "toggle-sidebar")).toMatchObject({
      title: "Hide tab sidebar",
      command: "toggleSidebar",
      args: [],
    });
    const hidden: BrowserState = {
      ...side,
      settings: { ...side.settings, sidebarVisible: false },
    };
    expect(paletteCommands(hidden).find((command) => command.id === "toggle-sidebar")?.title).toBe(
      "Show tab sidebar",
    );
  });
});
