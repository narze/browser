import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { createExtensionManager, extensionResource } from "../electron/extensions.cjs";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
const id = "a".repeat(32);
const otherId = "b".repeat(32);
const otherProfile = "space-0123456789abcdef";
function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "extension-manager-")));
  directories.push(directory);
  const folder = join(directory, "extension");
  mkdirSync(folder);
  const file = join(directory, "extensions.json");
  const sessions = new Map<string, Map<string, any>>();
  const broken = new Set<string>();
  const getSession = (profile: string) => {
    if (!sessions.has(profile)) sessions.set(profile, new Map());
    const loaded = sessions.get(profile)!;
    return {
      clearStorageData: async () => {},
      extensions: {
        loadExtension: async (path: string, options: { allowFileAccess: boolean }) => {
          expect(options.allowFileAccess).toBe(false);
          if (broken.has(path)) throw new Error("Folder missing");
          const extension = {
            id: path === folder ? id : otherId,
            name: "Fixture",
            version: "1.0",
            path,
            manifest: { action: { default_popup: "popup.html" }, options_page: "options.html" },
          };
          loaded.set(extension.id, extension);
          return extension;
        },
        getExtension: (id: string) => loaded.get(id) ?? null,
        removeExtension: (id: string) => {
          loaded.delete(id);
        },
      },
    };
  };
  const manager = () => createExtensionManager(file, getSession);
  return { directory, folder, file, sessions, broken, getSession, manager };
}

describe("extension profiles", () => {
  it("does not finish installation before Electron initializes extension browser state", async () => {
    const f = fixture();
    const session = f.getSession("browsing");
    const native = session.extensions;
    const events = Object.assign(new EventEmitter(), native);
    let ready: (() => void) | undefined;
    events.loadExtension = async (folder, options) => {
      const extension = await native.loadExtension(folder, options);
      ready = () => events.emit("extension-ready", {}, extension);
      return extension;
    };
    const manager = createExtensionManager(f.file, () => ({ ...session, extensions: events }));
    const installing = manager.install("browsing", f.folder);
    await expect.poll(() => typeof ready).toBe("function");
    expect(manager.list("browsing")).toEqual([]);
    ready!();
    await installing;
    expect(manager.list("browsing")[0].loaded).toBe(true);
    expect(events.listenerCount("extension-ready")).toBe(0);
  });
  it("registers store downloads with the expected ID and restores them in their space", async () => {
    const f = fixture();
    const manager = f.manager();
    await manager.installFromStore("browsing", id, async () => f.folder);
    expect(manager.list("browsing")[0]).toMatchObject({ id, enabled: true, loaded: true });
    await expect(
      manager.installFromStore("browsing", id, async () => {
        throw new Error("must not download twice");
      }),
    ).rejects.toThrow("already installed");
    await expect(
      manager.installFromStore(otherProfile, otherId, async () => f.folder),
    ).rejects.toThrow("ID");
    expect(manager.list(otherProfile)).toEqual([]);
    expect(f.getSession(otherProfile).extensions.getExtension(id)).toBeNull();
    f.sessions.clear();
    const restored = f.manager();
    await restored.restore(["browsing", otherProfile]);
    expect(restored.list("browsing")[0]).toMatchObject({ id, loaded: true });
    expect(restored.list(otherProfile)).toEqual([]);
  });

  it("does not register cancelled downloads or accept invalid store IDs", async () => {
    const f = fixture();
    const manager = f.manager();
    expect(await manager.installFromStore("browsing", id, async () => null)).toBe(false);
    await expect(
      manager.installFromStore("browsing", "../bad", async () => f.folder),
    ).rejects.toThrow("ID");
    expect(manager.list("browsing")).toEqual([]);
  });

  it("keeps installations and resources scoped to their space, including removal", async () => {
    const f = fixture();
    const manager = f.manager();
    await manager.install("browsing", f.folder);
    expect(manager.list(otherProfile)).toEqual([]);
    expect(() => manager.resource(otherProfile, id, "popup")).toThrow("not found");
    await expect(manager.remove(otherProfile, id)).rejects.toThrow("not found");
    await manager.install(otherProfile, f.folder);
    await manager.clearProfile("browsing");
    expect(manager.list("browsing")).toEqual([]);
    expect(f.getSession("browsing").extensions.getExtension(id)).toBeNull();
    expect(manager.list(otherProfile)[0]).toMatchObject({ loaded: true, enabled: true });
    expect(manager.resource(otherProfile, id, "popup")).toBe(`chrome-extension://${id}/popup.html`);
  });

  it("restores enabled extensions, preserves disabled ones and reports missing folders", async () => {
    const f = fixture();
    const manager = f.manager();
    const secondFolder = join(f.directory, "second");
    mkdirSync(secondFolder);
    await manager.install("browsing", f.folder);
    await manager.install("browsing", secondFolder);
    await manager.setEnabled("browsing", otherId, false);
    f.sessions.clear();
    f.broken.add(f.folder);
    const restored = f.manager();
    await expect(restored.restore(["browsing"])).resolves.toBeUndefined();
    expect(restored.list("browsing")).toMatchObject([
      { enabled: true, loaded: false, error: "Folder missing" },
      { enabled: false, loaded: false, error: null },
    ]);
    f.broken.clear();
    await restored.reload("browsing", id);
    expect(restored.list("browsing")[0]).toMatchObject({ loaded: true, error: null });
  });

  it("rolls back a native install if its registration cannot be saved", async () => {
    const f = fixture();
    const manager = f.manager();
    mkdirSync(f.file);
    await expect(manager.install("browsing", f.folder)).rejects.toThrow();
    expect(manager.list("browsing")).toEqual([]);
    expect(f.getSession("browsing").extensions.getExtension(id)).toBeNull();
  });

  it("serializes install and disable without losing either change", async () => {
    const f = fixture();
    const manager = f.manager();
    await Promise.all([
      manager.install("browsing", f.folder),
      manager.setEnabled("browsing", id, false),
    ]);
    expect(manager.list("browsing")[0]).toMatchObject({ enabled: false, loaded: false });
    const restored = f.manager();
    await restored.restore(["browsing"]);
    expect(restored.list("browsing")[0]).toMatchObject({ enabled: false, loaded: false });
    writeFileSync(f.file, "broken json");
    expect(f.manager().list("browsing")).toEqual([]);
  });

  it("rejects external and other-extension popup/options URLs", () => {
    for (const resource of [
      "https://example.com/",
      "file:///tmp/secret",
      `chrome-extension://${otherId}/page.html`,
      "javascript:alert(1)",
      "//example.com/a",
      "",
      null,
    ]) {
      expect(extensionResource({ id }, resource)).toBeNull();
    }
    expect(extensionResource({ id }, "/options.html?tab=1#main")).toBe(
      `chrome-extension://${id}/options.html?tab=1#main`,
    );
  });
});
