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
});
