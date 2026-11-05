import { describe, expect, it } from "vite-plus/test";
import {
  shortcutActions,
  acceleratorFromKey,
  normalizeAccelerator,
  formatAccelerator,
  resolveShortcuts,
  shortcutLookup,
  shortcutConflict,
  isShortcutOverrides,
  sanitizeShortcutOverrides,
} from "../shared/shortcuts.js";

const key = (
  key: string,
  code: string,
  modifiers: Partial<Record<"ctrl" | "meta" | "alt" | "shift", boolean>> = {},
) => ({ key, code, ctrl: false, meta: false, alt: false, shift: false, ...modifiers });

describe("keyboard shortcuts", () => {
  it("defines unique ids and conflict-free, valid defaults on every platform", () => {
    const ids = shortcutActions.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const platform of ["darwin", "linux", "win32"]) {
      const seen = new Map<string, string>();
      for (const action of shortcutActions) {
        if (!action.default) continue;
        const accelerator = normalizeAccelerator(action.default, platform);
        expect(accelerator, action.id).not.toBeNull();
        expect(seen.get(accelerator!), `${action.id} on ${platform}`).toBeUndefined();
        seen.set(accelerator!, action.id);
      }
    }
  });

  it("provides sensible defaults for common browser actions", () => {
    const defaults = Object.fromEntries(
      shortcutActions.map((action) => [action.id, action.default]),
    );
    expect(defaults).toMatchObject({
      newTab: "CmdOrCtrl+T",
      closeTab: "CmdOrCtrl+W",
      reopenClosedTab: "CmdOrCtrl+Shift+T",
      openAddress: "CmdOrCtrl+L",
      commandPalette: "CmdOrCtrl+K",
      reload: "CmdOrCtrl+R",
      settings: "CmdOrCtrl+,",
      archive: "CmdOrCtrl+Shift+A",
      nextTab: "Ctrl+Tab",
      previousTab: "Ctrl+Shift+Tab",
      selectTab1: "CmdOrCtrl+1",
      selectLastTab: "CmdOrCtrl+9",
      togglePin: "CmdOrCtrl+D",
      copyUrl: "CmdOrCtrl+Shift+C",
      toggleSplit: "Ctrl+Shift+=",
      toggleSidebar: "CmdOrCtrl+S",
      nextSpace: "CmdOrCtrl+Alt+Right",
      previousSpace: "CmdOrCtrl+Alt+Left",
      newSpace: "",
      toggleCompactMode: "CmdOrCtrl+Shift+S",
    });
  });

  it("normalizes modifier names and order per platform", () => {
    expect(normalizeAccelerator("Shift+CmdOrCtrl+t", "darwin")).toBe("Shift+Cmd+T");
    expect(normalizeAccelerator("CommandOrControl+Shift+T", "linux")).toBe("Ctrl+Shift+T");
    expect(normalizeAccelerator("Control+Option+Left", "darwin")).toBe("Ctrl+Alt+Left");
    expect(normalizeAccelerator("Command+]", "linux")).toBe("Super+]");
    expect(normalizeAccelerator("F2", "linux")).toBe("F2");
    for (const invalid of [
      "",
      "Ctrl+",
      "Ctrl+Ctrl+T",
      "Hyper+T",
      "Ctrl+Shift",
      "Ctrl+T+K",
      "Ctrl+ä",
    ])
      expect(normalizeAccelerator(invalid, "darwin"), invalid).toBeNull();
  });

  it("reads layout-aware letters and physical punctuation from key events", () => {
    expect(acceleratorFromKey(key("t", "KeyG", { meta: true }), "darwin")).toBe("Cmd+T");
    expect(acceleratorFromKey(key("t", "KeyT", { ctrl: true }), "linux")).toBe("Ctrl+T");
    expect(
      acceleratorFromKey(key("}", "BracketRight", { meta: true, shift: true }), "darwin"),
    ).toBe("Shift+Cmd+]");
    expect(acceleratorFromKey(key("!", "Digit1", { ctrl: true, shift: true }), "linux")).toBe(
      "Ctrl+Shift+1",
    );
    // Option changes the character on macOS, so the physical key is used.
    expect(acceleratorFromKey(key("¬", "KeyL", { meta: true, alt: true }), "darwin")).toBe(
      "Alt+Cmd+L",
    );
    expect(acceleratorFromKey(key("ฟ", "KeyA", { ctrl: true }), "linux")).toBe("Ctrl+A");
    expect(acceleratorFromKey(key("ArrowLeft", "ArrowLeft", { alt: true }), "darwin")).toBe(
      "Alt+Left",
    );
    expect(acceleratorFromKey(key("Tab", "Tab", { ctrl: true, shift: true }), "darwin")).toBe(
      "Ctrl+Shift+Tab",
    );
    expect(acceleratorFromKey(key("F2", "F2"), "linux")).toBe("F2");
    expect(acceleratorFromKey(key("Meta", "MetaLeft", { meta: true }), "darwin")).toBeNull();
    expect(acceleratorFromKey(key("Shift", "ShiftLeft", { shift: true }), "linux")).toBeNull();
  });

  it("matches recorded keys against defaults on each platform", () => {
    const mac = shortcutLookup({}, "darwin");
    expect(mac.get(acceleratorFromKey(key("t", "KeyT", { meta: true }), "darwin")!)).toBe("newTab");
    expect(mac.get(acceleratorFromKey(key("Tab", "Tab", { ctrl: true }), "darwin")!)).toBe(
      "nextTab",
    );
    expect(
      mac.get(acceleratorFromKey(key("t", "KeyT", { ctrl: true }), "darwin")!),
    ).toBeUndefined();
    const linux = shortcutLookup({}, "linux");
    expect(linux.get(acceleratorFromKey(key("t", "KeyT", { ctrl: true }), "linux")!)).toBe(
      "newTab",
    );
    expect(linux.get(acceleratorFromKey(key("Tab", "Tab", { ctrl: true }), "linux")!)).toBe(
      "nextTab",
    );
  });

  it("applies overrides and disabled shortcuts", () => {
    const overrides = { newTab: "Alt+Cmd+N", closeTab: "" };
    const resolved = resolveShortcuts(overrides);
    expect(resolved.newTab).toBe("Alt+Cmd+N");
    expect(resolved.closeTab).toBe("");
    expect(resolved.reload).toBe("CmdOrCtrl+R");
    const lookup = shortcutLookup(overrides, "darwin");
    expect(lookup.get("Alt+Cmd+N")).toBe("newTab");
    expect(lookup.get("Cmd+T")).toBeUndefined();
    expect(lookup.get("Cmd+W")).toBeUndefined();
  });

  it("reports the action that already uses a shortcut", () => {
    expect(shortcutConflict({}, "darwin")).toBeNull();
    expect(shortcutConflict({ reload: "Cmd+T" }, "darwin")).toEqual({
      accelerator: "Cmd+T",
      ids: ["newTab", "reload"],
    });
    // CmdOrCtrl is Ctrl on Linux, so it clashes with an explicit Ctrl binding.
    expect(shortcutConflict({ reload: "Ctrl+T" }, "linux")?.ids).toEqual(["newTab", "reload"]);
    expect(shortcutConflict({ reload: "Ctrl+T" }, "darwin")).toBeNull();
  });

  it("validates and sanitizes stored overrides", () => {
    expect(isShortcutOverrides({})).toBe(true);
    expect(isShortcutOverrides({ newTab: "Cmd+N", closeTab: "" })).toBe(true);
    for (const invalid of [null, [], "x", { unknown: "Cmd+N" }, { newTab: 1 }, { newTab: "Ctrl+" }])
      expect(isShortcutOverrides(invalid), JSON.stringify(invalid)).toBe(false);
    expect(isShortcutOverrides(JSON.parse('{"__proto__": "Cmd+N"}'))).toBe(false);
    expect(
      sanitizeShortcutOverrides({ newTab: "Cmd+N", removed: "Cmd+J", reload: "bad", closeTab: "" }),
    ).toEqual({ newTab: "Cmd+N", closeTab: "" });
    expect(sanitizeShortcutOverrides("broken")).toEqual({});
  });

  it("formats shortcuts for display", () => {
    expect(formatAccelerator("CmdOrCtrl+Shift+T", "darwin")).toBe("⇧⌘T");
    expect(formatAccelerator("Ctrl+Alt+Shift+Cmd+Left", "darwin")).toBe("⌃⌥⇧⌘←");
    expect(formatAccelerator("Ctrl+Tab", "darwin")).toBe("⌃⇥");
    expect(formatAccelerator("CmdOrCtrl+Shift+T", "linux")).toBe("Ctrl+Shift+T");
    expect(formatAccelerator("Alt+Left", "linux")).toBe("Alt+←");
    expect(formatAccelerator("", "darwin")).toBe("");
  });
});
