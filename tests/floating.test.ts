import { describe, expect, it } from "vite-plus/test";
import { createBrowserSession } from "../electron/browser-session.cjs";

let profiles = 0;
const newProfile = () => `space-${String(++profiles).padStart(16, "0")}`;
function tabs(count: number) {
  const session = createBrowserSession({ now: () => 1_000, newProfile });
  for (let index = 0; index < count; index++)
    session.dispatch({ type: "new-tab", url: `https://${"abcdef"[index]}.test/` });
  return session;
}
const pages = (session: ReturnType<typeof createBrowserSession>) =>
  session.getState().pages.map((page) => [page.id, page.visible]);

describe("peek", () => {
  it("opens a link above the current page without adding a tab", () => {
    const session = tabs(2);
    const { state, effects } = session.dispatch({
      type: "open-float",
      kind: "peek",
      url: "https://peek.test/a",
    });
    expect(state.peek).toMatchObject({ id: 3, url: "https://peek.test/a", loading: true });
    expect(state.tabs.map((tab) => tab.id)).toEqual([1, 2]);
    expect(state.tabSlots.flat()).toEqual([1, 2]);
    expect(state.activeId).toBe(2);
    expect(effects).toEqual([
      { type: "load", id: 3, url: "https://peek.test/a" },
      { type: "focus" },
    ]);
    // The page below stays visible; the peek shows above it.
    expect(pages(session)).toEqual([
      [1, false],
      [2, true],
      [3, true],
    ]);
  });

  it("reports page changes, and loads a new link in the open peek", () => {
    const session = tabs(1);
    session.dispatch({ type: "open-float", kind: "peek", url: "https://peek.test/a" });
    session.dispatch({ type: "update-tab", id: 2, patch: { title: "Peeked", loading: false } });
    expect(session.getState().peek).toMatchObject({ title: "Peeked", loading: false });
    const { state, effects } = session.dispatch({
      type: "open-float",
      kind: "peek",
      url: "https://peek.test/b",
    });
    expect(state.peek).toMatchObject({ id: 2, url: "https://peek.test/b", loading: true });
    expect(effects).toContainEqual({ type: "load", id: 2, url: "https://peek.test/b" });
  });

  it("closes, and gives the focus back to the page", () => {
    const session = tabs(1);
    session.dispatch({ type: "open-float", kind: "peek", url: "https://peek.test/a" });
    const { state, effects } = session.dispatch({ type: "close-float", kind: "peek" });
    expect(state.peek).toBeNull();
    expect(state.pages.map((page) => page.id)).toEqual([1]);
    expect(effects).toEqual([{ type: "focus" }]);
  });

  it("expands into a tab that keeps its page", () => {
    const session = tabs(2);
    session.dispatch({ type: "open-float", kind: "peek", url: "https://peek.test/a" });
    session.dispatch({ type: "update-tab", id: 3, patch: { title: "Peeked", loading: false } });
    const { state, effects } = session.dispatch({ type: "expand-float", kind: "peek" });
    expect(state.peek).toBeNull();
    expect(state.activeId).toBe(3);
    expect(state.tabs.find((tab) => tab.id === 3)).toMatchObject({
      url: "https://peek.test/a",
      title: "Peeked",
      zone: "today",
      spaceId: 1,
    });
    expect(state.tabSlots.flat()).toEqual([1, 2, 3]);
    // No load: the page view moves into the tab as it is.
    expect(effects).toEqual([{ type: "focus" }]);
  });

  it("closes when the user leaves the page below", () => {
    for (const command of [
      { type: "select-tab", id: 1 },
      { type: "new-tab" },
      { type: "show-settings", open: true },
      { type: "open-palette", mode: "commands" },
      { type: "create-space" },
    ] as const) {
      const session = tabs(2);
      session.dispatch({ type: "open-float", kind: "peek", url: "https://peek.test/a" });
      expect(session.dispatch(command).state.peek).toBeNull();
    }
  });

  it("accepts only web links, and never over settings", () => {
    const session = tabs(1);
    for (const url of ["", "file:///etc/hosts", "javascript:alert(1)"])
      expect(() => session.dispatch({ type: "open-float", kind: "peek", url })).toThrow();
    session.dispatch({ type: "show-settings", open: true });
    expect(() =>
      session.dispatch({ type: "open-float", kind: "peek", url: "https://peek.test/" }),
    ).toThrow();
    expect(() => session.dispatch({ type: "expand-float", kind: "peek" })).toThrow();
    expect(() =>
      session.dispatch({ type: "open-float", kind: "other" as never, url: "https://a.test/" }),
    ).toThrow();
  });
});

describe("quick window", () => {
  it("opens empty or with a link, outside the tab list", () => {
    const session = tabs(1);
    let { state, effects } = session.dispatch({ type: "open-float", kind: "mini", url: "" });
    expect(state.mini).toMatchObject({ id: 2, url: "", spaceId: 1 });
    expect(state.tabs.map((tab) => tab.id)).toEqual([1]);
    expect(effects).toEqual([]);
    expect(pages(session)).toEqual([
      [1, true],
      [2, false],
    ]);
    ({ state, effects } = session.dispatch({
      type: "open-float",
      kind: "mini",
      url: "https://mini.test/",
    }));
    expect(state.mini).toMatchObject({ id: 2, url: "https://mini.test/", loading: true });
    expect(effects).toEqual([{ type: "load", id: 2, url: "https://mini.test/" }]);
    expect(pages(session)).toEqual([
      [1, true],
      [2, true],
    ]);
  });

  it("stays open while the main window changes tabs, and with the settings open", () => {
    const session = tabs(2);
    session.dispatch({ type: "open-float", kind: "mini", url: "https://mini.test/" });
    session.dispatch({ type: "select-tab", id: 1 });
    session.dispatch({ type: "show-settings", open: true });
    expect(session.getState().mini).toMatchObject({ id: 3 });
    expect(pages(session)).toContainEqual([3, true]);
  });

  it("uses the space that a site route names", () => {
    const session = tabs(1);
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "add-route", host: "work.test", spaceId: 2 });
    session.dispatch({ type: "switch-space", id: 1 });
    const { state } = session.dispatch({
      type: "open-float",
      kind: "mini",
      url: "https://app.work.test/",
    });
    expect(state.mini?.spaceId).toBe(2);
    expect(state.activeSpaceId).toBe(1);
  });

  it("moves its page into the main window as a tab of its space", () => {
    const session = tabs(1);
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "add-route", host: "work.test", spaceId: 2 });
    session.dispatch({ type: "switch-space", id: 1 });
    session.dispatch({ type: "open-float", kind: "mini", url: "https://work.test/" });
    const { state, effects } = session.dispatch({ type: "expand-float", kind: "mini" });
    expect(state.mini).toBeNull();
    expect(state).toMatchObject({ activeId: 3, activeSpaceId: 2 });
    expect(state.tabs.find((tab) => tab.id === 3)).toMatchObject({
      url: "https://work.test/",
      spaceId: 2,
    });
    expect(effects).toEqual([{ type: "focus" }]);
  });

  it("closes with the space it browses in", () => {
    const session = tabs(1);
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "open-float", kind: "mini", url: "https://mini.test/" });
    session.dispatch({ type: "delete-space", id: 2 });
    expect(session.getState().mini).toBeNull();
  });

  it("does not move an empty quick window into a tab", () => {
    const session = tabs(1);
    session.dispatch({ type: "open-float", kind: "mini", url: "" });
    expect(() => session.dispatch({ type: "expand-float", kind: "mini" })).toThrow();
    expect(session.dispatch({ type: "close-float", kind: "mini" }).state.mini).toBeNull();
  });
});
