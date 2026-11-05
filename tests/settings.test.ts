import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettingsStore } from "../electron/settings.cjs";
import { resolveAddress } from "../electron/navigation.cjs";
import { defaultSettings, settingsSchema, isSettingValue, durationMs } from "../shared/settings.js";

const directories: string[] = [];
function profile() {
  const directory = mkdtempSync(join(tmpdir(), "browser-settings-"));
  directories.push(directory);
  return join(directory, "settings.json");
}
afterEach(() =>
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })),
);

describe("browser preferences", () => {
  it("maps tab timers to milliseconds, with never as null", () => {
    expect(durationMs("archiveAfter", "12h")).toBe(12 * 3_600_000);
    expect(durationMs("archiveAfter", "7d")).toBe(7 * 86_400_000);
    expect(durationMs("sleepAfter", "15m")).toBe(15 * 60_000);
    expect(durationMs("sleepAfter", "never")).toBeNull();
    expect(defaultSettings).toMatchObject({ archiveAfter: "12h", sleepAfter: "1h" });
  });
  it("uses schema defaults and accepts every declared settings choice", () => {
    expect(createSettingsStore(profile()).get()).toEqual(defaultSettings);
    const store = createSettingsStore(profile());
    for (const [key, setting] of Object.entries(settingsSchema)) {
      const choices =
        key === "shortcuts"
          ? [{ newTab: "Alt+Cmd+N", closeTab: "" }, {}]
          : "options" in setting
            ? setting.options.map((option) => option.value)
            : "min" in setting
              ? [setting.min, setting.default, setting.max]
              : [true, false];
      for (const value of choices) {
        expect(isSettingValue(key, value)).toBe(true);
        store.update({ [key]: value });
        expect(store.get()).toHaveProperty(key, value);
      }
    }
    expect(isSettingValue("__proto__", {})).toBe(false);
    expect(isSettingValue("theme", "sepia")).toBe(false);
    for (const width of [159, 481, 200.5, NaN, "220"])
      expect(isSettingValue("sidebarWidth", width)).toBe(false);
  });
  it("persists changes and merges later changes without losing other preferences", () => {
    const file = profile();
    const store = createSettingsStore(file);
    store.update({ tabLayout: "right", showShortcuts: false });
    store.update({ searchEngine: "google", theme: "dark" });
    expect(createSettingsStore(file).get()).toEqual({
      tabLayout: "right",
      showShortcuts: false,
      searchEngine: "google",
      theme: "dark",
      sidebarWidth: 220,
      archiveAfter: "12h",
      sleepAfter: "1h",
      shortcuts: {},
    });
  });
  it("rejects invalid settings without changing memory or disk", () => {
    const file = profile();
    const store = createSettingsStore(file);
    store.update({ tabLayout: "left" });
    const saved = readFileSync(file, "utf8");
    for (const patch of [
      null,
      [],
      { tabLayout: "bottom" },
      { searchEngine: "evil" },
      { showShortcuts: "yes" },
      { unknown: true },
      { theme: "sepia" },
      { theme: null },
      { sidebarWidth: 1000 },
      { shortcuts: { newTab: "Ctrl+" } },
      { shortcuts: { unknownAction: "Cmd+J" } },
      { shortcuts: [] },
      { shortcuts: { reload: "CmdOrCtrl+T" } },
    ]) {
      expect(() => store.update(patch)).toThrow();
      expect(readFileSync(file, "utf8")).toBe(saved);
      expect(store.get().tabLayout).toBe("left");
    }
  });
  it("recovers defaults from corrupt files and preserves valid fields in older files", () => {
    const file = profile();
    writeFileSync(file, "{broken");
    expect(createSettingsStore(file).get()).toEqual({
      tabLayout: "top",
      searchEngine: "duckduckgo",
      showShortcuts: true,
      theme: "system",
      sidebarWidth: 220,
      archiveAfter: "12h",
      sleepAfter: "1h",
      shortcuts: {},
    });
    writeFileSync(
      file,
      JSON.stringify({ tabLayout: "left", searchEngine: "unknown", theme: "invalid" }),
    );
    expect(createSettingsStore(file).get()).toEqual({
      tabLayout: "left",
      searchEngine: "duckduckgo",
      showShortcuts: true,
      theme: "system",
      sidebarWidth: 220,
      archiveAfter: "12h",
      sleepAfter: "1h",
      shortcuts: {},
    });
  });
  it("keeps valid stored shortcuts and drops unknown or damaged ones", () => {
    const file = profile();
    writeFileSync(
      file,
      JSON.stringify({ shortcuts: { newTab: "Alt+Cmd+N", gone: "Cmd+J", reload: "nope" } }),
    );
    expect(createSettingsStore(file).get().shortcuts).toEqual({ newTab: "Alt+Cmd+N" });
    writeFileSync(file, JSON.stringify({ shortcuts: "broken" }));
    expect(createSettingsStore(file).get().shortcuts).toEqual({});
  });
  it("uses the selected search engine while preserving direct addresses", () => {
    expect(resolveAddress("hello world", "google")).toBe(
      "https://www.google.com/search?q=hello%20world",
    );
    expect(resolveAddress("hello world", "bing")).toBe(
      "https://www.bing.com/search?q=hello%20world",
    );
    expect(resolveAddress("example.com", "google")).toBe("https://example.com/");
  });
});
