const fs = require("node:fs");
const path = require("node:path");

// Only an installed extension's own resources may be opened as its popup/options.
function extensionResource(extension, resource) {
  if (typeof resource !== "string" || !resource.trim()) return null;
  try {
    const base = `chrome-extension://${extension.id}/`;
    const url = new URL(resource, base);
    return url.protocol === "chrome-extension:" &&
      url.hostname === extension.id &&
      !url.username &&
      !url.password &&
      !url.port
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function createExtensionManager(file, getSession) {
  let records = [];
  const errors = new Map();
  const key = (profile, id) => `${profile}:${id}`;
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(saved)) {
      for (const entry of saved) {
        if (
          !entry ||
          typeof entry.profile !== "string" ||
          !/^(browsing|space-[a-f0-9]{16})$/.test(entry.profile) ||
          typeof entry.id !== "string" ||
          !/^[a-p]{32}$/.test(entry.id) ||
          typeof entry.path !== "string" ||
          !path.isAbsolute(entry.path) ||
          typeof entry.enabled !== "boolean" ||
          records.some((r) => key(r.profile, r.id) === key(entry.profile, entry.id))
        )
          continue;
        records.push({
          profile: entry.profile,
          id: entry.id,
          path: entry.path,
          enabled: entry.enabled,
          name: typeof entry.name === "string" ? entry.name : entry.id,
          version: typeof entry.version === "string" ? entry.version : "",
        });
      }
    }
  } catch {
    // A missing or damaged extension list must not stop the browser opening.
  }

  function save(next) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + ".tmp";
    try {
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    records = next;
  }
  // Native loading is asynchronous. Serialize mutations so two installs cannot
  // overwrite one another or race a disable/remove against a pending load.
  let pending = Promise.resolve();
  const run = (operation) => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
  const api = (profile) => getSession(profile).extensions;
  async function unload(profile, id) {
    api(profile).removeExtension(id);
    // Wait for the old worker registration to be removed before loading again.
    await getSession(profile).clearStorageData({
      origin: `chrome-extension://${id}`,
      storages: ["serviceworkers"],
    });
  }
  const find = (profile, id) => {
    const record = records.find((r) => r.profile === profile && r.id === id);
    if (!record) throw new Error("Extension not found in this space.");
    return record;
  };
  async function load(record) {
    try {
      const extension = await api(record.profile).loadExtension(record.path, {
        allowFileAccess: false,
      });
      if (extension.id !== record.id) {
        await unload(record.profile, extension.id);
        throw new Error("The extension ID changed. Remove it and load the folder again.");
      }
      errors.delete(key(record.profile, record.id));
      return extension;
    } catch (error) {
      errors.set(key(record.profile, record.id), error.message);
      throw error;
    }
  }
  return {
    restore(profiles) {
      return run(async () => {
        records = records.filter((r) => profiles.includes(r.profile));
        for (const record of records.filter((r) => r.enabled)) {
          try {
            await load(record);
          } catch {
            /* Show failures in Settings; keep other extensions working. */
          }
        }
      });
    },
    list(profile) {
      return records
        .filter((r) => r.profile === profile)
        .map((record) => {
          const extension = api(profile).getExtension(record.id);
          const manifest = extension?.manifest;
          return {
            id: record.id,
            name: extension?.name ?? record.name,
            version: extension?.version ?? record.version,
            path: record.path,
            enabled: record.enabled,
            loaded: !!extension,
            error: errors.get(key(profile, record.id)) ?? null,
            hasPopup:
              !!extension &&
              !!extensionResource(
                extension,
                (manifest.action ?? manifest.browser_action ?? manifest.page_action)?.default_popup,
              ),
            hasOptions:
              !!extension &&
              !!extensionResource(extension, manifest.options_ui?.page ?? manifest.options_page),
          };
        });
    },
    install(profile, directory) {
      return run(async () => {
        directory = await fs.promises.realpath(directory);
        if (records.some((r) => r.profile === profile && r.path === directory))
          throw new Error("This extension is already installed in this space.");
        const extension = await api(profile).loadExtension(directory, { allowFileAccess: false });
        const duplicate = records.find((r) => r.profile === profile && r.id === extension.id);
        if (duplicate) {
          await unload(profile, extension.id);
          if (duplicate.enabled) await load(duplicate);
          throw new Error("This extension is already installed in this space.");
        }
        try {
          save([
            ...records,
            {
              profile,
              id: extension.id,
              path: directory,
              enabled: true,
              name: extension.name,
              version: extension.version,
            },
          ]);
        } catch (error) {
          await unload(profile, extension.id);
          throw error;
        }
      });
    },
    setEnabled(profile, id, enabled) {
      return run(async () => {
        if (typeof enabled !== "boolean") throw new Error("Invalid extension state.");
        const record = find(profile, id);
        if (enabled === record.enabled && !!api(profile).getExtension(id) === enabled) return;
        const extension = enabled ? await load(record) : null;
        try {
          save(
            records.map((r) =>
              r === record
                ? {
                    ...r,
                    enabled,
                    name: extension?.name ?? r.name,
                    version: extension?.version ?? r.version,
                  }
                : r,
            ),
          );
        } catch (error) {
          if (enabled && !record.enabled) await unload(profile, id);
          throw error;
        }
        if (!enabled) await unload(profile, id);
        errors.delete(key(profile, id));
      });
    },
    reload(profile, id) {
      return run(async () => {
        const record = find(profile, id);
        if (!record.enabled) throw new Error("Enable the extension before reloading it.");
        await unload(profile, id);
        await load(record);
      });
    },
    remove(profile, id) {
      return run(async () => {
        const record = find(profile, id);
        save(records.filter((r) => r !== record));
        await unload(profile, id);
        errors.delete(key(profile, id));
      });
    },
    clearProfile(profile) {
      return run(async () => {
        const removed = records.filter((r) => r.profile === profile);
        save(records.filter((r) => r.profile !== profile));
        for (const record of removed) {
          await unload(profile, record.id);
          errors.delete(key(profile, record.id));
        }
      });
    },
    resource(profile, id, kind) {
      find(profile, id);
      const extension = api(profile).getExtension(id);
      if (!extension) throw new Error("This extension is not loaded.");
      const manifest = extension.manifest;
      const resource =
        kind === "popup"
          ? (manifest.action ?? manifest.browser_action ?? manifest.page_action)?.default_popup
          : (manifest.options_ui?.page ?? manifest.options_page);
      const url = extensionResource(extension, resource);
      if (!url) throw new Error(`This extension has no ${kind} page.`);
      return url;
    },
  };
}

module.exports = { createExtensionManager, extensionResource };
