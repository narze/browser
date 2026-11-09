import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExtensionManager } from "../electron/extensions.cjs";
import { createWebStore } from "../electron/web-store.cjs";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
const id = "a".repeat(32);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "web-store-"));
  directories.push(root);
  const handlers = new Map<string, Function>();
  const loaded = new Map();
  const session = {
    registerPreloadScript() {},
    clearStorageData: async () => {},
    extensions: {
      getExtension: (id: string) => loaded.get(id),
      removeExtension: (id: string) => loaded.delete(id),
      loadExtension: async (folder: string) => {
        const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8"));
        const extension = {
          id,
          path: folder,
          manifest,
          name: manifest.name,
          version: manifest.version,
        };
        loaded.set(id, extension);
        return extension;
      },
    },
  };
  const manager = createExtensionManager(join(root, "extensions.json"), () => session);
  let accepted = true;
  const prompts: any[] = [];
  let downloads = 0;
  const store = createWebStore({
    ipcMain: { handle: (channel: string, handler: Function) => handlers.set(channel, handler) },
    manager,
    extensionsPath: root,
    chromeVersion: "150.0.0.0",
    preloadPath: "/fixture/preload.js",
    downloadExtension: async (requested: string, folder: string) => {
      expect(requested).toBe(id);
      downloads++;
      mkdirSync(join(folder, "_locales", "en"), { recursive: true });
      writeFileSync(
        join(folder, "_locales", "en", "messages.json"),
        JSON.stringify({ storeName: { message: "Downloaded name" } }),
      );
      writeFileSync(
        join(folder, "manifest.json"),
        JSON.stringify({
          manifest_version: 3,
          name: "__MSG_storeName__",
          default_locale: "en",
          version: "1.0",
          permissions: ["storage"],
          host_permissions: ["https://example.com/*"],
        }),
      );
      return folder;
    },
    prompt: async (details: any) => {
      prompts.push(details);
      return accepted;
    },
    closeWindows() {},
  });
  store.addSession("browsing", session);
  const frame = { url: "https://chromewebstore.google.com/detail/fixture/" + id, send() {} };
  const event = { sender: { session, mainFrame: frame }, senderFrame: frame };
  const invoke = (name: string, ...args: any[]) => handlers.get(name)!(event, ...args);
  return {
    root,
    manager,
    event,
    invoke,
    prompts,
    downloads: () => downloads,
    decline: () => {
      accepted = false;
    },
  };
}

describe("Chrome Web Store bridge", () => {
  it("keeps successful mutations when the store page leaves before notification", async () => {
    const f = fixture();
    f.event.senderFrame.send = () => {
      throw new Error("Frame detached");
    };
    expect(await f.invoke("chromeWebstore.beginInstall", { id })).toEqual({ result: "success" });
    expect(f.manager.list("browsing")[0].loaded).toBe(true);
    expect(await f.invoke("chrome.management.uninstall", id)).toBe("success");
    expect(f.manager.list("browsing")).toEqual([]);
  });

  it("installs into the sender's space and uses downloaded metadata for consent", async () => {
    const f = fixture();
    expect(
      await f.invoke("chromeWebstore.beginInstall", { id, localizedName: "Untrusted name" }),
    ).toEqual({ result: "success" });
    expect(f.prompts[0]).toMatchObject({
      name: "Downloaded name",
      permissions: ["storage", "https://example.com/*"],
      profile: "browsing",
    });
    expect(f.manager.list("browsing")[0]).toMatchObject({ id, loaded: true });
    expect(await f.invoke("chromeWebstore.getExtensionStatus", id)).toBe("enabled");
    await f.manager.setEnabled("browsing", id, false);
    expect(await f.invoke("chromeWebstore.getExtensionStatus", id)).toBe("disabled");
    expect(await f.invoke("chrome.management.setEnabled", id, true)).toBe(true);
    expect(f.manager.list("browsing")[0].loaded).toBe(true);
    expect(await f.invoke("chrome.management.uninstall", id)).toBe("success");
    expect(f.manager.list("browsing")).toEqual([]);
  });

  it("cancels without loading, and rejects bad IDs before download", async () => {
    const f = fixture();
    f.decline();
    expect(await f.invoke("chromeWebstore.beginInstall", { id })).toEqual({
      result: "user_cancelled",
    });
    expect(f.manager.list("browsing")).toEqual([]);
    expect(await f.invoke("chromeWebstore.beginInstall", { id: "../../bad" })).toEqual({
      result: "invalid_id",
    });
    expect(f.downloads()).toBe(1);
  });

  it.each([
    "https://chromewebstore.google.com.attacker.test/",
    "http://chromewebstore.google.com/",
    "https://example.com/",
  ])("rejects a non-store sender at %s", async (url) => {
    const f = fixture();
    f.event.senderFrame.url = url;
    await expect(f.invoke("chromeWebstore.beginInstall", { id })).rejects.toThrow("Web Store");
    expect(f.downloads()).toBe(0);
  });

  it("rejects subframes and sessions outside browsing profiles", async () => {
    const f = fixture();
    f.event.senderFrame = { ...f.event.senderFrame };
    await expect(f.invoke("chromeWebstore.beginInstall", { id })).rejects.toThrow("Web Store");
    f.event.senderFrame = f.event.sender.mainFrame;
    f.event.sender.session = {} as any;
    await expect(f.invoke("chromeWebstore.beginInstall", { id })).rejects.toThrow("Web Store");
  });
});
