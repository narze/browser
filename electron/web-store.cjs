const fs = require("node:fs/promises");
const path = require("node:path");

const STORE_ORIGIN = "https://chromewebstore.google.com";
const validId = (id) => typeof id === "string" && /^[a-p]{32}$/.test(id);

// Use the package's store-page bridge and CRX downloader, while all persistence
// and mutations go through our per-space extension manager. The package's own
// installer/auto-loader would bypass disabled and removed extension records.
function createWebStore({
  ipcMain,
  manager,
  extensionsPath,
  preloadPath,
  downloadExtension,
  prompt,
  closeWindows,
  chromeVersion,
}) {
  const profiles = new WeakMap();
  const installing = new Set();
  function notify(event, channel, value) {
    try {
      if (event.senderFrame && !event.senderFrame.isDestroyed?.())
        event.senderFrame.send(channel, value);
    } catch {
      // A page may leave while downloading or showing consent. Its notification
      // must not change the result of an already committed install/removal.
    }
  }
  function handle(channel, operation) {
    ipcMain.handle(channel, async (event, ...args) => {
      const profile = profiles.get(event.sender.session);
      let origin;
      try {
        origin = new URL(event.senderFrame?.url).origin;
      } catch {
        /* Reject missing or invalid frame URLs. */
      }
      if (!profile || event.senderFrame !== event.sender.mainFrame || origin !== STORE_ORIGIN)
        throw new Error("Only a Chrome Web Store page in a browsing space can use this API.");
      return operation(profile, event, ...args);
    });
  }
  const status = (profile, id) => {
    const record = manager.list(profile).find((entry) => entry.id === id);
    return !record
      ? "installable"
      : !record.enabled
        ? "disabled"
        : record.loaded
          ? "enabled"
          : "terminated";
  };
  handle("chromeWebstore.beginInstall", async (profile, event, details) => {
    const id = details?.id;
    if (!validId(id)) return { result: "invalid_id" };
    const key = `${profile}:${id}`;
    if (installing.has(key)) return { result: "install_in_progress" };
    if (status(profile, id) !== "installable") return { result: "already_installed" };
    installing.add(key);
    let staging;
    let installed = false;
    try {
      installed = await manager.installFromStore(profile, id, async () => {
        const directory = path.join(extensionsPath, profile);
        await fs.mkdir(directory, { recursive: true });
        staging = await fs.mkdtemp(path.join(directory, "install-"));
        const folder = await downloadExtension(id, staging);
        const manifest = JSON.parse(await fs.readFile(path.join(folder, "manifest.json"), "utf8"));
        if (manifest.manifest_version !== 3 || manifest.theme || manifest.app)
          throw new Error(
            "Only Manifest V3 extensions are supported. Themes and Chrome apps cannot be installed.",
          );
        let name = manifest.name;
        const message = typeof name === "string" && /^__MSG_(.+)__$/.exec(name);
        if (message && /^[a-zA-Z0-9_@-]+$/.test(manifest.default_locale)) {
          try {
            const messages = JSON.parse(
              await fs.readFile(
                path.join(folder, "_locales", manifest.default_locale, "messages.json"),
                "utf8",
              ),
            );
            const key = Object.keys(messages).find(
              (key) => key.toLowerCase() === message[1].toLowerCase(),
            );
            if (key && typeof messages[key]?.message === "string") name = messages[key].message;
          } catch {
            /* A missing translation must not hide the manifest's name. */
          }
        }
        // Consent uses the downloaded manifest, never metadata supplied by a page.
        const permissions = [
          ...(manifest.permissions ?? []),
          ...(manifest.host_permissions ?? []),
          ...(manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []),
        ];
        if (
          !(await prompt({
            kind: "install",
            profile,
            id,
            name,
            permissions: [...new Set(permissions)],
            event,
          }))
        )
          return null;
        return folder;
      });
      if (!installed) return { result: "user_cancelled" };
      notify(event, "chrome.management.onInstalled", { id, enabled: true, type: "extension" });
      return { result: "success" };
    } catch (error) {
      return { result: "install_error", message: error.message };
    } finally {
      installing.delete(key);
      if (staging && !installed) await fs.rm(staging, { recursive: true, force: true });
    }
  });
  handle("chromeWebstore.getExtensionStatus", (profile, _event, id) => status(profile, id));
  handle("chromeWebstore.getFullChromeVersion", () => ({
    version_number: chromeVersion,
    app_name: "Browser",
  }));
  handle("chrome.management.getAll", (profile) =>
    manager.list(profile).map((entry) => ({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      enabled: entry.enabled,
      type: "extension",
      mayDisable: true,
    })),
  );
  handle("chrome.management.setEnabled", async (profile, _event, id, enabled) => {
    await manager.setEnabled(profile, id, enabled);
    if (!enabled) closeWindows(profile, id);
    return true;
  });
  handle("chrome.management.uninstall", async (profile, event, id) => {
    const extension = manager.list(profile).find((entry) => entry.id === id);
    if (!extension) throw new Error("Extension not found in this space.");
    if (!(await prompt({ kind: "remove", profile, id, name: extension.name, event })))
      return "user_cancelled";
    await manager.remove(profile, id);
    closeWindows(profile, id);
    notify(event, "chrome.management.onUninstalled", id);
    return "success";
  });
  const replies = {
    completeInstall: "success",
    enableAppLauncher: false,
    getBrowserLogin: "",
    getIsLauncherEnabled: false,
    getMV2DeprecationStatus: "soft_disable",
    getReferrerChain: "EgIIAA==",
    getStoreLogin: "",
    getWebGLStatus: "webgl_allowed",
    isInIncognitoMode: false,
    isPendingCustodianApproval: false,
    setStoreLogin: false,
  };
  for (const [name, reply] of Object.entries(replies))
    handle(`chromeWebstore.${name}`, () => reply);
  return {
    addSession(profile, browsing) {
      profiles.set(browsing, profile);
      browsing.registerPreloadScript({ type: "frame", filePath: preloadPath });
    },
  };
}

module.exports = { createWebStore };
