import { describe, expect, it } from "vite-plus/test";
import { paletteResults } from "../src/palette";
import type { BrowserState } from "../shared/browser";

const state: BrowserState = {
  palette: null,
  resolvedTheme: "light",
  platform: "darwin",
  activeId: 2,
  tabSlots: [[1], [2]],
  tabs: [
    {
      id: 1,
      title: "Svelte documentation",
      url: "https://svelte.dev/docs",
      loading: false,
      error: null,
      canGoBack: false,
      canGoForward: false,
      zone: "today",
      folderId: null,
      homeUrl: null,
      homeTitle: null,
      customTitle: null,
      favicon: null,
      asleep: false,
      lastActiveAt: 0,
    },
    {
      id: 2,
      title: "GitHub",
      url: "https://github.com",
      loading: false,
      error: null,
      canGoBack: true,
      canGoForward: false,
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
  split: null,
  splitResizing: false,
  sidebarResizing: false,
  tabLayout: "top",
  settingsOpen: false,
  archiveOpen: false,
  archive: [],
  folders: [],
  sections: { favorites: [], folders: [], pinned: [], today: [[1], [2]] },
  settings: {
    theme: "system",
    tabLayout: "top",
    searchEngine: "duckduckgo",
    showShortcuts: true,
    sidebarWidth: 220,
    archiveAfter: "12h",
    sleepAfter: "1h",
  },
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
  it("shows and searches custom tab names", () => {
    const renamed = {
      ...state,
      tabs: state.tabs.map((tab) => (tab.id === 1 ? { ...tab, customTitle: "Reading list" } : tab)),
    };
    const result = paletteResults("reading", renamed).find((entry) => entry.id === "tab-1");
    expect(result?.title).toBe("Reading list");
    expect(
      paletteResults("svelte documentation", renamed).some((entry) => entry.id === "tab-1"),
    ).toBe(true);
  });
});
