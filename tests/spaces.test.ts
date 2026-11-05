import { describe, expect, it } from "vite-plus/test";
import { createBrowserSession } from "../electron/browser-session.cjs";

let profiles = 0;
const newProfile = () => `space-${String(++profiles).padStart(16, "0")}`;

function setup(names = ["a", "b"]) {
  const session = createBrowserSession({ now: () => 1_000, newProfile });
  for (const name of names) session.dispatch({ type: "new-tab", url: `https://${name}.test/` });
  return session;
}
const ids = (session: ReturnType<typeof createBrowserSession>) =>
  session.getState().tabSlots.flat();

describe("spaces (B1)", () => {
  it("starts with one space that uses the original browsing profile", () => {
    const state = setup().getState();
    expect(state.spaces).toEqual([{ id: 1, name: "Personal", color: "blue", profile: "browsing" }]);
    expect(state.activeSpaceId).toBe(1);
    expect(state.tabs.every((tab) => tab.spaceId === 1)).toBe(true);
  });

  it("creates a space with its own tabs and remembers the active tab of each space", () => {
    const session = setup();
    session.dispatch({ type: "select-tab", id: 1 });
    const created = session.dispatch({ type: "create-space" });
    const state = created.state;
    expect(state.spaces[1]).toMatchObject({ id: 2, name: "Space 2", color: "purple" });
    expect(state.spaces[1].profile).toMatch(/^space-[0-9a-f]{16}$/);
    expect(state.activeSpaceId).toBe(2);
    // A new space opens on a blank tab, and its name is ready to edit.
    expect(ids(session)).toEqual([3]);
    expect(state.activeId).toBe(3);
    expect(created.effects).toContainEqual({ type: "edit", kind: "space", id: 2 });

    session.dispatch({ type: "navigate", id: 3, url: "https://work.test/" });
    session.dispatch({ type: "new-tab", url: "https://mail.test/" });
    expect(ids(session)).toEqual([3, 4]);
    session.dispatch({ type: "switch-space", id: 1 });
    expect(session.getState()).toMatchObject({ activeSpaceId: 1, activeId: 1 });
    expect(ids(session)).toEqual([1, 2]);
    session.dispatch({ type: "switch-space", id: 2 });
    expect(session.getState().activeId).toBe(4);
  });

  it("keeps folders, shortcuts, and tab cycling inside the active space", () => {
    const session = setup(["a", "b", "c"]);
    session.dispatch({ type: "create-folder", name: "Docs", tabId: 1 });
    session.dispatch({ type: "create-space" });
    expect(session.getState().folders).toEqual([]);
    session.dispatch({ type: "create-folder", name: "Work" });
    session.dispatch({ type: "new-tab", url: "https://w.test/" });
    expect(session.getState().folders.map((folder) => folder.name)).toEqual(["Work"]);
    session.dispatch({ type: "cycle-tab", direction: 1 });
    session.dispatch({ type: "cycle-tab", direction: 1 });
    expect(session.getState().activeId).toBe(5);
    session.dispatch({ type: "select-position", position: 9 });
    expect(session.getState().activeId).toBe(5);
    session.dispatch({ type: "switch-space", id: 1 });
    expect(session.getState().folders.map((folder) => folder.name)).toEqual(["Docs"]);
    expect(session.getState().sections.folders).toEqual([{ id: 1, slots: [[1]] }]);
  });

  it("switches spaces in order and wraps around", () => {
    const session = setup();
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "cycle-space", direction: 1 });
    expect(session.getState().activeSpaceId).toBe(1);
    session.dispatch({ type: "cycle-space", direction: -1 });
    expect(session.getState().activeSpaceId).toBe(3);
  });

  it("switches to the tab's space when a tab from another space is selected", () => {
    const session = setup();
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "select-tab", id: 2 });
    expect(session.getState()).toMatchObject({ activeSpaceId: 1, activeId: 2 });
  });

  it("restores the split of a space after a switch, and does not split across spaces", () => {
    const session = setup();
    session.dispatch({ type: "toggle-split" });
    expect(session.getState().split?.tabIds).toEqual([2, 1]);
    session.dispatch({ type: "create-space" });
    expect(session.getState().split).toBeNull();
    session.dispatch({ type: "toggle-split" });
    expect(session.getState().split?.tabIds).toEqual([3, 4]);
    expect(() => session.dispatch({ type: "set-split-tab", side: 0, id: 1 })).toThrow();
    session.dispatch({ type: "switch-space", id: 1 });
    expect(session.getState().split?.tabIds).toEqual([2, 1]);
    // Closing every tab of a space opens a blank tab in that space, never in another one.
    session.dispatch({ type: "switch-space", id: 2 });
    session.dispatch({ type: "close-tab", id: 3 });
    session.dispatch({ type: "close-tab", id: 4 });
    expect(session.getState()).toMatchObject({ activeSpaceId: 2, activeId: 5 });
    expect(ids(session)).toEqual([5]);
  });

  it("renames, recolors, and deletes spaces", () => {
    const session = setup();
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "rename-space", id: 2, name: "  Work  " });
    session.dispatch({ type: "set-space-color", id: 2, color: "green" });
    expect(session.getState().spaces[1]).toMatchObject({ name: "Work", color: "green" });
    expect(() => session.dispatch({ type: "set-space-color", id: 2, color: "#fff" })).toThrow();
    session.dispatch({ type: "rename-space", id: 2, name: "" });
    expect(session.getState().spaces[1].name).toBe("Work");

    session.dispatch({ type: "navigate", id: 3, url: "https://work.test/" });
    session.dispatch({ type: "add-route", host: "work.test", spaceId: 2 });
    const profile = session.getState().spaces[1].profile;
    const deleted = session.dispatch({ type: "delete-space", id: 2 });
    expect(deleted.effects).toContainEqual({ type: "clear-profile", profile });
    expect(deleted.state).toMatchObject({ activeSpaceId: 1, activeId: 2, routes: [] });
    expect(deleted.state.tabs.map((tab) => tab.id)).toEqual([1, 2]);
    expect(deleted.state.archive[0]).toMatchObject({ url: "https://work.test/" });
    expect(() => session.dispatch({ type: "delete-space", id: 1 })).toThrow(
      "Keep at least one space.",
    );
  });

  it("moves a tab to another space and keeps the current space usable", () => {
    const session = setup(["a", "b", "c"]);
    session.dispatch({ type: "create-folder", name: "Docs", tabId: 3 });
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "switch-space", id: 1 });
    session.dispatch({ type: "select-tab", id: 3 });
    session.dispatch({ type: "move-tab-to-space", id: 3, spaceId: 2 });
    const state = session.getState();
    expect(state.tabs.find((tab) => tab.id === 3)).toMatchObject({
      spaceId: 2,
      zone: "pinned",
      folderId: null,
    });
    expect(state).toMatchObject({ activeSpaceId: 1, activeId: 1 });
    session.dispatch({ type: "switch-space", id: 2 });
    expect(ids(session)).toEqual([3, 4]);
  });
});

describe("link routing (B4)", () => {
  it("opens new tabs for a routed site in its space", () => {
    const session = setup();
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "switch-space", id: 1 });
    session.dispatch({ type: "add-route", host: "https://www.GitHub.com/narze", spaceId: 2 });
    expect(session.getState().routes).toEqual([{ id: 1, host: "github.com", spaceId: 2 }]);
    const opened = session.dispatch({ type: "new-tab", url: "https://gist.github.com/x" });
    expect(opened.state).toMatchObject({ activeSpaceId: 2, activeId: 4 });
    expect(opened.state.tabs.find((tab) => tab.id === 4)?.spaceId).toBe(2);
    expect(opened.effects).toContainEqual({
      type: "load",
      id: 4,
      url: "https://gist.github.com/x",
    });

    // Other sites, and look-alike domains, stay in the current space.
    session.dispatch({ type: "switch-space", id: 1 });
    session.dispatch({ type: "new-tab", url: "https://notgithub.com/" });
    expect(session.getState()).toMatchObject({ activeSpaceId: 1, activeId: 5 });
  });

  it("uses the most specific rule and replaces a rule for the same site", () => {
    const session = setup();
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "add-route", host: "example.com", spaceId: 2 });
    session.dispatch({ type: "add-route", host: "docs.example.com", spaceId: 3 });
    session.dispatch({ type: "switch-space", id: 1 });
    session.dispatch({ type: "new-tab", url: "https://a.docs.example.com/" });
    expect(session.getState().activeSpaceId).toBe(3);
    session.dispatch({ type: "add-route", host: "example.com", spaceId: 1 });
    expect(session.getState().routes.map((route) => [route.host, route.spaceId])).toEqual([
      ["docs.example.com", 3],
      ["example.com", 1],
    ]);
    session.dispatch({ type: "remove-route", id: 2 });
    expect(session.getState().routes.map((route) => route.host)).toEqual(["example.com"]);
  });

  it("rejects routes that are not a site or point to a missing space", () => {
    const session = setup();
    for (const host of ["", "not a host", "file:///etc", "localhost:abc"])
      expect(() => session.dispatch({ type: "add-route", host, spaceId: 1 })).toThrow(
        "Enter a site, for example github.com.",
      );
    expect(() => session.dispatch({ type: "add-route", host: "a.test", spaceId: 9 })).toThrow(
      "That space no longer exists.",
    );
    session.dispatch({ type: "add-route", host: "localhost:5173", spaceId: 1 });
    expect(session.getState().routes[0].host).toBe("localhost");
  });
});

describe("saved spaces (B1, B3, B4)", () => {
  it("saves spaces, their tabs and folders, profiles, and routes", () => {
    const session = setup();
    session.dispatch({ type: "move-tab", id: 1, zone: "pinned", folderId: null, index: 0 });
    session.dispatch({ type: "create-space" });
    session.dispatch({ type: "rename-space", id: 2, name: "Work" });
    session.dispatch({ type: "navigate", id: 3, url: "https://w.test/" });
    session.dispatch({ type: "create-folder", name: "Team", tabId: 3 });
    session.dispatch({ type: "add-route", host: "w.test", spaceId: 2 });
    const saved = JSON.parse(JSON.stringify(session.exportOrganization()));
    expect(saved.version).toBe(2);
    const restored = createBrowserSession({ now: () => 5, saved, newProfile });
    const state = restored.getState();
    expect(state.spaces.map(({ id, name, profile }) => [id, name, profile])).toEqual([
      [1, "Personal", "browsing"],
      [2, "Work", session.getState().spaces[1].profile],
    ]);
    expect(state.activeSpaceId).toBe(2);
    expect(state.tabs.map((tab) => [tab.spaceId, tab.url])).toEqual([
      [1, "https://a.test/"],
      [2, "https://w.test/"],
    ]);
    expect(state.folders).toEqual([{ id: 1, name: "Team", collapsed: false, spaceId: 2 }]);
    expect(state.routes).toEqual([{ id: 1, host: "w.test", spaceId: 2 }]);
  });

  it("moves version 1 data into one Personal space and drops damaged spaces", () => {
    const v1 = createBrowserSession({
      saved: {
        version: 1,
        folders: [{ id: 4, name: "Old" }],
        tabs: [{ zone: "pinned", folderId: 4, homeUrl: "https://old.test/" }],
      },
    }).getState();
    expect(v1.spaces).toEqual([{ id: 1, name: "Personal", color: "blue", profile: "browsing" }]);
    expect(v1.tabs[0]).toMatchObject({ spaceId: 1, folderId: 1 });

    const damaged = createBrowserSession({
      saved: {
        version: 2,
        activeSpaceId: 99,
        spaces: [
          { id: 7, name: "Ok", color: "red", profile: "space-00000000000000aa" },
          { id: 8, name: "Bad profile", color: "red", profile: "../../etc" },
          { id: 9, name: "", color: "red", profile: "space-00000000000000bb" },
        ],
        tabs: [{ zone: "pinned", spaceId: 8, homeUrl: "https://x.test/" }],
        routes: [
          { host: "x.test", spaceId: 7 },
          { host: "y.test", spaceId: 8 },
          { host: "bad host", spaceId: 7 },
        ],
      },
    }).getState();
    expect(damaged.spaces).toEqual([
      { id: 1, name: "Ok", color: "red", profile: "space-00000000000000aa" },
    ]);
    expect(damaged.activeSpaceId).toBe(1);
    expect(damaged.tabs[0].spaceId).toBe(1);
    expect(damaged.routes).toEqual([{ id: 1, host: "x.test", spaceId: 1 }]);
  });
});
