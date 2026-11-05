// @ts-check
import { isShortcutOverrides, shortcutConflict } from "./shortcuts.js";

export const settingsSchema = /** @type {const} */ ({
  theme: {
    label: "Theme",
    default: "system",
    options: [
      { value: "system", label: "System" },
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ],
  },
  tabLayout: {
    label: "Tab placement",
    default: "top",
    options: [
      { value: "top", label: "Top" },
      { value: "left", label: "Left" },
      { value: "right", label: "Right" },
    ],
  },
  searchEngine: {
    label: "Search engine",
    default: "duckduckgo",
    options: [
      { value: "duckduckgo", label: "DuckDuckGo", searchUrl: "https://duckduckgo.com/?q=" },
      { value: "google", label: "Google", searchUrl: "https://www.google.com/search?q=" },
      { value: "bing", label: "Bing", searchUrl: "https://www.bing.com/search?q=" },
    ],
  },
  sidebarWidth: { label: "Sidebar width", default: 220, min: 160, max: 480 },
  archiveAfter: {
    label: "Archive tabs after",
    default: "12h",
    options: [
      { value: "12h", label: "12 hours", ms: 12 * 3_600_000 },
      { value: "24h", label: "24 hours", ms: 24 * 3_600_000 },
      { value: "7d", label: "7 days", ms: 7 * 86_400_000 },
      { value: "30d", label: "30 days", ms: 30 * 86_400_000 },
      { value: "never", label: "Never", ms: null },
    ],
  },
  sleepAfter: {
    label: "Put tabs to sleep after",
    default: "1h",
    options: [
      { value: "15m", label: "15 minutes", ms: 15 * 60_000 },
      { value: "1h", label: "1 hour", ms: 3_600_000 },
      { value: "6h", label: "6 hours", ms: 6 * 3_600_000 },
      { value: "never", label: "Never", ms: null },
    ],
  },
  showShortcuts: { label: "New-tab shortcuts", default: true },
  /** Changed keyboard shortcuts by action id; see shared/shortcuts.js. */
  shortcuts: { label: "Keyboard shortcuts", default: /** @type {Record<string, string>} */ ({}) },
});

export const defaultSettings = /** @type {import('./browser').BrowserSettings} */ (
  Object.fromEntries(Object.entries(settingsSchema).map(([key, setting]) => [key, setting.default]))
);

/** @param {string} key @param {unknown} value */
export function isSettingValue(key, value) {
  if (!Object.hasOwn(settingsSchema, key)) return false;
  if (key === "shortcuts") return isShortcutOverrides(value);
  const setting = settingsSchema[/** @type {keyof typeof settingsSchema} */ (key)];
  if ("options" in setting) return setting.options.some((option) => option.value === value);
  if ("min" in setting)
    return (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= setting.min &&
      value <= setting.max
    );
  return typeof value === typeof setting.default;
}

/**
 * @param {"archiveAfter" | "sleepAfter"} key
 * @param {string} value
 * @returns {number | null}
 */
export function durationMs(key, value) {
  const option = settingsSchema[key].options.find((entry) => entry.value === value);
  return option ? option.ms : null;
}

/** @param {number} width */
export function clampSidebarWidth(width) {
  const { min, max } = settingsSchema.sidebarWidth;
  return Math.round(Math.max(min, Math.min(max, width)));
}

/**
 * @param {unknown} patch
 * @param {string} [platform] When given, shortcuts must not share a key on this platform.
 * @returns {Partial<import('./browser').BrowserSettings>}
 */
export function validateSettingsPatch(patch, platform) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("Invalid settings.");
  for (const [key, value] of Object.entries(patch)) {
    if (!isSettingValue(key, value)) throw new Error("Invalid setting: " + key);
  }
  if (
    platform &&
    "shortcuts" in patch &&
    shortcutConflict(/** @type {Record<string, string>} */ (patch.shortcuts), platform)
  )
    throw new Error("Two actions cannot share a shortcut.");
  return patch;
}
