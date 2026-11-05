import { describe, expect, it } from "vite-plus/test";
import { createBrowserSession } from "../electron/browser-session.cjs";

function tabs(count: number) {
  const session = createBrowserSession();
  for (let index = 0; index < count; index++)
    session.dispatch({ type: "new-tab", url: `https://${"abcdef"[index]}.test/` });
  return session;
}
const visible = (session: ReturnType<typeof createBrowserSession>) =>
  session
    .getState()
    .pages.filter((page) => page.visible)
    .map((page) => page.id);

describe("split view with more panes", () => {
  it("adds empty panes up to four and shows every pane in one tab slot", () => {
    const session = tabs(2);
    session.dispatch({ type: "toggle-split" });
    session.dispatch({ type: "add-split-pane" });
    expect(session.getState()).toMatchObject({
      activeId: 3,
      split: { tabIds: [2, 1, 3], layout: "columns", columns: [1 / 3, 1 / 3, 1 / 3], rows: [1] },
      tabSlots: [[2, 1, 3]],
    });
    expect(session.getState().tabs.find((tab) => tab.id === 3)?.url).toBe("");
    session.dispatch({ type: "add-split-pane" });
    expect(session.getState().split?.tabIds).toEqual([2, 1, 3, 4]);
    expect(() => session.dispatch({ type: "add-split-pane" })).toThrow();
    expect(visible(session)).toEqual([1, 2]);
    session.dispatch({ type: "navigate", id: 4, url: "https://d.test/" });
    expect(visible(session)).toEqual([1, 2, 4]);
  });

  it("starts a split from one page when adding a pane", () => {
    const session = tabs(1);
    session.dispatch({ type: "add-split-pane" });
    expect(session.getState()).toMatchObject({ activeId: 2, split: { tabIds: [1, 2] } });
  });

  it("arranges panes in columns, rows, or a grid and resets their sizes", () => {
    const session = tabs(4);
    session.dispatch({ type: "toggle-split" });
    expect(() => session.dispatch({ type: "set-split-layout", layout: "grid" })).toThrow();
    session.dispatch({ type: "set-split-layout", layout: "rows" });
    expect(session.getState().split).toMatchObject({
      layout: "rows",
      columns: [1],
      rows: [0.5, 0.5],
    });
    session.dispatch({ type: "add-split-pane" });
    session.dispatch({ type: "set-split-layout", layout: "grid" });
    expect(session.getState().split).toMatchObject({
      layout: "grid",
      columns: [0.5, 0.5],
      rows: [0.5, 0.5],
    });
    expect(() =>
      session.dispatch({ type: "set-split-layout", layout: "diagonal" as never }),
    ).toThrow();
    // Removing a pane from a grid of three leaves two side by side.
    session.dispatch({ type: "remove-split-pane", id: session.getState().split!.tabIds[2] });
    expect(session.getState().split).toMatchObject({ layout: "columns", columns: [0.5, 0.5] });
  });

  it("resizes the two tracks next to a divider and keeps every pane usable", () => {
    const session = tabs(3);
    session.dispatch({ type: "toggle-split" });
    session.dispatch({ type: "add-split-pane" });
    session.dispatch({ type: "resize-split", axis: "columns", index: 1, ratio: 0.25 });
    const [first, second, third] = session.getState().split!.columns;
    expect(first).toBeCloseTo(1 / 3);
    expect(second).toBeCloseTo(1 / 6);
    expect(third).toBeCloseTo(1 / 2);
    session.dispatch({ type: "resize-split", axis: "columns", index: 0, ratio: 0 });
    expect(session.getState().split!.columns[0]).toBeCloseTo(1 / 6);
    expect(session.getState().split!.columns.reduce((sum, size) => sum + size)).toBeCloseTo(1);
    expect(() =>
      session.dispatch({ type: "resize-split", axis: "columns", index: 2, ratio: 0.5 }),
    ).toThrow();
    expect(() =>
      session.dispatch({ type: "resize-split", axis: "rows", index: 0, ratio: 0.5 }),
    ).toThrow();
  });

  it("splits by dropping a tab on a page edge, and inserts, moves, or replaces panes", () => {
    const session = tabs(5);
    session.dispatch({ type: "select-tab", id: 1 });
    session.dispatch({ type: "split-with", id: 2, target: 1, edge: "left" });
    expect(session.getState()).toMatchObject({
      activeId: 2,
      split: { tabIds: [2, 1], layout: "columns" },
    });
    session.dispatch({ type: "toggle-split" });
    session.dispatch({ type: "split-with", id: 2, target: 2, edge: "left" });
    expect(session.getState().split).toBeNull();
    session.dispatch({ type: "split-with", id: 3, target: 2, edge: "bottom" });
    expect(session.getState().split).toMatchObject({ tabIds: [2, 3], layout: "rows" });
    session.dispatch({ type: "split-with", id: 4, target: 2, edge: "bottom" });
    expect(session.getState().split?.tabIds).toEqual([2, 4, 3]);
    session.dispatch({ type: "split-with", id: 3, target: 2, edge: "top" });
    expect(session.getState().split?.tabIds).toEqual([3, 2, 4]);
    session.dispatch({ type: "split-with", id: 5, target: 4, edge: "right" });
    expect(session.getState().split?.tabIds).toEqual([3, 2, 4, 5]);
    session.dispatch({ type: "split-with", id: 1, target: 2, edge: "left" });
    expect(session.getState()).toMatchObject({ activeId: 1, split: { tabIds: [3, 1, 4, 5] } });
    expect(visible(session)).toEqual([1, 3, 4, 5]);
    expect(() =>
      session.dispatch({ type: "split-with", id: 2, target: 2, edge: "left" }),
    ).toThrow();
    expect(() =>
      session.dispatch({ type: "split-with", id: 2, target: 1, edge: "up" as never }),
    ).toThrow();
  });

  it("removes panes, closes split tabs, and replaces only the focused pane", () => {
    const session = tabs(5);
    session.dispatch({ type: "toggle-split" });
    session.dispatch({ type: "split-with", id: 2, target: 1, edge: "right" });
    session.dispatch({ type: "split-with", id: 3, target: 2, edge: "right" });
    expect(session.getState().split?.tabIds).toEqual([5, 1, 2, 3]);
    session.dispatch({ type: "select-tab", id: 4 });
    expect(session.getState().split?.tabIds).toEqual([5, 1, 2, 4]);
    session.dispatch({ type: "set-split-tab", side: 0, id: 4 });
    expect(session.getState().split?.tabIds).toEqual([4, 1, 2, 5]);
    session.dispatch({ type: "close-tab", id: 1 });
    expect(session.getState()).toMatchObject({ activeId: 4, split: { tabIds: [4, 2, 5] } });
    session.dispatch({ type: "remove-split-pane", id: 4 });
    expect(session.getState()).toMatchObject({ activeId: 2, split: { tabIds: [2, 5] } });
    expect(session.getState().tabs.some((tab) => tab.id === 4)).toBe(true);
    session.dispatch({ type: "remove-split-pane", id: 5 });
    expect(session.getState()).toMatchObject({ activeId: 2, split: null });
    expect(() => session.dispatch({ type: "remove-split-pane", id: 2 })).toThrow();
  });

  it("splits only with tabs of the active space", () => {
    const session = tabs(2);
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "add-split-pane" });
    const [own, added] = session.getState().split!.tabIds;
    expect(session.getState().tabs.find((tab) => tab.id === added)?.spaceId).toBe(2);
    expect(() =>
      session.dispatch({ type: "split-with", id: 1, target: own, edge: "left" }),
    ).toThrow();
    expect(() => session.dispatch({ type: "set-split-tab", side: 0, id: 1 })).toThrow();
    expect(session.getState().split?.tabIds).toEqual([own, added]);
  });

  it("hides the native pages while a tab is dragged over them", () => {
    const session = tabs(2);
    expect(visible(session)).toEqual([2]);
    session.dispatch({ type: "set-tab-dragging", dragging: true });
    expect(session.getState().tabDragging).toBe(true);
    expect(visible(session)).toEqual([]);
    session.dispatch({ type: "set-tab-dragging", dragging: false });
    expect(visible(session)).toEqual([2]);
    session.dispatch({ type: "set-tab-dragging", dragging: true });
    session.dispatch({ type: "split-with", id: 1, target: 2, edge: "right" });
    expect(session.getState()).toMatchObject({ tabDragging: false, split: { tabIds: [2, 1] } });
    expect(visible(session)).toEqual([1, 2]);
    session.dispatch({ type: "show-settings", open: true });
    session.dispatch({ type: "set-tab-dragging", dragging: true });
    expect(session.getState().tabDragging).toBe(false);
    expect(() =>
      session.dispatch({ type: "set-tab-dragging", dragging: "yes" as never }),
    ).toThrow();
  });
});
