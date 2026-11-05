import { describe, expect, it } from "vite-plus/test";
import { createBrowserSession } from "../electron/browser-session.cjs";

type Session = ReturnType<typeof createBrowserSession>;

function setup(names = ["a", "b", "c", "d"]) {
  const session = createBrowserSession({
    now: () => 1000,
    newProfile: () => "space-0000000000000001",
  });
  for (const name of names) session.dispatch({ type: "new-tab", url: `https://${name}.test/` });
  return session;
}
const folders = (session: Session) =>
  session.getState().folders.map(({ id, parentId }) => [id, parentId]);
const tab = (session: Session, id: number) =>
  session.getState().tabs.find((entry) => entry.id === id)!;

/** Archives > (Nreal, ZMK), then Read at the top level. */
function tree() {
  const session = setup();
  session.dispatch({ type: "create-folder", name: "Archives" });
  session.dispatch({ type: "create-folder", name: "Nreal", parentId: 1 });
  session.dispatch({ type: "create-folder", name: "ZMK", parentId: 1 });
  session.dispatch({ type: "create-folder", name: "Read" });
  return session;
}

describe("nested folders", () => {
  it("creates a folder inside a folder and opens the parent", () => {
    const session = setup();
    session.dispatch({ type: "create-folder", name: "Archives" });
    session.dispatch({ type: "toggle-folder", id: 1 });
    const created = session.dispatch({ type: "create-folder", name: "Nreal", parentId: 1 });
    expect(created.effects).toContainEqual({ type: "edit", kind: "folder", id: 2 });
    expect(session.getState().folders).toEqual([
      { id: 1, name: "Archives", collapsed: false, spaceId: 1, parentId: null },
      { id: 2, name: "Nreal", collapsed: false, spaceId: 1, parentId: 1 },
    ]);
    session.dispatch({ type: "create-folder", name: "Deep", parentId: 2, tabId: 3 });
    expect(tab(session, 3)).toMatchObject({ zone: "pinned", folderId: 3 });
    expect(() => session.dispatch({ type: "create-folder", parentId: 99 })).toThrow(
      "That folder no longer exists.",
    );
  });

  it("orders folders depth first, each folder's subfolders before its tabs", () => {
    const session = tree();
    session.dispatch({ type: "move-tab", id: 1, zone: "pinned", folderId: 1, index: 0 });
    session.dispatch({ type: "move-tab", id: 2, zone: "pinned", folderId: 2, index: 0 });
    session.dispatch({ type: "move-tab", id: 3, zone: "pinned", folderId: 4, index: 0 });
    session.dispatch({ type: "move-tab", id: 4, zone: "pinned", folderId: null, index: 0 });
    session.dispatch({ type: "create-folder", name: "Late child", parentId: 1 });
    const state = session.getState();
    expect(state.folders.map((folder) => folder.name)).toEqual([
      "Archives",
      "Nreal",
      "ZMK",
      "Late child",
      "Read",
    ]);
    expect(state.sections.folders).toEqual([
      { id: 1, slots: [[1]] },
      { id: 2, slots: [[2]] },
      { id: 3, slots: [] },
      { id: 5, slots: [] },
      { id: 4, slots: [[3]] },
    ]);
    // Shortcuts follow what the sidebar shows: Nreal's tab comes before its parent's tab.
    expect(state.tabSlots.flat()).toEqual([2, 1, 3, 4]);
  });

  it("moves folders into, out of, and between folders, and reorders them", () => {
    const session = tree();
    // Into: Read becomes the second child of Archives.
    session.dispatch({ type: "move-folder", id: 4, parentId: 1, index: 1 });
    expect(folders(session)).toEqual([
      [1, null],
      [2, 1],
      [4, 1],
      [3, 1],
    ]);
    // Between: ZMK moves into Nreal.
    session.dispatch({ type: "move-folder", id: 3, parentId: 2, index: 0 });
    expect(folders(session)).toEqual([
      [1, null],
      [2, 1],
      [3, 2],
      [4, 1],
    ]);
    // Out: ZMK goes back to the top level, before Archives.
    session.dispatch({ type: "move-folder", id: 3, parentId: null, index: 0 });
    expect(folders(session)).toEqual([
      [3, null],
      [1, null],
      [2, 1],
      [4, 1],
    ]);
    // No parent given: reorder among the current siblings.
    session.dispatch({ type: "move-folder", id: 2, index: 99 });
    expect(folders(session)).toEqual([
      [3, null],
      [1, null],
      [4, 1],
      [2, 1],
    ]);
  });

  it("prevents cycles", () => {
    const session = tree();
    session.dispatch({ type: "create-folder", name: "Deep", parentId: 2 });
    for (const parentId of [1, 2, 5])
      expect(() => session.dispatch({ type: "move-folder", id: 1, parentId, index: 0 })).toThrow(
        "A folder cannot move into itself.",
      );
    expect(() => session.dispatch({ type: "move-folder", id: 1, parentId: 99, index: 0 })).toThrow(
      "That folder no longer exists.",
    );
    expect(folders(session)).toEqual([
      [1, null],
      [2, 1],
      [5, 2],
      [3, 1],
      [4, null],
    ]);
  });

  it("keeps a folder and its children in one space", () => {
    const session = tree();
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "create-folder", name: "Other" });
    expect(() => session.dispatch({ type: "move-folder", id: 5, parentId: 1, index: 0 })).toThrow(
      "That folder no longer exists.",
    );
    expect(() => session.dispatch({ type: "create-folder", parentId: 1 })).toThrow(
      "That folder no longer exists.",
    );
  });

  it("deletes a folder and moves its subfolders and tabs up one level", () => {
    const session = tree();
    session.dispatch({ type: "create-folder", name: "Deep", parentId: 2 });
    session.dispatch({ type: "move-tab", id: 1, zone: "pinned", folderId: 2, index: 0 });
    session.dispatch({ type: "move-tab", id: 2, zone: "pinned", folderId: 5, index: 0 });
    session.dispatch({ type: "delete-folder", id: 2 });
    expect(folders(session)).toEqual([
      [1, null],
      [5, 1],
      [3, 1],
      [4, null],
    ]);
    expect(tab(session, 1)).toMatchObject({ zone: "pinned", folderId: 1 });
    expect(tab(session, 2)).toMatchObject({ zone: "pinned", folderId: 5 });
    // A top-level folder's children become top-level.
    session.dispatch({ type: "delete-folder", id: 1 });
    expect(folders(session)).toEqual([
      [5, null],
      [3, null],
      [4, null],
    ]);
    expect(tab(session, 1)).toMatchObject({ zone: "pinned", folderId: null });
    expect(session.getState().tabs).toHaveLength(4);
  });

  it("moves a folder to another space with its whole subtree", () => {
    const session = tree();
    session.dispatch({ type: "move-tab", id: 1, zone: "pinned", folderId: 2, index: 0 });
    session.dispatch({ type: "move-tab", id: 2, zone: "pinned", folderId: 1, index: 0 });
    session.dispatch({ type: "move-tab", id: 3, zone: "pinned", folderId: 4, index: 0 });
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "switch-space", id: 1 });
    session.dispatch({ type: "toggle-split" });
    session.dispatch({ type: "set-split-tab", side: 1, id: 1 });
    session.dispatch({ type: "select-tab", id: 1 });
    expect(session.getState().split?.tabIds).toEqual([4, 1]);
    session.dispatch({ type: "move-folder-to-space", id: 1, spaceId: 2 });
    let state = session.getState();
    expect(state).toMatchObject({ activeSpaceId: 1, activeId: 4, split: null });
    expect(state.folders.map((folder) => folder.name)).toEqual(["Read"]);
    expect(state.tabs.filter((entry) => entry.spaceId === 2).map((entry) => entry.id)).toEqual([
      1, 2, 5,
    ]);
    session.dispatch({ type: "switch-space", id: 2 });
    state = session.getState();
    expect(state.folders).toEqual([
      { id: 1, name: "Archives", collapsed: false, spaceId: 2, parentId: null },
      { id: 2, name: "Nreal", collapsed: false, spaceId: 2, parentId: 1 },
      { id: 3, name: "ZMK", collapsed: false, spaceId: 2, parentId: 1 },
    ]);
    expect(state.sections.folders).toEqual([
      { id: 1, slots: [[2]] },
      { id: 2, slots: [[1]] },
      { id: 3, slots: [] },
    ]);
    // A subfolder leaves its parent when it moves to another space.
    session.dispatch({ type: "move-folder-to-space", id: 2, spaceId: 1 });
    session.dispatch({ type: "switch-space", id: 1 });
    expect(folders(session)).toEqual([
      [4, null],
      [2, null],
    ]);
    expect(tab(session, 1)).toMatchObject({ spaceId: 1, folderId: 2 });
  });
});

describe("saved nested folders", () => {
  it("saves the parent folder and restores the tree", () => {
    const session = tree();
    session.dispatch({ type: "move-tab", id: 1, zone: "pinned", folderId: 2, index: 0 });
    session.dispatch({ type: "toggle-folder", id: 1 });
    const saved = JSON.parse(JSON.stringify(session.exportOrganization()));
    expect(saved.version).toBe(4);
    expect(saved.folders.map((folder: { parentId: number | null }) => folder.parentId)).toEqual([
      null,
      1,
      1,
      null,
    ]);
    const state = createBrowserSession({ saved }).getState();
    expect(state.folders).toEqual(session.getState().folders);
    // Restored tabs get new ids, so find the moved tab by its page.
    const moved = state.tabs.find((entry) => entry.url === "https://a.test/")!;
    expect(state.sections.folders[1]).toEqual({ id: 2, slots: [[moved.id]] });
  });

  it("loads version 2 folders at the top level", () => {
    const state = createBrowserSession({
      saved: {
        version: 2,
        activeSpaceId: 1,
        spaces: [{ id: 1, name: "Personal", color: "blue", profile: "browsing" }],
        folders: [
          { id: 7, name: "Work", collapsed: true, spaceId: 1 },
          { id: 9, name: "Read", collapsed: false, spaceId: 1 },
        ],
        tabs: [{ spaceId: 1, zone: "pinned", folderId: 9, homeUrl: "https://r.test/" }],
      },
    }).getState();
    expect(state.folders).toEqual([
      { id: 1, name: "Work", collapsed: true, spaceId: 1, parentId: null },
      { id: 2, name: "Read", collapsed: false, spaceId: 1, parentId: null },
    ]);
    expect(state.tabs[0]).toMatchObject({ folderId: 2 });
  });

  it("puts folders with a missing, cyclic, or other-space parent at the top level", () => {
    const state = createBrowserSession({
      saved: {
        version: 3,
        spaces: [
          { id: 1, name: "Personal", color: "blue", profile: "browsing" },
          { id: 2, name: "Work", color: "green", profile: "space-00000000000000aa" },
        ],
        folders: [
          { id: 1, name: "Loop A", spaceId: 1, parentId: 2 },
          { id: 2, name: "Loop B", spaceId: 1, parentId: 1 },
          { id: 3, name: "Orphan", spaceId: 1, parentId: 42 },
          { id: 4, name: "Self", spaceId: 1, parentId: 4 },
          { id: 5, name: "Elsewhere", spaceId: 2, parentId: 3 },
          { id: 6, name: "Child", spaceId: 1, parentId: 3 },
          { id: 7, name: "Bad", spaceId: 1, parentId: "3" },
        ],
      },
    }).getState();
    expect(folders({ getState: () => state } as Session)).toEqual([
      [1, null],
      [2, 1],
      [3, null],
      [6, 3],
      [4, null],
      [7, null],
    ]);
  });
});
