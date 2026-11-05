import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a restart reopens the same tabs, splits, and spaces (D6)", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-restore-"));
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<title>Page ${request.url}</title>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(entry[0]),
    ),
  );
  const launch = () => electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
  let app: ElectronApplication = await launch();
  try {
    let chrome = await app.firstWindow();
    const state = () => chrome.evaluate(() => window.browser!.getState());
    const address = () => chrome.getByRole("textbox", { name: "Search or enter address" });
    const tab = (path: string) => chrome.getByRole("tab", { name: `Page ${path}` });
    const spaces = () => chrome.getByRole("navigation", { name: "Spaces" });
    const go = async (path: string) => {
      await address().fill(origin + path);
      await expect(address()).toHaveValue(origin + path);
      await address().press("Enter");
      await expect(tab(path)).toBeVisible();
    };
    const newTab = () => chrome.getByRole("button", { name: "New tab", exact: true }).click();
    // The shown tabs as URL paths, in pane order.
    const shown = async () => {
      const current = await state();
      const ids = current.split?.tabIds ?? [current.activeId];
      return ids.map((id) =>
        current.tabs.find((entry) => entry.id === id)?.url.slice(origin.length),
      );
    };
    await chrome.evaluate(() => window.browser!.setTabLayout("left"));

    // Personal: three tabs, two of them split in columns, one pinned.
    await go("/a");
    await newTab();
    await go("/b");
    await newTab();
    await go("/pinned");
    await chrome.getByRole("tab", { name: "Page /pinned" }).click();
    await chrome.evaluate(async () => {
      const current = await window.browser!.getState();
      await window.browser!.moveTab(current.activeId, "pinned", null, 0);
    });
    await tab("/b").click();
    await chrome.getByRole("button", { name: "Split tabs" }).click();
    await expect.poll(async () => (await state()).split?.tabIds.length).toBe(2);
    await expect.poll(shown).toEqual(["/b", "/a"]);

    // Work: three panes in a grid.
    await spaces().getByRole("button", { name: "New space" }).click();
    await chrome.getByRole("textbox", { name: "Space name" }).fill("Work");
    await chrome.getByRole("textbox", { name: "Space name" }).press("Enter");
    await go("/w1");
    await chrome.getByRole("button", { name: "Split tabs" }).click();
    await go("/w2");
    await chrome.getByRole("button", { name: "Add split pane" }).click();
    await go("/w3");
    await chrome.getByRole("button", { name: "Grid" }).click();
    await expect.poll(async () => (await state()).split?.layout).toBe("grid");
    await expect.poll(shown).toEqual(["/w1", "/w2", "/w3"]);
    await spaces().getByRole("button", { name: "Personal" }).click();
    await expect.poll(shown).toEqual(["/b", "/a"]);
    const before = await state();
    await chrome.screenshot({ path: test.info().outputPath("before-restart.png") });

    const saved = JSON.parse(await readFile(join(profile, "tabs.json"), "utf8"));
    expect(saved.version).toBe(4);
    await app.close();
    app = await launch();
    chrome = await app.firstWindow();

    // The same space, tabs, and split come back, and the shown pages load.
    await expect.poll(shown).toEqual(["/b", "/a"]);
    const after = await state();
    expect(after.activeSpaceId).toBe(before.activeSpaceId);
    expect(after.spaces.map((space) => space.name)).toEqual(["Personal", "Work"]);
    expect(after.sections).toEqual(before.sections);
    expect(after.split).toEqual(before.split);
    await expect(tab("/pinned")).toBeVisible();
    await expect
      .poll(async () =>
        (await state()).tabs
          .filter((entry) => !entry.asleep)
          .map((entry) => [entry.url.slice(origin.length), entry.loading]),
      )
      .toEqual([
        ["/a", false],
        ["/b", false],
      ]);
    await expect(chrome.getByRole("group", { name: "Split tabs" })).toBeVisible();
    await chrome.screenshot({ path: test.info().outputPath("after-restart.png") });

    // The other space keeps its own split.
    await spaces().getByRole("button", { name: "Work" }).click();
    await expect.poll(shown).toEqual(["/w1", "/w2", "/w3"]);
    await expect.poll(async () => (await state()).split?.layout).toBe("grid");
  } finally {
    await app.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
