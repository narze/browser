// @ts-check
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
  showShortcuts: { label: "New-tab shortcuts", default: true },
});

export const defaultSettings = /** @type {import('./browser').BrowserSettings} */ (
  Object.fromEntries(Object.entries(settingsSchema).map(([key, setting]) => [key, setting.default]))
);

/** @param {string} key @param {unknown} value */
export function isSettingValue(key, value) {
  if (!Object.hasOwn(settingsSchema, key)) return false;
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

/** @param {number} width */
export function clampSidebarWidth(width) {
  const { min, max } = settingsSchema.sidebarWidth;
  return Math.round(Math.max(min, Math.min(max, width)));
}

/** @param {unknown} patch @returns {Partial<import('./browser').BrowserSettings>} */
export function validateSettingsPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("Invalid settings.");
  for (const [key, value] of Object.entries(patch)) {
    if (!isSettingValue(key, value)) throw new Error("Invalid setting: " + key);
  }
  return patch;
}
