const fs = require("node:fs");
const path = require("node:path");

// Favorites, pinned tabs, folders, and the archive survive a restart.
// The session validates the content; this store only reads and writes JSON.
function createTabStore(file) {
  let last = null;
  let data = null;
  try {
    last = fs.readFileSync(file, "utf8");
    data = JSON.parse(last);
  } catch {
    // A missing or damaged file must not prevent the browser from opening.
    data = null;
  }
  return {
    get: () => data,
    /** @returns {boolean} true when the file changed */
    save(next) {
      const text = JSON.stringify(next, null, 2) + "\n";
      if (text === last) return false;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = file + ".tmp";
      try {
        fs.writeFileSync(temporary, text, { mode: 0o600 });
        fs.renameSync(temporary, file);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
      last = text;
      data = JSON.parse(text);
      return true;
    },
  };
}

module.exports = { createTabStore };
