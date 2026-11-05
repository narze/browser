import { describe, expect, it } from "vite-plus/test";
import { createBrowserSession } from "../electron/browser-session.cjs";

function threeTabs() {
  const session = createBrowserSession();
  for (const name of ["a", "b", "c"])
    session.dispatch({ type: "new-tab", url: `https://${name}.test/` });
  return session;
}

describe("browser session", () => {
  it("owns tab lifetime and always replaces the last closed tab", () => {
    const session = createBrowserSession();
    const first = session.dispatch({ type: "new-tab" });
    expect(first.state.tabs).toHaveLength(1);
    expect(first.state.activeId).toBe(1);
    expect(first.effects).toContainEqual({ type: "focus" });
    session.dispatch({ type: "close-tab", id: 1 });
    expect(session.getState().tabs.map((tab) => tab.id)).toEqual([2]);
    expect(session.getState().activeId).toBe(2);
    session.dispatch({ type: "close-tab", id: 99 });
    expect(session.getState().tabs).toHaveLength(1);
  });

  it("returns page loads as effects and keeps new-tab page visibility in the session", () => {
    const session = createBrowserSession();
    const opened = session.dispatch({ type: "new-tab", url: "https://a.test/" });
    expect(opened.effects).toContainEqual({ type: "load", id: 1, url: "https://a.test/" });
    expect(opened.state.pages).toEqual([{ id: 1, visible: true }]);
    session.dispatch({ type: "navigate", id: 1, url: "" });
    expect(session.getState().pages).toEqual([{ id: 1, visible: false }]);
    expect(session.getState().tabs[0]).toMatchObject({ title: "New tab", url: "", loading: false });
  });

  it("uses the visible segment order for numeric and cycle commands", () => {
    const session = threeTabs();
    session.dispatch({ type: "toggle-split" });
    expect(session.getState().tabSlots).toEqual([[3, 1], [2]]);
    session.dispatch({ type: "select-position", position: 1 });
    expect(session.getState().activeId).toBe(3);
    session.dispatch({ type: "cycle-tab", direction: 1 });
    expect(session.getState().activeId).toBe(1);
    session.dispatch({ type: "cycle-tab", direction: -1 });
    expect(session.getState().activeId).toBe(3);
    session.dispatch({ type: "select-position", position: 9 });
    expect(session.getState().activeId).toBe(2);
    session.dispatch({ type: "select-position", position: 8 });
    expect(session.getState().activeId).toBe(2);
  });

  it.each([
    { direction: 1, expected: [1, 2, 3, 1, 2, 3] },
    { direction: -1, expected: [2, 1, 3, 2, 1, 3] },
  ])(
    "visits every tab in full cycles with direction $direction while panes are replaced",
    ({ direction, expected }) => {
      const session = threeTabs();
      session.dispatch({ type: "toggle-split" });
      const visited = expected.map(() => {
        session.dispatch({ type: "cycle-tab", direction });
        // Native page events must not reset a keyboard traversal in progress.
        session.dispatch({ type: "update-tab", id: 1, patch: { loading: false } });
        return session.getState().activeId;
      });
      expect(visited).toEqual(expected);
      // An explicit selection starts the next traversal from the new visible order.
      session.dispatch({ type: "select-tab", id: 1 });
      expect(session.getState().tabSlots).toEqual([[1, 3], [2]]);
      session.dispatch({ type: "cycle-tab", direction: 1 });
      expect(session.getState().activeId).toBe(3);
    },
  );

  it("creates a second tab when splitting one tab and preserves the focused tab on exit", () => {
    const session = createBrowserSession();
    session.dispatch({ type: "new-tab" });
    session.dispatch({ type: "toggle-split" });
    expect(session.getState()).toMatchObject({
      activeId: 2,
      split: { tabIds: [1, 2], ratio: 0.5 },
    });
    session.dispatch({ type: "toggle-split" });
    expect(session.getState()).toMatchObject({ activeId: 2, split: null, tabSlots: [[1], [2]] });
  });

  it("replaces only the focused pane and swaps opposite pane selections", () => {
    const session = threeTabs();
    session.dispatch({ type: "toggle-split" });
    session.dispatch({ type: "select-tab", id: 2 });
    expect(session.getState().split?.tabIds).toEqual([2, 1]);
    session.dispatch({ type: "set-split-tab", side: 1, id: 2 });
    expect(session.getState().split?.tabIds).toEqual([1, 2]);
    expect(session.getState().activeId).toBe(2);
    session.dispatch({ type: "new-tab" });
    expect(session.getState().split?.tabIds).toEqual([1, 4]);
    expect(() => session.dispatch({ type: "set-split-tab", side: 2, id: 1 })).toThrow();
    expect(() => session.dispatch({ type: "set-split-tab", side: 0, id: 99 })).toThrow();
  });

  it.each([1, 3])("expands the survivor when split tab %s closes", (id) => {
    const session = threeTabs();
    session.dispatch({ type: "toggle-split" });
    session.dispatch({ type: "set-split-resizing", resizing: true });
    session.dispatch({ type: "close-tab", id });
    expect(session.getState()).toMatchObject({
      activeId: id === 1 ? 3 : 1,
      split: null,
      splitResizing: false,
    });
    expect(session.getState().pages.filter((page) => page.visible)).toHaveLength(1);
  });

  it("clamps ratios, keeps native pages visible during resize, and hides them for settings", () => {
    const session = threeTabs();
    session.dispatch({ type: "toggle-split" });
    expect(session.getState().pages.filter((page) => page.visible)).toHaveLength(2);
    session.dispatch({ type: "resize-split", ratio: 8 });
    expect(session.getState().split?.ratio).toBe(0.75);
    session.dispatch({ type: "resize-split", ratio: -8 });
    expect(session.getState().split?.ratio).toBe(0.25);
    expect(() => session.dispatch({ type: "resize-split", ratio: NaN })).toThrow();
    session.dispatch({ type: "set-split-resizing", resizing: true });
    expect(
      session
        .getState()
        .pages.filter((page) => page.visible)
        .map((page) => page.id),
    ).toEqual([1, 3]);
    session.dispatch({ type: "show-settings", open: true });
    expect(session.getState().splitResizing).toBe(false);
    expect(session.getState().pages.every((page) => !page.visible)).toBe(true);
    session.dispatch({ type: "set-split-resizing", resizing: true });
    expect(session.getState().splitResizing).toBe(false);
    session.dispatch({ type: "show-settings", open: false });
    expect(session.getState().pages.filter((page) => page.visible)).toHaveLength(2);
  });

  it.each([false, true])(
    "keeps native pages visible while the sidebar resizes (split: %s) and clears resize state",
    (split) => {
      const session = threeTabs();
      if (split) session.dispatch({ type: "toggle-split" });
      const pages = session.getState().pages;
      session.dispatch({ type: "set-sidebar-resizing", resizing: true });
      expect(session.getState().sidebarResizing).toBe(true);
      expect(session.getState().pages).toEqual(pages);
      session.dispatch({ type: "set-sidebar-resizing", resizing: false });
      expect(session.getState().pages).toEqual(pages);
      expect(() =>
        session.dispatch({ type: "set-sidebar-resizing", resizing: "yes" as never }),
      ).toThrow();
      for (const command of [
        { type: "show-settings", open: false },
        { type: "open-palette", mode: "commands" },
        { type: "select-tab", id: 1 },
      ] as const) {
        session.dispatch({ type: "set-sidebar-resizing", resizing: true });
        session.dispatch(command);
        expect(session.getState().sidebarResizing).toBe(false);
      }
      session.dispatch({ type: "open-palette", mode: "commands" });
      session.dispatch({ type: "set-sidebar-resizing", resizing: true });
      expect(session.getState().sidebarResizing).toBe(false);
    },
  );

  it("tracks page focus only for visible split panes", () => {
    const session = threeTabs();
    session.dispatch({ type: "focus-tab", id: 1 });
    expect(session.getState().activeId).toBe(3);
    session.dispatch({ type: "toggle-split" });
    session.dispatch({ type: "focus-tab", id: 1 });
    expect(session.getState().activeId).toBe(1);
    session.dispatch({ type: "show-settings", open: true });
    session.dispatch({ type: "focus-tab", id: 3 });
    expect(session.getState().activeId).toBe(1);
  });

  it("leaves split pages visible under the palette and clears the palette on selection", () => {
    const session = threeTabs();
    session.dispatch({ type: "toggle-split" });
    session.dispatch({ type: "set-split-resizing", resizing: true });
    session.dispatch({ type: "open-palette", mode: "navigate" });
    expect(session.getState()).toMatchObject({
      splitResizing: false,
      palette: { query: "https://c.test/", requestId: 1 },
    });
    expect(session.getState().pages.filter((page) => page.visible)).toHaveLength(2);
    session.dispatch({ type: "open-palette", mode: "commands" });
    expect(session.getState().palette).toMatchObject({ query: "", requestId: 2 });
    session.dispatch({ type: "select-tab", id: 1 });
    expect(session.getState().palette).toBeNull();
    session.dispatch({ type: "update-tab", id: 1, patch: { error: "Failed" } });
    expect(session.getState().pages.find((page) => page.id === 1)?.visible).toBe(false);
  });

  it("protects session state from snapshot and command-patch mutations", () => {
    const session = threeTabs();
    session.dispatch({ type: "toggle-split" });
    const snapshot = session.getState();
    snapshot.split!.tabIds[0] = 88;
    snapshot.tabs[0].title = "Changed";
    snapshot.tabSlots[0][0] = 99;
    expect(session.getState().split?.tabIds).toEqual([3, 1]);
    expect(session.getState().tabs[0].title).not.toBe("Changed");
    session.dispatch({ type: "close-tab", id: 2 });
    session.dispatch({ type: "update-tab", id: 2, patch: { loading: true } });
    expect(session.getState().tabs).toHaveLength(2);
  });
});
