import { describe, expect, it } from "vite-plus/test";
import { createBrowserSession } from "../electron/browser-session.cjs";

let profiles = 0;
const newProfile = () => `space-${String(++profiles).padStart(16, "0")}`;
type Session = ReturnType<typeof createBrowserSession>;
const save = (session: Session) => JSON.parse(JSON.stringify(session.exportOrganization()));

function setup(names = ["a", "b", "c"]) {
  const session = createBrowserSession({ now: () => 1_000, newProfile });
  for (const name of names) session.dispatch({ type: "new-tab", url: `https://${name}.test/` });
  return session;
}

describe("session restore (D6)", () => {
  it("saves today tabs, the active tab, and the split, and restores them asleep", () => {
    const session = setup();
    session.dispatch({ type: "new-tab" });
    session.dispatch({ type: "select-tab", id: 2 });
    session.dispatch({ type: "split-with", id: 3, target: 2, edge: "right" });
    session.dispatch({ type: "resize-split", ratio: 0.3 });
    session.dispatch({ type: "rename-tab", id: 1, title: "Mine" });
    const saved = save(session);
    expect(saved.version).toBe(4);

    const restored = createBrowserSession({ now: () => 9_000, saved, newProfile });
    const state = restored.getState();
    // The blank new tab is not saved. Idle time starts again at the restart.
    expect(
      state.tabs.map((tab) => [tab.id, tab.zone, tab.url, tab.customTitle, tab.asleep]),
    ).toEqual([
      [1, "today", "https://a.test/", "Mine", true],
      [2, "today", "https://b.test/", null, true],
      [3, "today", "https://c.test/", null, true],
    ]);
    expect(state.tabs.every((tab) => tab.lastActiveAt === 9_000)).toBe(true);
    expect(state.activeId).toBe(3);
    expect(state.split).toEqual({
      tabIds: [2, 3],
      layout: "columns",
      columns: [0.3, 0.7],
      rows: [1],
    });
    expect(state.sections.today).toEqual([[1], [2, 3]]);

    // Showing the restored tabs wakes them.
    const shown = restored.dispatch({ type: "select-tab", id: state.activeId });
    expect(shown.effects).toEqual(
      expect.arrayContaining([
        { type: "wake", id: 2, url: "https://b.test/" },
        { type: "wake", id: 3, url: "https://c.test/" },
      ]),
    );
    expect(shown.state.tabs.filter((tab) => !tab.asleep).map((tab) => tab.id)).toEqual([2, 3]);
  });

  it("restores the active tab and split of every space", () => {
    const session = setup(["a", "b"]);
    session.dispatch({ type: "toggle-split" });
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "navigate", id: 3, url: "https://w.test/" });
    session.dispatch({ type: "new-tab", url: "https://x.test/" });
    session.dispatch({ type: "add-split-pane" });
    session.dispatch({ type: "navigate", id: 5, url: "https://y.test/" });
    session.dispatch({ type: "split-with", id: 3, target: 4, edge: "left" });
    session.dispatch({ type: "set-split-layout", layout: "grid" });
    session.dispatch({ type: "select-tab", id: 4 });
    session.dispatch({ type: "switch-space", id: 1 });
    const saved = save(session);

    const restored = createBrowserSession({ now: () => 9_000, saved, newProfile });
    expect(restored.getState()).toMatchObject({
      activeSpaceId: 1,
      activeId: 2,
      split: { tabIds: [2, 1], layout: "columns" },
    });
    const work = restored.dispatch({ type: "switch-space", id: 2 }).state;
    expect(work).toMatchObject({
      activeSpaceId: 2,
      activeId: 4,
      split: {
        tabIds: [3, 4, 5],
        layout: "grid",
        columns: [0.5, 0.5],
        rows: [0.5, 0.5],
      },
    });
  });

  it("restores a pinned tab on the page it showed, with its home page", () => {
    const session = setup(["a"]);
    session.dispatch({ type: "move-tab", id: 1, zone: "pinned", folderId: null, index: 0 });
    session.dispatch({ type: "navigate", id: 1, url: "https://a.test/next" });
    session.dispatch({ type: "update-tab", id: 1, patch: { title: "Next" } });
    const restored = createBrowserSession({ saved: save(session), newProfile });
    expect(restored.getState().tabs[0]).toMatchObject({
      zone: "pinned",
      url: "https://a.test/next",
      title: "Next",
      homeUrl: "https://a.test/",
      asleep: true,
    });
    expect(restored.getState().activeId).toBe(1);
  });

  it("drops damaged tabs, active tabs, and splits", () => {
    const space = { id: 1, name: "Personal", color: "blue", profile: "browsing" };
    const work = { id: 2, name: "Work", color: "red", profile: "space-00000000000000aa" };
    const tab = (id: number, url: string, spaceId = 1) => ({ id, spaceId, zone: "today", url });
    const restore = (spaceViews: unknown) =>
      createBrowserSession({
        saved: {
          version: 4,
          activeSpaceId: 1,
          spaces: [space, work],
          tabs: [
            tab(1, "https://a.test/"),
            tab(2, "https://b.test/"),
            tab(3, "https://c.test/", 2),
            tab(4, "https://d.test/"),
            tab(5, "javascript:alert(1)"),
          ],
          spaceViews,
        },
      }).getState();

    const state = restore([{ spaceId: 1, activeId: 5, split: null }]);
    expect(state.tabs.map((entry) => entry.url)).toEqual([
      "https://a.test/",
      "https://b.test/",
      "https://c.test/",
      "https://d.test/",
    ]);
    expect(state.activeId).toBe(0);

    const split = (value: unknown, activeId = 1) =>
      restore([{ spaceId: 1, activeId, split: value }]).split;
    // A pane of a damaged, missing, or other-space tab ends the split.
    const sizes = { layout: "columns", columns: [0.5, 0.5], rows: [1] };
    expect(split({ tabIds: [1, 5], ...sizes })).toBe(null);
    expect(split({ tabIds: [1, 3], ...sizes })).toBe(null);
    expect(split({ tabIds: [1, 1], ...sizes })).toBe(null);
    expect(split({ tabIds: [1], ...sizes })).toBe(null);
    expect(split({ tabIds: [1, 2, 4, 1, 2], ...sizes })).toBe(null);
    expect(split("x")).toBe(null);
    // The active tab must be one of the panes, as when a space is shown again.
    expect(split({ tabIds: [1, 2], ...sizes }, 4)).toBe(null);
    // Bad sizes and layouts fall back to equal panes in columns.
    expect(split({ tabIds: [1, 2], layout: "spiral", columns: [9, -8], rows: [1] })).toEqual({
      tabIds: [1, 2],
      layout: "columns",
      columns: [0.5, 0.5],
      rows: [1],
    });
    expect(
      split({ tabIds: [1, 2], layout: "grid", columns: [0.5, 0.5], rows: [0.5, 0.5] }),
    ).toEqual({ tabIds: [1, 2], layout: "columns", columns: [0.5, 0.5], rows: [1] });
    expect(split({ tabIds: [1, 2], layout: "rows", columns: [1], rows: [0.25, 0.75] })).toEqual({
      tabIds: [1, 2],
      layout: "rows",
      columns: [1],
      rows: [0.25, 0.75],
    });
  });

  it("reads version 2 data, which has no today tabs or views", () => {
    const state = createBrowserSession({
      saved: {
        version: 2,
        activeSpaceId: 1,
        spaces: [{ id: 1, name: "Personal", color: "blue", profile: "browsing" }],
        tabs: [
          { spaceId: 1, zone: "pinned", homeUrl: "https://p.test/", title: "P" },
          { spaceId: 1, zone: "today", url: "https://t.test/" },
        ],
      },
    }).getState();
    expect(state.tabs.map((tab) => [tab.zone, tab.url])).toEqual([
      ["pinned", "https://p.test/"],
      ["today", "https://t.test/"],
    ]);
    expect(state.activeId).toBe(0);
  });
});

describe("reopen closed tabs (D3)", () => {
  it("reports the archive entry of a closed tab and restores the tab with it", () => {
    const session = setup(["a", "b"]);
    session.dispatch({ type: "update-tab", id: 2, patch: { title: "Page B" } });
    const closed = session.dispatch({ type: "close-tab", id: 2 });
    const entry = closed.state.archive[0];
    expect(closed.effects).toContainEqual({ type: "archive", id: 2, archiveId: entry.id });

    const restored = session.dispatch({ type: "restore-archived", id: entry.id });
    expect(restored.state.activeId).toBe(3);
    // A restored history may not report its title again, so the tab starts with the saved one.
    expect(restored.state.tabs.find((tab) => tab.id === 3)?.title).toBe("Page B");
    expect(restored.effects).toContainEqual({
      type: "restore",
      id: 3,
      url: "https://b.test/",
      archiveId: entry.id,
    });
    expect(restored.effects.some((effect) => effect.type === "load")).toBe(false);
  });

  it("reopens a closed tab in the space it came from", () => {
    const session = setup(["a"]);
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "navigate", id: 2, url: "https://w.test/" });
    session.dispatch({ type: "new-tab", url: "https://w2.test/" });
    session.dispatch({ type: "close-tab", id: 3 });
    session.dispatch({ type: "switch-space", id: 1 });
    const entry = session.getState().archive[0];
    const state = session.dispatch({ type: "restore-archived", id: entry.id }).state;
    expect(state.activeSpaceId).toBe(2);
    expect(state.tabs.find((tab) => tab.id === state.activeId)).toMatchObject({
      spaceId: 2,
      url: "https://w2.test/",
    });
  });
});
