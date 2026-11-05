import { describe, expect, it } from "vite-plus/test";
import { createBrowserSession } from "../electron/browser-session.cjs";

const HOUR = 3_600_000;

function setup(names = ["a", "b", "c"]) {
  let time = 1_000_000;
  const clock = {
    advance: (ms: number) => (time += ms),
    now: () => time,
  };
  const session = createBrowserSession({ now: clock.now });
  for (const name of names) session.dispatch({ type: "new-tab", url: `https://${name}.test/` });
  return { session, clock };
}
const tab = (session: ReturnType<typeof createBrowserSession>, id: number) =>
  session.getState().tabs.find((entry) => entry.id === id)!;

describe("tab zones and drag reorder (A6)", () => {
  it("reorders tabs inside a zone and exposes the visual order in sections and slots", () => {
    const { session } = setup();
    expect(session.getState().sections.today).toEqual([[1], [2], [3]]);
    session.dispatch({ type: "move-tab", id: 3, zone: "today", folderId: null, index: 0 });
    expect(session.getState().sections.today).toEqual([[3], [1], [2]]);
    session.dispatch({ type: "move-tab", id: 3, zone: "today", folderId: null, index: 99 });
    expect(session.getState().sections.today).toEqual([[1], [2], [3]]);
    session.dispatch({ type: "move-tab", id: 1, zone: "today", folderId: null, index: 1 });
    expect(session.getState().tabSlots).toEqual([[2], [1], [3]]);
  });

  it("orders favorites, folders, loose pinned tabs, and today tabs for shortcuts", () => {
    const { session } = setup(["a", "b", "c", "d"]);
    session.dispatch({ type: "move-tab", id: 4, zone: "favorites", folderId: null, index: 0 });
    session.dispatch({ type: "move-tab", id: 3, zone: "pinned", folderId: null, index: 0 });
    session.dispatch({ type: "create-folder", name: "Work", tabId: 2 });
    const state = session.getState();
    expect(state.sections).toEqual({
      favorites: [[4]],
      folders: [{ id: 1, slots: [[2]] }],
      pinned: [[3]],
      today: [[1]],
    });
    expect(state.tabSlots).toEqual([[4], [2], [3], [1]]);
    session.dispatch({ type: "select-position", position: 1 });
    expect(session.getState().activeId).toBe(4);
  });

  it("rejects invalid moves and blank pages in pinned zones", () => {
    const { session } = setup();
    session.dispatch({ type: "new-tab" });
    expect(() =>
      session.dispatch({ type: "move-tab", id: 4, zone: "pinned", folderId: null, index: 0 }),
    ).toThrow();
    expect(() =>
      session.dispatch({ type: "move-tab", id: 1, zone: "nowhere" as never, folderId: null, index: 0 }),
    ).toThrow();
    expect(() =>
      session.dispatch({ type: "move-tab", id: 1, zone: "pinned", folderId: 77, index: 0 }),
    ).toThrow();
    expect(() =>
      session.dispatch({ type: "move-tab", id: 1, zone: "today", folderId: null, index: -1 }),
    ).toThrow();
  });

  it("keeps a split pair in one slot where its first tab appears", () => {
    const { session } = setup();
    session.dispatch({ type: "toggle-split" });
    session.dispatch({ type: "move-tab", id: 1, zone: "pinned", folderId: null, index: 0 });
    expect(session.getState().sections).toMatchObject({ pinned: [[3, 1]], today: [[2]] });
  });
});

describe("pinned tabs and favorites (A1, A2)", () => {
  it("records the home URL when pinned and resets to it", () => {
    const { session } = setup();
    session.dispatch({ type: "move-tab", id: 1, zone: "pinned", folderId: null, index: 0 });
    session.dispatch({ type: "update-tab", id: 1, patch: { title: "A home" } });
    expect(tab(session, 1)).toMatchObject({ zone: "pinned", homeUrl: "https://a.test/" });
    session.dispatch({ type: "select-tab", id: 1 });
    session.dispatch({ type: "update-tab", id: 1, patch: { url: "https://a.test/deep", title: "Deep" } });
    const reset = session.dispatch({ type: "reset-tab", id: 1 });
    expect(reset.effects).toContainEqual({ type: "load", id: 1, url: "https://a.test/" });
    expect(tab(session, 1)).toMatchObject({ url: "https://a.test/", title: "A home" });
    // Moving between pinned zones keeps the home; unpinning forgets it.
    session.dispatch({ type: "move-tab", id: 1, zone: "favorites", folderId: null, index: 0 });
    expect(tab(session, 1).homeUrl).toBe("https://a.test/");
    session.dispatch({ type: "move-tab", id: 1, zone: "today", folderId: null, index: 0 });
    expect(tab(session, 1)).toMatchObject({ zone: "today", homeUrl: null });
  });

  it("closing a pinned tab unloads it at its home instead of removing it", () => {
    const { session } = setup();
    session.dispatch({ type: "move-tab", id: 3, zone: "favorites", folderId: null, index: 0 });
    session.dispatch({ type: "update-tab", id: 3, patch: { url: "https://c.test/other" } });
    session.dispatch({ type: "close-tab", id: 3 });
    const state = session.getState();
    expect(state.tabs).toHaveLength(3);
    expect(tab(session, 3)).toMatchObject({ asleep: true, url: "https://c.test/" });
    expect(state.activeId).not.toBe(3);
    expect(state.pages.some((page) => page.id === 3)).toBe(false);
    expect(state.archive).toEqual([]);
  });

  it("opens a new tab when the last open tab is a closed pinned tab", () => {
    const { session } = setup(["a"]);
    session.dispatch({ type: "move-tab", id: 1, zone: "pinned", folderId: null, index: 0 });
    session.dispatch({ type: "close-tab", id: 1 });
    expect(session.getState().tabs.map((entry) => entry.id)).toEqual([1, 2]);
    expect(session.getState().activeId).toBe(2);
  });
});

describe("folders (A3)", () => {
  it("creates, renames, collapses, reorders, and deletes folders", () => {
    const { session } = setup();
    const created = session.dispatch({ type: "create-folder" });
    expect(created.effects).toContainEqual({ type: "edit", kind: "folder", id: 1 });
    expect(session.getState().folders).toEqual([{ id: 1, name: "New folder", collapsed: false }]);
    session.dispatch({ type: "rename-folder", id: 1, name: "  Research  " });
    session.dispatch({ type: "rename-folder", id: 1, name: "   " });
    expect(session.getState().folders[0].name).toBe("Research");
    session.dispatch({ type: "move-tab", id: 2, zone: "pinned", folderId: 1, index: 0 });
    expect(tab(session, 2)).toMatchObject({ zone: "pinned", folderId: 1, homeUrl: "https://b.test/" });
    session.dispatch({ type: "toggle-folder", id: 1 });
    expect(session.getState().folders[0].collapsed).toBe(true);
    session.dispatch({ type: "create-folder", name: "Second" });
    session.dispatch({ type: "move-folder", id: 2, index: 0 });
    expect(session.getState().folders.map((folder) => folder.id)).toEqual([2, 1]);
    session.dispatch({ type: "delete-folder", id: 1 });
    expect(session.getState().folders.map((folder) => folder.id)).toEqual([2]);
    // Deleting a folder keeps its tabs as loose pinned tabs.
    expect(tab(session, 2)).toMatchObject({ zone: "pinned", folderId: null });
    expect(() => session.dispatch({ type: "rename-folder", id: 9, name: "x" })).toThrow();
  });

  it("puts a tab into a new folder in one command", () => {
    const { session } = setup();
    session.dispatch({ type: "create-folder", name: "Read later", tabId: 3 });
    expect(tab(session, 3)).toMatchObject({ zone: "pinned", folderId: 1 });
    expect(session.getState().folders[0].name).toBe("Read later");
  });
});

describe("auto-archive (A4)", () => {
  it("archives closed web tabs, newest first, and restores them", () => {
    const { session, clock } = setup();
    session.dispatch({ type: "close-tab", id: 1 });
    clock.advance(1000);
    session.dispatch({ type: "close-tab", id: 2 });
    session.dispatch({ type: "new-tab" });
    session.dispatch({ type: "close-tab", id: 4 });
    const archive = session.getState().archive;
    expect(archive.map((entry) => entry.url)).toEqual(["https://b.test/", "https://a.test/"]);
    expect(archive[0]).toMatchObject({ reason: "closed", title: "b.test" });
    const restored = session.dispatch({ type: "restore-archived", id: archive[1].id });
    expect(restored.effects).toContainEqual({ type: "load", id: 5, url: "https://a.test/" });
    expect(session.getState()).toMatchObject({ activeId: 5, archiveOpen: false });
    expect(session.getState().archive).toHaveLength(1);
    session.dispatch({ type: "remove-archived", id: archive[0].id });
    expect(session.getState().archive).toEqual([]);
  });

  it("archives idle today tabs but never pinned, visible, or kept-awake tabs", () => {
    const { session, clock } = setup(["a", "b", "c", "d"]);
    session.dispatch({ type: "move-tab", id: 1, zone: "pinned", folderId: null, index: 0 });
    session.dispatch({ type: "new-tab" });
    session.dispatch({ type: "select-tab", id: 4 });
    clock.advance(13 * HOUR);
    session.dispatch({ type: "tick", archiveAfter: 12 * HOUR, sleepAfter: null, keepAwake: [3] });
    const state = session.getState();
    expect(state.tabSlots.flat()).toEqual([1, 3, 4]);
    expect(state.archive.map((entry) => [entry.url, entry.reason])).toEqual([
      ["https://b.test/", "auto"],
    ]);
  });

  it("caps the archive and clears it", () => {
    const { session } = setup([]);
    for (let index = 0; index < 205; index++) {
      session.dispatch({ type: "new-tab", url: `https://site${index}.test/` });
      session.dispatch({ type: "close-tab", id: session.getState().activeId });
    }
    expect(session.getState().archive).toHaveLength(200);
    expect(session.getState().archive[0].url).toBe("https://site204.test/");
    session.dispatch({ type: "clear-archive" });
    expect(session.getState().archive).toEqual([]);
  });

  it("shows the archive as a temporary screen that hides pages", () => {
    const { session } = setup();
    session.dispatch({ type: "show-archive", open: true });
    expect(session.getState()).toMatchObject({ archiveOpen: true, settingsOpen: false });
    expect(session.getState().pages.every((page) => !page.visible)).toBe(true);
    session.dispatch({ type: "show-settings", open: true });
    expect(session.getState()).toMatchObject({ archiveOpen: false, settingsOpen: true });
    session.dispatch({ type: "show-archive", open: true });
    session.dispatch({ type: "select-tab", id: 1 });
    expect(session.getState().archiveOpen).toBe(false);
  });
});

describe("rename tabs (A5)", () => {
  it("keeps a custom title over page titles and clears it with an empty name", () => {
    const { session } = setup();
    session.dispatch({ type: "rename-tab", id: 2, title: "  Docs  " });
    session.dispatch({ type: "update-tab", id: 2, patch: { title: "Page title" } });
    expect(tab(session, 2)).toMatchObject({ customTitle: "Docs", title: "Page title" });
    session.dispatch({ type: "rename-tab", id: 2, title: "" });
    expect(tab(session, 2).customTitle).toBeNull();
    expect(() => session.dispatch({ type: "rename-tab", id: 2, title: 5 as never })).toThrow();
    session.dispatch({ type: "rename-tab", id: 2, title: "x".repeat(500) });
    expect(tab(session, 2).customTitle).toHaveLength(120);
  });
});

describe("tab sleep (A7)", () => {
  it("unloads hidden tabs on request and wakes them when shown", () => {
    const { session } = setup();
    expect(() => session.dispatch({ type: "sleep-tab", id: 3 })).toThrow();
    session.dispatch({ type: "sleep-tab", id: 1 });
    expect(tab(session, 1).asleep).toBe(true);
    expect(session.getState().pages.map((page) => page.id)).toEqual([2, 3]);
    const woke = session.dispatch({ type: "select-tab", id: 1 });
    expect(woke.effects).toContainEqual({ type: "wake", id: 1, url: "https://a.test/" });
    expect(tab(session, 1).asleep).toBe(false);
  });

  it("wakes both pages when a split shows a sleeping tab", () => {
    const { session } = setup();
    session.dispatch({ type: "sleep-tab", id: 1 });
    session.dispatch({ type: "sleep-tab", id: 2 });
    const result = session.dispatch({ type: "toggle-split" });
    expect(result.effects).toContainEqual({ type: "wake", id: 1, url: "https://a.test/" });
    expect(tab(session, 1).asleep).toBe(false);
    expect(tab(session, 2).asleep).toBe(true);
  });

  it("puts idle web tabs to sleep after the configured time", () => {
    const { session, clock } = setup();
    session.dispatch({ type: "new-tab" });
    clock.advance(2 * HOUR);
    session.dispatch({ type: "select-tab", id: 2 });
    session.dispatch({ type: "tick", archiveAfter: null, sleepAfter: HOUR, keepAwake: [] });
    expect(session.getState().tabs.map((entry) => [entry.id, entry.asleep])).toEqual([
      [1, true],
      [2, false],
      [3, true],
      [4, false],
    ]);
    // Recently active tabs stay awake.
    clock.advance(HOUR / 2);
    session.dispatch({ type: "select-tab", id: 1 });
    session.dispatch({ type: "select-tab", id: 2 });
    session.dispatch({ type: "tick", archiveAfter: null, sleepAfter: HOUR, keepAwake: [] });
    expect(tab(session, 1).asleep).toBe(false);
  });
});

describe("saved organization", () => {
  it("restores favorites, pinned tabs, folders, and the archive asleep", () => {
    const { session } = setup(["a", "b", "c", "d"]);
    session.dispatch({ type: "move-tab", id: 1, zone: "favorites", folderId: null, index: 0 });
    session.dispatch({ type: "create-folder", name: "Work", tabId: 2 });
    session.dispatch({ type: "toggle-folder", id: 1 });
    session.dispatch({ type: "move-tab", id: 3, zone: "pinned", folderId: null, index: 0 });
    session.dispatch({ type: "rename-tab", id: 3, title: "Mail" });
    session.dispatch({ type: "update-tab", id: 3, patch: { favicon: "0123456789abcdef0123456789abcdef.png" } });
    session.dispatch({ type: "close-tab", id: 4 });
    const saved = JSON.parse(JSON.stringify(session.exportOrganization()));
    const restored = createBrowserSession({ now: () => 5, saved });
    const state = restored.getState();
    expect(state.tabs.map((entry) => [entry.zone, entry.url, entry.asleep, entry.customTitle])).toEqual([
      ["favorites", "https://a.test/", true, null],
      ["pinned", "https://b.test/", true, null],
      ["pinned", "https://c.test/", true, "Mail"],
    ]);
    expect(state.tabs[2].favicon).toBe("0123456789abcdef0123456789abcdef.png");
    expect(state.folders).toEqual([{ id: 1, name: "Work", collapsed: true }]);
    expect(state.sections.folders).toEqual([{ id: 1, slots: [[2]] }]);
    expect(state.archive.map((entry) => entry.url)).toEqual(["https://d.test/"]);
    expect(state.activeId).toBe(0);
  });

  it("ignores damaged saved data", () => {
    for (const saved of [null, 5, { tabs: "x" }, { tabs: [{ zone: "pinned", homeUrl: "file:///etc" }] }]) {
      const session = createBrowserSession({ saved });
      expect(session.getState().tabs).toEqual([]);
    }
    const partial = createBrowserSession({
      saved: {
        folders: [{ id: 3, name: "Kept" }],
        tabs: [{ zone: "pinned", folderId: 99, homeUrl: "https://ok.test/", title: "OK" }],
        archive: [{ url: "javascript:alert(1)", title: "bad" }],
      },
    });
    expect(partial.getState().tabs).toMatchObject([{ zone: "pinned", folderId: null, title: "OK" }]);
    expect(partial.getState().archive).toEqual([]);
  });
});
