import { test, expect, _electron as electron, type Locator, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// HTML drag and drop needs real pointer moves. `share` is where the pointer drops,
// from the top (0) to the bottom (1) of the target row.
async function drag(chrome: Page, source: Locator, target: Locator, share = 0.5) {
  const from = (await source.boundingBox())!;
  await chrome.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await chrome.mouse.down();
  await chrome.mouse.move(from.x + from.width / 2 + 5, from.y + from.height / 2 + 5, { steps: 3 });
  const to = (await target.boundingBox())!;
  await chrome.mouse.move(to.x + to.width / 2, to.y + to.height * share, { steps: 8 });
  await chrome.mouse.up();
}

const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(entry[0]),
  ),
);
env.BROWSER_TEST_HOOKS = "1";

test("nested folders: create, drag, keyboard, collapse, delete, and persist", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-nested-"));
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<title>Site ${request.url}</title><h1>${request.url}</h1>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const launch = () => electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
  let app = await launch();
  try {
    let chrome = await app.firstWindow();
    const state = () => chrome.evaluate(() => window.browser!.getState());
    const tree = async () =>
      Object.fromEntries((await state()).folders.map((folder) => [folder.name, folder.parentId]));
    const id = async (name: string) =>
      (await state()).folders.find((folder) => folder.name === name)!.id;
    const row = async (name: string) => chrome.locator(`#folder-${await id(name)}`);
    const group = (name: string) => chrome.getByRole("group", { name: `Folder: ${name}` });
    const address = () => chrome.getByRole("textbox", { name: "Search or enter address" });
    const open = async (path: string, newTab = true) => {
      if (newTab) await chrome.getByRole("button", { name: "New tab", exact: true }).click();
      await address().fill(origin + path);
      await address().press("Enter");
      await expect(chrome.getByRole("tab", { name: `Site ${path}` })).toBeVisible();
    };
    const nameFolder = async (name: string) => {
      const field = chrome.getByRole("textbox", { name: "Folder name" });
      await expect(field).toBeFocused();
      await field.fill(name);
      await field.press("Enter");
      await expect(field).toBeHidden();
    };
    const palette = async (command: string) => {
      await chrome.getByRole("button", { name: "Command palette" }).click();
      await expect
        .poll(() =>
          app
            .context()
            .pages()
            .some((page) => page.url().endsWith("#palette")),
        )
        .toBe(true);
      const view = app
        .context()
        .pages()
        .find((page) => page.url().endsWith("#palette"))!;
      const input = view.getByRole("combobox", { name: "Search or enter a command" });
      await expect(input).toBeFocused();
      await input.fill(`> ${command}`);
      await expect(view.getByRole("option").first()).toContainText(command);
      await input.press("Enter");
    };
    const folderMenu = (name: string, ...labels: string[]) =>
      id(name).then((folderId) =>
        app.evaluate(
          (_electron, [folderId, labels]) =>
            (globalThis as any).browserTest.clickFolderMenu(folderId, ...labels),
          [folderId, labels] as const,
        ),
      );

    await chrome.evaluate(() => window.browser!.setTabLayout("left"));
    await open("/a", false);
    for (const path of ["/b", "/c"]) await open(path);

    // Palette: a top-level folder. Folder menu: a folder inside it.
    await palette("New folder");
    await nameFolder("Archives");
    await folderMenu("Archives", "New folder inside");
    await nameFolder("Nreal");
    await expect.poll(tree).toEqual({ Archives: null, Nreal: await id("Archives") });

    // Drag a tab into the folder. The palette then offers a folder inside the tab's folder.
    await drag(chrome, chrome.getByRole("tab", { name: "Site /a" }), await row("Archives"));
    await expect(group("Archives").getByRole("tab", { name: "Site /a" })).toBeVisible();
    await chrome.getByRole("tab", { name: "Site /a" }).click();
    await palette("New folder inside Archives");
    await nameFolder("ZMK");
    await chrome.getByRole("tab", { name: "Site /c" }).click();
    await palette("New folder");
    await nameFolder("Read");
    const archives = await id("Archives");
    await expect.poll(tree).toEqual({ Archives: null, Nreal: archives, ZMK: archives, Read: null });

    // The child folder's icon starts where its parent's name starts.
    const nrealIcon = (await (await row("Nreal")).locator(".folder-icon").boundingBox())!;
    const archivesName = (await (await row("Archives")).locator(".folder-name").boundingBox())!;
    expect(nrealIcon.x).toBe(archivesName.x);
    expect((await (await row("Nreal")).boundingBox())!.height).toBe(38);
    await expect((await row("Archives")).locator(".folder-name")).toHaveCSS("font-weight", "600");

    // Drag a folder onto the middle of a folder: into it. Onto its top edge: before it.
    await drag(chrome, await row("Read"), await row("Nreal"));
    await expect.poll(tree).toMatchObject({ Read: await id("Nreal") });
    await expect(group("Nreal").getByRole("group", { name: "Folder: Read" })).toBeVisible();
    await drag(chrome, await row("Read"), await row("Archives"), 0.1);
    await expect.poll(tree).toMatchObject({ Read: null });
    expect((await state()).folders.map((folder) => folder.name)).toEqual([
      "Read",
      "Archives",
      "Nreal",
      "ZMK",
    ]);
    // A folder cannot move into a folder inside it, and nothing else moves.
    await drag(chrome, await row("Archives"), await row("Nreal"));
    await chrome.waitForTimeout(300);
    expect((await state()).folders.map((folder) => [folder.name, folder.parentId])).toEqual([
      ["Read", null],
      ["Archives", null],
      ["Nreal", archives],
      ["ZMK", archives],
    ]);

    // Drag a tab into a nested folder, then move it out with the keyboard.
    await drag(chrome, chrome.getByRole("tab", { name: "Site /b" }), await row("ZMK"));
    await expect(group("ZMK").getByRole("tab", { name: "Site /b" })).toBeVisible();
    const tabB = () => chrome.getByRole("tab", { name: "Site /b" });
    await tabB().click();
    await tabB().focus();
    await chrome.keyboard.press("Alt+Shift+ArrowDown");
    await expect
      .poll(async () => (await state()).tabs.find((tab) => tab.id === 2)?.folderId)
      .toBe(archives);
    expect((await state()).sections.folders.find((entry) => entry.id === archives)?.slots).toEqual([
      [2],
      [1],
    ]);
    await expect(tabB()).toBeFocused();
    await chrome.keyboard.press("Alt+Shift+ArrowUp");
    await expect
      .poll(async () => (await state()).tabs.find((tab) => tab.id === 2)?.folderId)
      .toBe(await id("ZMK"));
    // A folder moves among its siblings, and at the edge out of its parent.
    await (await row("ZMK")).focus();
    await chrome.keyboard.press("Alt+Shift+ArrowUp");
    await expect
      .poll(async () => (await state()).folders.map((folder) => folder.name))
      .toEqual(["Read", "Archives", "ZMK", "Nreal"]);
    await chrome.keyboard.press("Alt+Shift+ArrowUp");
    await expect.poll(tree).toMatchObject({ ZMK: null });
    await expect(await row("ZMK")).toBeFocused();
    await chrome.keyboard.press("Alt+Shift+ArrowDown");
    await expect.poll(tree).toMatchObject({ ZMK: null });
    await drag(chrome, await row("ZMK"), await row("Archives"));
    await expect.poll(tree).toMatchObject({ ZMK: archives });

    // Collapse: the parent hides all of its children and shows a closed folder.
    await chrome.getByRole("tab", { name: "Site /c" }).click();
    await (await row("Archives")).click();
    await expect(await row("Archives")).toHaveAttribute("aria-expanded", "false");
    await expect(group("Archives").getByRole("group")).toHaveCount(0);
    await expect(group("Archives").getByRole("tab")).toHaveCount(0);
    await expect((await row("Archives")).locator(".folder-count")).toHaveText("2");
    await (await row("Archives")).click();
    await expect(group("Nreal")).toBeVisible();

    // Saved with parent ids (version 4 also saves today tabs), and restored after a restart.
    await expect
      .poll(async () => {
        const saved = JSON.parse(await readFile(join(profile, "tabs.json"), "utf8"));
        return [
          saved.version,
          saved.folders.map((folder: { parentId: unknown }) => folder.parentId),
        ];
      })
      .toEqual([4, [null, null, archives, archives]]);
    // Ids change on load; names, parents, and open state stay.
    const shape = async () => {
      const { folders } = await state();
      const name = (id: number | null) => folders.find((folder) => folder.id === id)?.name ?? null;
      return folders.map((folder) => [folder.name, name(folder.parentId), folder.collapsed]);
    };
    const before = await shape();
    await app.close();
    app = await launch();
    chrome = await app.firstWindow();
    await expect.poll(shape).toEqual(before);
    await expect(group("Archives").getByRole("group", { name: "Folder: ZMK" })).toBeVisible();

    // Deleting a folder moves its subfolders and tabs up one level.
    await folderMenu("Archives", "Delete folder");
    await expect.poll(tree).toEqual({ Read: null, Nreal: null, ZMK: null });
    expect((await state()).tabs.filter((tab) => tab.zone === "pinned")).toHaveLength(2);
  } finally {
    await app.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("version 2 tabs.json loads with every folder at the top level", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-nested-v2-"));
  await writeFile(
    join(profile, "tabs.json"),
    JSON.stringify({
      version: 2,
      activeSpaceId: 1,
      spaces: [{ id: 1, name: "Personal", color: "blue", profile: "browsing" }],
      folders: [
        { id: 4, name: "Work", collapsed: false, spaceId: 1 },
        { id: 5, name: "Read", collapsed: true, spaceId: 1 },
      ],
      tabs: [{ spaceId: 1, zone: "pinned", folderId: 4, homeUrl: "https://example.com/" }],
      archive: [],
      routes: [],
    }),
  );
  const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
  try {
    const chrome = await app.firstWindow();
    await chrome.evaluate(() => window.browser!.setTabLayout("left"));
    await expect
      .poll(async () =>
        (await chrome.evaluate(() => window.browser!.getState())).folders.map((folder) => [
          folder.name,
          folder.parentId,
        ]),
      )
      .toEqual([
        ["Work", null],
        ["Read", null],
      ]);
    await expect(
      chrome.getByRole("group", { name: "Folder: Work" }).getByRole("tab", { name: "example.com" }),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
