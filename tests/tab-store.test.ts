import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTabStore } from "../electron/tab-store.cjs";

const directories: string[] = [];
function file() {
  const directory = mkdtempSync(join(tmpdir(), "browser-tabs-"));
  directories.push(directory);
  return join(directory, "nested", "tabs.json");
}
afterEach(() =>
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })),
);

describe("tab organization store", () => {
  it("starts empty, saves atomically, and reads the saved data back", () => {
    const path = file();
    const store = createTabStore(path);
    expect(store.get()).toBeNull();
    const data = { version: 1, folders: [], tabs: [{ zone: "pinned" }], archive: [] };
    expect(store.save(data)).toBe(true);
    expect(store.save(data)).toBe(false);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(data);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(createTabStore(path).get()).toEqual(data);
  });

  it("treats damaged files as empty", () => {
    const path = file();
    createTabStore(path).save({ version: 1 });
    writeFileSync(path, "{broken");
    expect(createTabStore(path).get()).toBeNull();
  });
});
