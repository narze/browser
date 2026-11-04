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
  showShortcuts: { label: "New-tab shortcuts", default: true },
});

export const defaultSettings = /** @type {import('./browser').BrowserSettings} */ (
  Object.fromEntries(Object.entries(settingsSchema).map(([key, setting]) => [key, setting.default]))
);

/** @param {string} key @param {unknown} value */
export function isSettingValue(key, value) {
  if (!Object.hasOwn(settingsSchema, key)) return false;
  const setting = settingsSchema[/** @type {keyof typeof settingsSchema} */ (key)];
  return "options" in setting
    ? setting.options.some((option) => option.value === value)
    : typeof value === typeof setting.default;
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
