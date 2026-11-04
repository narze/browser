const fs = require("node:fs");
const path = require("node:path");

const { defaultSettings, isSettingValue, validateSettingsPatch } = require("../shared/settings.js");

function createSettingsStore(file) {
  let settings = { ...defaultSettings };
  try {
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const key of Object.keys(defaultSettings)) {
      if (stored && isSettingValue(key, stored[key])) settings[key] = stored[key];
    }
  } catch {
    // Missing or damaged preferences must not prevent the browser from opening.
  }
  return {
    get: () => ({ ...settings }),
    update(patch) {
      patch = validateSettingsPatch(patch);
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
