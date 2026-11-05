import { test, expect, _electron as electron, type Locator, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 1x1 PNG
const ICON = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const HOUR = 3_600_000;

// HTML drag and drop needs real pointer moves; the drop target can appear only after the drag starts.
async function drag(chrome: Page, source: Locator, target: () => Locator) {
  const from = (await source.boundingBox())!;
  await chrome.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await chrome.mouse.down();
  await chrome.mouse.move(from.x + from.width / 2 + 5, from.y + from.height / 2 + 5, { steps: 3 });
  const to = (await target().boundingBox())!;
  await chrome.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await chrome.mouse.up();
}

test("favorites, pinned tabs, folders, rename, sleep, and archive work and persist", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-organization-"));
  const server = createServer((request, response) => {
    if (request.url === "/favicon.ico") {
      response.setHeader("Content-Type", "image/png");
      return response.end(ICON);
    }
    response.setHeader("Content-Type", "text/html");
    response.end(
      `<title>Site ${request.url}</title><h1>${request.url}</h1><a href="/next">Next</a>`,
    );
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
  env.BROWSER_TEST_HOOKS = "1";
  const launch = () => electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
  let app = await launch();
  try {
    let chrome = await app.firstWindow();
    const state = () => chrome.evaluate(() => window.browser!.getState());
    const address = () => chrome.getByRole("textbox", { name: "Search or enter address" });
    const open = async (path: string, newTab = true) => {
      if (newTab) await chrome.getByRole("button", { name: "New tab", exact: true }).click();
      await address().fill(origin + path);
      await address().press("Enter");
      await expect(chrome.getByRole("tab", { name: `Site ${path}` })).toBeVisible();
    };
    await chrome.getByRole("combobox", { name: "Tab layout" }).selectOption("left");
    await open("/a", false);
    for (const path of ["/b", "/c", "/d", "/e"]) await open(path);
    await expect.poll(async () => (await state()).tabs.every((tab) => !tab.loading)).toBe(true);

    // Favicons are cached by the main process and drawn in the chrome.
    const icon = chrome.getByRole("tab", { name: "Site /a" }).locator("img.favicon");
    await expect(icon).toHaveAttribute("src", /^favicon:\/\/icon\/[a-f0-9]{32}\.png$/);
    await expect.poll(() => icon.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);

    // A6: drag reorders today tabs, and Alt+Shift+Arrow moves the focused tab.
    await drag(chrome, chrome.getByRole("tab", { name: "Site /e" }), () =>
      chrome.getByRole("tab", { name: "Site /a" }),
    );
    await expect.poll(async () => (await state()).sections.today.flat()).toEqual([5, 1, 2, 3, 4]);
    await chrome.getByRole("tab", { name: "Site /e" }).focus();
    await chrome.keyboard.press("Alt+Shift+ArrowDown");
    await expect.poll(async () => (await state()).sections.today.flat()).toEqual([1, 5, 2, 3, 4]);

    // A2 and A1: drop tabs into favorites and pinned sections that appear while dragging.
    await drag(chrome, chrome.getByRole("tab", { name: "Site /a" }), () =>
      chrome.getByRole("group", { name: "Favorites" }),
    );
    await drag(chrome, chrome.getByRole("tab", { name: "Site /b" }), () =>
      chrome.getByRole("group", { name: "Pinned tabs" }),
    );
    await expect
      .poll(async () => (await state()).sections)
      .toMatchObject({ favorites: [[1]], pinned: [[2]], today: [[5], [3], [4]] });
    const favorites = chrome.getByRole("group", { name: "Favorites" });
    await expect(favorites.getByRole("tab", { name: "Site /a" })).toBeVisible();
    await expect(favorites.locator(".tab-title")).toBeHidden();

    // A1: a pinned tab offers a way back home after it navigates away, and closing unloads it.
    await chrome.getByRole("tab", { name: "Site /b" }).click();
    await app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().endsWith("/b"))!
        .executeJavaScript('document.querySelector("a").click()', true),
    );
    const reset = chrome.getByRole("button", { name: "Back to pinned page: Site /next" });
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(chrome.getByRole("tab", { name: "Site /b" })).toBeVisible();
    await expect(reset).toBeHidden();
    await chrome.getByRole("button", { name: "Close tab: Site /b" }).click();
    await expect
      .poll(async () => (await state()).tabs.find((tab) => tab.id === 2))
      .toMatchObject({
        asleep: true,
        zone: "pinned",
      });
    await expect(chrome.getByRole("tab", { name: "Site /b" })).toHaveAttribute(
      "title",
      "Site /b (asleep)",
    );

    // A3: create a folder from the palette, name it, then drop a tab into it.
    await chrome.getByRole("button", { name: "Command palette" }).click();
    await expect
      .poll(() =>
        app
          .context()
          .pages()
          .some((page) => page.url().endsWith("#palette")),
      )
      .toBe(true);
    const palette = app
      .context()
      .pages()
      .find((page) => page.url().endsWith("#palette"))!;
    const paletteInput = palette.getByRole("combobox", { name: "Search or enter a command" });
    await expect(paletteInput).toBeFocused();
    await paletteInput.fill("> new folder");
    await paletteInput.press("Enter");
    const folderName = chrome.getByRole("textbox", { name: "Folder name" });
    await expect(folderName).toBeFocused();
    await folderName.fill("Research");
    await folderName.press("Enter");
    await drag(chrome, chrome.getByRole("tab", { name: "Site /c" }), () =>
      chrome.getByRole("button", { name: "Research" }),
    );
    const folder = chrome.getByRole("group", { name: "Folder: Research" });
    await expect(folder.getByRole("tab", { name: "Site /c" })).toBeVisible();
    await chrome.getByRole("tab", { name: "Site /e" }).click();
    await chrome.getByRole("button", { name: "Research" }).click();
    await expect(chrome.getByRole("button", { name: "Research" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(folder.getByRole("tab")).toHaveCount(0);

    // A5: double-click renames; an empty name restores the page title.
    await chrome.getByRole("tab", { name: "Site /d" }).dblclick();
    const tabName = chrome.getByRole("textbox", { name: "Tab name" });
    await expect(tabName).toBeFocused();
    await tabName.fill("Reading list");
    await tabName.press("Enter");
    await expect(chrome.getByRole("tab", { name: "Reading list" })).toBeVisible();
    await chrome.getByRole("tab", { name: "Site /e" }).focus();
    await chrome.keyboard.press("F2");
    await chrome.getByRole("textbox", { name: "Tab name" }).press("Escape");
    await expect(chrome.getByRole("tab", { name: "Site /e" })).toBeVisible();

    // A7: idle tabs sleep, then wake with their back/forward list.
    await chrome.getByRole("tab", { name: "Reading list" }).click();
    await app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().endsWith("/d"))!
        .executeJavaScript('document.querySelector("a").click()', true),
    );
    await expect
      .poll(async () => (await state()).tabs.find((tab) => tab.id === 4)?.url)
      .toBe(`${origin}/next`);
    await chrome.getByRole("tab", { name: "Site /e" }).click();
    await app.evaluate(
      (_electron, ms) => (globalThis as any).browserTest.advanceClock(ms),
      2 * HOUR,
    );
    await expect
      .poll(async () => (await state()).tabs.find((tab) => tab.id === 4)?.asleep)
      .toBe(true);
    const pageCount = () =>
      app.evaluate(
        ({ webContents }) =>
          webContents.getAllWebContents().filter((contents) => contents.getURL().startsWith("http"))
            .length,
      );
    await expect.poll(pageCount).toBe(1);
    await chrome.getByRole("tab", { name: "Reading list" }).click();
    await expect
      .poll(async () => (await state()).tabs.find((tab) => tab.id === 4))
      .toMatchObject({
        asleep: false,
        url: `${origin}/next`,
        canGoBack: true,
      });

    // A4: idle today tabs move to the archive; restoring reopens them.
    await app.evaluate(
      (_electron, ms) => (globalThis as any).browserTest.advanceClock(ms),
      13 * HOUR,
    );
    await expect
      .poll(async () => (await state()).archive.map((entry) => [entry.title, entry.reason]))
      .toEqual([["Site /e", "auto"]]);
    await chrome.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(chrome.getByRole("heading", { name: "Archive" })).toBeVisible();
    await chrome.getByRole("button", { name: "Restore Site /e" }).click();
    await expect(chrome.getByRole("heading", { name: "Archive" })).toBeHidden();
    await expect(chrome.getByRole("tab", { name: "Site /e" })).toBeVisible();
    await expect.poll(async () => (await state()).archive).toEqual([]);
    await chrome.getByRole("button", { name: "Close tab: Site /e" }).click();
    await expect.poll(async () => (await state()).archive.length).toBe(1);

    // Everything except today tabs survives a restart.
    const saved = JSON.parse(await readFile(join(profile, "tabs.json"), "utf8"));
    expect(saved.tabs.map((tab: { homeUrl: string }) => tab.homeUrl)).toEqual([
      `${origin}/a`,
      `${origin}/b`,
      `${origin}/c`,
    ]);
    await app.close();
    app = await launch();
    chrome = await app.firstWindow();
    await expect(chrome.getByRole("button", { name: "Research" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect
      .poll(async () => {
        const restored = await state();
        return {
          sections: restored.sections,
          asleep: restored.tabs.filter((tab) => tab.zone !== "today").every((tab) => tab.asleep),
          archive: restored.archive.map((entry) => entry.title),
        };
      })
      .toEqual({
        sections: {
          favorites: [[1]],
          folders: [{ id: 1, slots: [[3]] }],
          pinned: [[2]],
          today: [[4]],
        },
        asleep: true,
        archive: ["Site /e"],
      });
    await expect(
      chrome.getByRole("group", { name: "Favorites" }).locator("img.favicon"),
    ).toHaveAttribute("src", /^favicon:\/\//);
    await chrome.getByRole("group", { name: "Favorites" }).getByRole("tab").click();
    await expect
      .poll(async () => (await state()).tabs[0])
      .toMatchObject({ asleep: false, loading: false });
    await expect(address()).toHaveValue(`${origin}/a`);
  } finally {
    await app.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
