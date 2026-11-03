const fs = require("node:fs");
const path = require("node:path");

const defaults = { tabLayout: "top", searchEngine: "duckduckgo", showShortcuts: true };
const validators = {
  tabLayout: (value) => ["top", "left", "right"].includes(value),
  searchEngine: (value) => ["duckduckgo", "google", "bing"].includes(value),
  showShortcuts: (value) => typeof value === "boolean",
};

function createSettingsStore(file) {
  let settings = { ...defaults };
  try {
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const key of Object.keys(defaults)) {
      if (stored && validators[key](stored[key])) settings[key] = stored[key];
    }
  } catch {
    // Missing or damaged preferences must not prevent the browser from opening.
  }
  return {
    get: () => ({ ...settings }),
    update(patch) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch))
        throw new Error("Invalid settings.");
      for (const [key, value] of Object.entries(patch)) {
        if (!Object.hasOwn(validators, key) || !validators[key](value))
          throw new Error("Invalid setting: " + key);
      }
      const next = { ...settings, ...patch };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = file + ".tmp";
      try {
        fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
        fs.renameSync(temporary, file);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
      settings = next;
      return { ...settings };
    },
  };
}
module.exports = { createSettingsStore };
