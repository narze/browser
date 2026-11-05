import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("split view shows up to four panes in columns, rows, or a grid", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-split-panes-"));
  const server = createServer((req, res) =>
    res.end(`<title>Page ${req.url}</title><h1>${req.url}</h1>`),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(entry[0]),
    ),
  );
  const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
  try {
    const chrome = await app.firstWindow();
    const address = chrome.getByRole("textbox", { name: "Search or enter address" });
    await address.fill(`${origin}/a`);
    await address.press("Enter");
    await expect(chrome.getByRole("tab", { name: "Page /a" })).toBeVisible();
    // Native page bounds, by page path, in pane order.
    const views = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]
          .contentView.children.filter((view) => view.getVisible() && "webContents" in view)
          .map((view) => ({
            path: new URL((view as Electron.WebContentsView).webContents.getURL()).pathname,
            ...view.getBounds(),
          }))
          .sort((a, b) => a.path.localeCompare(b.path)),
      );
    const regions = () =>
      chrome.locator(".pane-content").evaluateAll((elements) =>
        elements.map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return [x, y, width, height].map(Math.round);
        }),
      );
    const open = async (pane: string, path: string) => {
      await chrome.getByRole("textbox", { name: `Search ${pane} pane` }).fill(`${origin}${path}`);
      await chrome.getByRole("textbox", { name: `Search ${pane} pane` }).press("Enter");
      await expect(chrome.getByRole("tab", { name: `Page ${path}` })).toBeVisible();
    };

    await chrome.getByRole("button", { name: "Split tabs", exact: true }).click();
    await open("right", "/b");
    const controls = chrome.getByRole("group", { name: "Split layout" });
    await expect(controls.getByRole("button", { name: "Grid" })).toBeDisabled();
    await controls.getByRole("button", { name: "Add split pane" }).click();
    await expect(chrome.getByRole("region", { name: "Middle pane" })).toBeVisible();
    await open("right", "/c");
    await expect(chrome.getByRole("group", { name: "Split tabs" }).getByRole("tab")).toHaveText([
      "Page /a",
      "Page /b",
      "Page /c",
    ]);
    await expect.poll(async () => (await views()).length).toBe(3);
    let bounds = await views();
    expect(bounds[0].x + bounds[0].width).toBeLessThan(bounds[1].x);
    expect(bounds[1].x + bounds[1].width).toBeLessThan(bounds[2].x);
    expect(new Set(bounds.map((view) => view.y)).size).toBe(1);

    await controls.getByRole("button", { name: "Rows" }).click();
    await expect(chrome.getByRole("region", { name: "Top pane" })).toBeVisible();
    await expect.poll(async () => new Set((await views()).map((view) => view.x)).size).toBe(1);
    bounds = await views();
    expect(bounds[0].y + bounds[0].height).toBeLessThan(bounds[1].y);
    expect(bounds[1].y + bounds[1].height).toBeLessThan(bounds[2].y);

    await controls.getByRole("button", { name: "Grid" }).click();
    await expect(chrome.getByRole("region", { name: "Bottom right pane" })).toBeVisible();
    await expect.poll(async () => (await views())[0].height).toBeGreaterThan(bounds[0].height * 2);
    await controls.getByRole("button", { name: "Add split pane" }).click();
    await open("bottom right", "/d");
    await expect(controls.getByRole("button", { name: "Add split pane" })).toBeDisabled();
    await expect.poll(async () => (await views()).length).toBe(4);
    await expect
      .poll(async () => (await views()).map(({ x, y, width, height }) => [x, y, width, height]))
      .toEqual(await regions());
    bounds = await views();
    expect(bounds[0].x).toBe(bounds[2].x);
    expect(bounds[0].y).toBe(bounds[1].y);

    // The column divider resizes both columns of the grid; the native pages follow.
    const divider = chrome.getByRole("separator", { name: "Resize columns 1 and 2" });
    const box = (await divider.boundingBox())!;
    await chrome.mouse.move(box.x + box.width / 2, box.y + 60);
    await chrome.mouse.down();
    await chrome.mouse.move(box.x + 120, box.y + 60, { steps: 6 });
    await chrome.mouse.up();
    await expect.poll(async () => (await views())[0].width).toBeGreaterThan(bounds[0].width + 80);
    await expect.poll(async () => (await views())[2].width).toBeGreaterThan(bounds[2].width + 80);
    await chrome.getByRole("separator", { name: "Resize rows 1 and 2" }).focus();
    await chrome.keyboard.press("ArrowDown");
    await expect.poll(async () => (await views())[0].height).toBeGreaterThan(bounds[0].height);
    await expect
      .poll(async () => (await views()).map(({ x, y, width, height }) => [x, y, width, height]))
      .toEqual(await regions());
    await chrome.screenshot({ path: test.info().outputPath("grid.png") });

    // Removing a pane keeps its tab open.
    await chrome.getByRole("button", { name: "Remove top left pane from split" }).click();
    await expect(chrome.getByRole("region", { name: "Left pane" })).toBeVisible();
    await expect.poll(async () => (await views()).length).toBe(3);
    await expect(chrome.getByRole("tab", { name: "Page /a" })).toBeVisible();
    await expect(chrome.getByRole("group", { name: "Split tabs" }).getByRole("tab")).toHaveCount(3);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});
