import { describe, expect, it } from "vite-plus/test";
import { childFolders, isInside, nudgeFolder, nudgeTab } from "../src/folder-tree";
import type { BrowserTab, TabFolder } from "../shared/browser";

const folder = (id: number, parentId: number | null, collapsed = false): TabFolder => ({
  id,
  name: `F${id}`,
  collapsed,
  spaceId: 1,
  parentId,
});
// 1 Archives > (2 Nreal, 3 ZMK), 4 Read
const folders = [folder(1, null), folder(2, 1), folder(3, 1), folder(4, null)];
const tab = (id: number, folderId: number | null, zone: BrowserTab["zone"] = "pinned") =>
  ({ id, spaceId: 1, zone, folderId }) as BrowserTab;
// Nreal: 10, 11. Archives: 12. Loose pinned: 13.
const tabs = [tab(10, 2), tab(11, 2), tab(12, 1), tab(13, null), tab(14, null, "today")];
const state = { folders, tabs, activeSpaceId: 1 };

describe("folder tree", () => {
  it("finds child folders and descendants", () => {
    expect(childFolders(folders, 1).map((entry) => entry.id)).toEqual([2, 3]);
    expect(childFolders(folders, null).map((entry) => entry.id)).toEqual([1, 4]);
    expect(isInside(folders, 2, 1)).toBe(true);
    expect(isInside(folders, 1, 1)).toBe(true);
    expect(isInside(folders, 4, 1)).toBe(false);
    expect(isInside(folders, null, 1)).toBe(false);
  });

  it("moves a tab one place, and across folder edges in sidebar order", () => {
    expect(nudgeTab(state, 10, 1)).toEqual({ folderId: 2, index: 1 });
    expect(nudgeTab(state, 10, -1)).toBeNull();
    // Out of Nreal into the empty ZMK, then into Archives' own tabs, then Read.
    expect(nudgeTab(state, 11, 1)).toEqual({ folderId: 3, index: 0 });
    expect(nudgeTab(state, 12, -1)).toEqual({ folderId: 3, index: 0 });
    expect(nudgeTab(state, 12, 1)).toEqual({ folderId: 4, index: 0 });
    expect(nudgeTab(state, 13, -1)).toEqual({ folderId: 4, index: 0 });
    expect(nudgeTab(state, 13, 1)).toBeNull();
    // Other zones keep moving inside their zone only.
    expect(nudgeTab(state, 14, 1)).toBeNull();
  });

  it("skips the inside of collapsed folders", () => {
    const closed = {
      ...state,
      folders: [folder(1, null, true), folder(2, 1), folder(3, 1), folder(4, null)],
    };
    expect(nudgeTab(closed, 13, -1)).toEqual({ folderId: 4, index: 0 });
    const readClosed = { ...state, folders: [...folders.slice(0, 3), folder(4, null, true)] };
    expect(nudgeTab(readClosed, 13, -1)).toEqual({ folderId: 1, index: 1 });
    // A tab in a collapsed folder (shown because it is active) can still move out.
    expect(nudgeTab(closed, 12, 1)).toEqual({ folderId: 4, index: 0 });
  });

  it("moves a folder among its siblings, then out of its parent", () => {
    expect(nudgeFolder(folders, 2, 1)).toEqual({ parentId: 1, index: 1 });
    expect(nudgeFolder(folders, 2, -1)).toEqual({ parentId: null, index: 0 });
    expect(nudgeFolder(folders, 3, 1)).toEqual({ parentId: null, index: 1 });
    expect(nudgeFolder(folders, 4, -1)).toEqual({ parentId: null, index: 0 });
    expect(nudgeFolder(folders, 4, 1)).toBeNull();
    expect(nudgeFolder(folders, 1, -1)).toBeNull();
  });
});
