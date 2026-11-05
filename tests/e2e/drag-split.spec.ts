import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("dragging a tab onto the page splits the view at that edge", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-drag-split-"));
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
    for (const path of ["/a", "/b", "/c"]) {
      if (path !== "/a") await chrome.getByRole("button", { name: "New tab", exact: true }).click();
      await address.fill(`${origin}${path}`);
      await address.press("Enter");
      await expect(chrome.getByRole("tab", { name: `Page ${path}` })).toBeVisible();
    }
    const visiblePaths = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]
          .contentView.children.filter((view) => view.getVisible() && "webContents" in view)
          .map((view) => ({
            path: new URL((view as Electron.WebContentsView).webContents.getURL()).pathname,
            x: view.getBounds().x,
            y: view.getBounds().y,
          })),
      );
    const page = chrome.locator("main");
    const box = (await page.boundingBox())!;
    // Hold a tab over the page: the native pages hide behind still images, and the
    // drop zone shows the half that the tab will take.
    const tabA = chrome.getByRole("tab", { name: "Page /a" });
    const tabBox = (await tabA.boundingBox())!;
    await chrome.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
    await chrome.mouse.down();
    await chrome.mouse.move(box.x + box.width - 40, box.y + box.height / 2, { steps: 8 });
    await expect(chrome.locator(".page-drop-zone")).toHaveAttribute("data-edge", "right");
    await expect.poll(async () => (await visiblePaths()).length).toBe(0);
    await expect(chrome.locator(".page-drop img")).toHaveCount(1);
    await chrome.screenshot({ path: test.info().outputPath("drag-over.png") });
    await chrome.mouse.up();
    await expect(chrome.getByRole("region", { name: "Right pane" })).toBeVisible();
    await expect(chrome.getByRole("combobox", { name: "Right pane tab" })).toHaveValue(
      String((await chrome.evaluate(() => window.browser!.getState())).tabs[0].id),
    );
    await expect.poll(async () => (await visiblePaths()).length).toBe(2);
    let views = await visiblePaths();
    expect(views.find((view) => view.path === "/a")!.x).toBeGreaterThan(
      views.find((view) => view.path === "/c")!.x,
    );
    await expect(chrome.locator(".page-drop")).toHaveCount(0);

    // Columns take a third tab beside a pane, here before the right pane.
    await chrome
      .getByRole("tab", { name: "Page /b" })
      .dragTo(chrome.getByRole("region", { name: "Right pane" }), {
        targetPosition: { x: 20, y: 200 },
      });
    await expect(chrome.getByRole("region", { name: "Middle pane" })).toBeVisible();
    await expect.poll(async () => (await visiblePaths()).length).toBe(3);
    views = (await visiblePaths()).sort((a, b) => a.x - b.x);
    expect(views.map((view) => view.path)).toEqual(["/c", "/b", "/a"]);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});
