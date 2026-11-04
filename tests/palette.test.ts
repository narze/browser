import { describe, expect, it } from "vite-plus/test";
import { paletteResults } from "../src/palette";
import type { BrowserState } from "../shared/browser";

const state: BrowserState = {
  palette: null,
  resolvedTheme: "light",
  platform: "darwin",
  activeId: 2,
  tabs: [
    {
      id: 1,
      title: "Svelte documentation",
      url: "https://svelte.dev/docs",
      loading: false,
      error: null,
      canGoBack: false,
      canGoForward: false,
    },
    {
      id: 2,
      title: "GitHub",
      url: "https://github.com",
      loading: false,
      error: null,
      canGoBack: true,
      canGoForward: false,
    },
  ],
  split: null,
  splitResizing: false,
  tabLayout: "top",
  settingsOpen: false,
  settings: { theme: "system", tabLayout: "top", searchEngine: "duckduckgo", showShortcuts: true },
};
describe("command palette results", () => {
  it("offers navigation plus matching open tabs for a query", () => {
    const results = paletteResults("svelte docs", state);
    expect(results[0].action).toEqual({ type: "navigate", input: "svelte docs", newTab: false });
    expect(results.find((result) => result.id === "tab-1")?.action).toEqual({ type: "tab", id: 1 });
    expect(results.some((result) => result.id === "tab-2")).toBe(false);
  });
  it("limits > queries to commands and handles no matches", () => {
    expect(paletteResults("> dark", state).map((result) => result.action)).toEqual([
      { type: "command", id: "theme-dark" },
    ]);
    expect(paletteResults("> missing command", state)).toEqual([]);
  });
  it("starts with the active tab for empty input and shows contextual commands", () => {
    const results = paletteResults("", state);
    expect(results[0].id).toBe("tab-2");
    expect(paletteResults("> forward", state)).toEqual([]);
    expect(paletteResults("> back", state)[0].action).toEqual({ type: "command", id: "back" });
    expect(
      paletteResults("> split", { ...state, split: { tabIds: [1, 2], ratio: 0.5 } })[0].title,
    ).toBe("Exit split view");
  });
});
