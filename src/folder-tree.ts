import type { BrowserTab, TabFolder } from "../shared/browser";

type TreeState = { folders: TabFolder[]; tabs: BrowserTab[]; activeSpaceId: number };

/** The folders directly in `parentId` (null: the top level), in sidebar order. */
export const childFolders = (folders: TabFolder[], parentId: number | null) =>
  folders.filter((folder) => folder.parentId === parentId);

/** True when folder `id` is `ancestorId` or is inside it. */
export function isInside(folders: TabFolder[], id: number | null, ancestorId: number) {
  const seen = new Set<number>();
  while (id !== null && !seen.has(id)) {
    if (id === ancestorId) return true;
    seen.add(id);
    id = folders.find((folder) => folder.id === id)?.parentId ?? null;
  }
  return false;
}

/** The tabs directly in one zone or folder of the active space, in order. */
export const containerIds = (state: TreeState, zone: BrowserTab["zone"], folderId: number | null) =>
  state.tabs
    .filter(
      (tab) =>
        tab.spaceId === state.activeSpaceId &&
        tab.zone === zone &&
        (zone !== "pinned" || tab.folderId === folderId),
    )
    .map((tab) => tab.id);

/**
 * Where Alt+Shift+Up/Down moves a tab: one place in its folder, or at a folder edge
 * into the next folder that shows its tabs, in sidebar order. Null: it cannot move.
 */
export function nudgeTab(state: TreeState, id: number, direction: 1 | -1) {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (!tab) return null;
  const own = containerIds(state, tab.zone, tab.folderId);
  const index = own.indexOf(id) + direction;
  if (index >= 0 && index < own.length) return { folderId: tab.folderId, index };
  if (tab.zone !== "pinned") return null;
  // Pinned tab lists in sidebar order: subfolders first, then the folder's own tabs.
  const open = (folder: TabFolder | undefined): boolean =>
    !folder ||
    (!folder.collapsed && open(state.folders.find((entry) => entry.id === folder.parentId)));
  const order = (parentId: number | null): (number | null)[] =>
    childFolders(state.folders, parentId).flatMap((folder) => [...order(folder.id), folder.id]);
  const lists = [...order(null), null].filter(
    (folderId) =>
      folderId === tab.folderId || open(state.folders.find((entry) => entry.id === folderId)),
  );
  const folderId = lists[lists.indexOf(tab.folderId) + direction];
  if (folderId === undefined) return null;
  return {
    folderId,
    index: direction > 0 ? 0 : containerIds(state, "pinned", folderId).length,
  };
}

/**
 * Where Alt+Shift+Up/Down moves a folder: one place among its siblings, or at the
 * edge, out of its parent to just before or after it. Null: it cannot move.
 */
export function nudgeFolder(folders: TabFolder[], id: number, direction: 1 | -1) {
  const folder = folders.find((entry) => entry.id === id);
  if (!folder) return null;
  const siblings = childFolders(folders, folder.parentId).map((entry) => entry.id);
  const index = siblings.indexOf(id) + direction;
  if (index >= 0 && index < siblings.length) return { parentId: folder.parentId, index };
  const parent = folders.find((entry) => entry.id === folder.parentId);
  if (!parent) return null;
  const place = childFolders(folders, parent.parentId).indexOf(parent);
  return { parentId: parent.parentId, index: place + (direction > 0 ? 1 : 0) };
}
