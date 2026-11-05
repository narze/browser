import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("split tabs preserve pages, track focus, resize, and recover when a pane closes", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-split-"));
  const server = createServer((req, res) =>
    res.end(`<title>Page ${req.url}</title><h1>${req.url}</h1>`),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
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
    await chrome.getByRole("button", { name: "Split tabs", exact: true }).click();
    await expect(chrome.getByRole("tab")).toHaveCount(2);
    const group = chrome.getByRole("group", { name: "Split tabs", exact: true });
    await expect(group).toBeVisible();
    await expect(group.getByRole("tab")).toHaveCount(2);
    await expect(chrome.locator(".tabs .tab-entry")).toHaveCount(1);

    await expect(chrome.getByRole("textbox", { name: "Search right pane" })).toBeVisible();
    await chrome.screenshot({ path: test.info().outputPath("split-view.png") });
    await chrome.getByRole("textbox", { name: "Search right pane" }).fill(`${origin}/b`);
    await chrome.getByRole("textbox", { name: "Search right pane" }).press("Enter");
    await expect(chrome.getByRole("tab", { name: "Page /b" })).toBeVisible();
    const visibleViews = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]
          .contentView.children.filter((v) => v.getVisible())
          .map((v) => v.getBounds()),
      );
    await expect.poll(async () => (await visibleViews()).length).toBe(2);
    const resizeSidebar = async (position: "left" | "right") => {
      await chrome.evaluate((layout) => window.browser!.setTabLayout(layout), position);
      const sidebar = chrome.getByRole("separator", { name: "Resize tab sidebar" });
      const rail = (await sidebar.boundingBox())!;
      const before = await visibleViews();
      await chrome.mouse.move(rail.x + rail.width / 2, rail.y + 80);
      await chrome.mouse.down();
      await chrome.mouse.move(
        rail.x + rail.width / 2 + (position === "left" ? 50 : -50),
        rail.y + 80,
        { steps: 6 },
      );
      // Native views must follow the drag while the pointer is still held down.
      await expect.poll(async () => (await visibleViews()).length).toBe(before.length);
      await expect
        .poll(async () => (await visibleViews())[0]?.width)
        .toBeLessThan(before[0].width - 10);
      await expect(chrome.locator(".pane-placeholder")).toHaveCount(0);
      await chrome.mouse.up();
      await expect
        .poll(() => chrome.evaluate(async () => (await window.browser!.getState()).sidebarResizing))
        .toBe(false);
    };
    await resizeSidebar("left");
    await resizeSidebar("right");
    await chrome.evaluate(() => window.browser!.setTabLayout("top"));
    await expect.poll(async () => (await visibleViews())[0]?.x).toBe(0);
    const initial = await visibleViews();
    expect(initial[0].x + initial[0].width).toBeLessThan(initial[1].x);
    await app.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((c) => c.getURL().endsWith("/a"))!;
      page.focus();
      return page.executeJavaScript("window.splitMarker = 17");
    });
    await expect(address).toHaveValue(`${origin}/a`);
    const divider = chrome.getByRole("separator", { name: "Resize split panes" });
    const bounds = (await divider.boundingBox())!;
    await chrome.mouse.move(bounds.x + bounds.width / 2, bounds.y + 80);
    await chrome.mouse.down();
    await chrome.mouse.move(bounds.x + 100, bounds.y + 80, { steps: 6 });
    await expect.poll(async () => (await visibleViews()).length).toBe(2);
    await expect
      .poll(async () => (await visibleViews())[0]?.width)
      .toBeGreaterThan(initial[0].width + 40);
    await expect(chrome.locator(".pane-placeholder")).toHaveCount(0);
    await chrome.mouse.up();
    await expect
      .poll(async () => (await visibleViews())[0]?.width)
      .toBeGreaterThan(initial[0].width + 40);
    await group.getByRole("tab", { name: "Page /b" }).click();
    await expect(address).toHaveValue(`${origin}/b`);
    await group.getByRole("tab", { name: "Page /a" }).click();
    await expect(address).toHaveValue(`${origin}/a`);
    // A third tab replaces the focused pane; selecting the opposite tab swaps sides.
    await chrome.getByRole("button", { name: "New tab", exact: true }).click();
    await address.fill(`${origin}/c`);
    await address.press("Enter");
    await expect(chrome.getByRole("tab", { name: "Page /c" })).toBeVisible();
    await expect(group.getByRole("tab")).toHaveText(["Page /c", "Page /b"]);
    await expect(chrome.locator(".tabs .tab-entry")).toHaveCount(2);

    await chrome
      .getByRole("combobox", { name: "Left pane tab" })
      .selectOption({ label: "Page /a" });
    await chrome
      .getByRole("combobox", { name: "Right pane tab" })
      .selectOption({ label: "Page /a" });
    await expect(
      chrome.getByRole("combobox", { name: "Left pane tab" }).locator("option:checked"),
    ).toHaveText("Page /b");
    await expect(group.getByRole("tab")).toHaveText(["Page /b", "Page /a"]);

    await chrome
      .getByRole("combobox", { name: "Left pane tab" })
      .selectOption({ label: "Page /a" });
    await chrome.getByRole("button", { name: "Close tab: Page /c" }).click();
    await expect.poll(async () => (await visibleViews()).length).toBe(2);
    await chrome.getByRole("button", { name: "Settings", exact: true }).click();
    await expect.poll(async () => (await visibleViews()).length).toBe(0);
    await chrome.getByRole("button", { name: "Back to browsing" }).click();
    await expect.poll(async () => (await visibleViews()).length).toBe(2);
    for (const position of ["left", "right", "top"] as const) {
      await chrome.evaluate((layout) => window.browser!.setTabLayout(layout), position);
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(900, 680),
      );
      // Native view bounds settle after the layout report, so wait for both panes to line up.
      await expect
        .poll(async () => {
          const views = await visibleViews();
          return views.length === 2 && views[0].x + views[0].width + 8 - views[1].x;
        })
        .toBe(0);
      const firstTab = (await group.getByRole("tab").nth(0).boundingBox())!;
      const secondTab = (await group.getByRole("tab").nth(1).boundingBox())!;
      expect(firstTab.y).toBe(secondTab.y);
      expect(firstTab.x + firstTab.width).toBeLessThanOrEqual(secondTab.x);
      expect(Math.abs(firstTab.width - secondTab.width)).toBeLessThanOrEqual(1);
      await expect(chrome.locator(".tabs .tab-entry")).toHaveCount(1);
      if (position === "left") {
        await group.getByRole("tab", { name: "Page /a" }).focus();
        await chrome.keyboard.press("ArrowRight");
        await expect(address).toHaveValue(`${origin}/b`);
        await expect(group.getByRole("tab", { name: "Page /b" })).toBeFocused();
        await chrome.keyboard.press("ArrowLeft");
        await expect(address).toHaveValue(`${origin}/a`);
        await chrome.screenshot({ path: test.info().outputPath("grouped-split-tabs.png") });
      }
    }
    expect(
      await app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .find((c) => c.getURL().endsWith("/a"))!
          .executeJavaScript("window.splitMarker"),
      ),
    ).toBe(17);
    await chrome.getByRole("button", { name: "Exit split view" }).click();
    await expect(group).toHaveCount(0);
    await expect(chrome.locator(".tabs .tab-entry")).toHaveCount(2);

    await expect.poll(async () => (await visibleViews()).length).toBe(1);
    await resizeSidebar("left");
    await resizeSidebar("right");
    await chrome.getByRole("button", { name: "Split tabs", exact: true }).click();
    await expect.poll(async () => (await visibleViews()).length).toBe(2);
    await chrome.getByRole("button", { name: "Close tab: Page /b" }).click();
    await expect(chrome.getByRole("button", { name: "Split tabs", exact: true })).toBeVisible();
    await expect(group).toHaveCount(0);
    await expect(chrome.locator(".tabs .tab-entry")).toHaveCount(1);
    await expect(address).toHaveValue(`${origin}/a`);
    await expect.poll(async () => (await visibleViews()).length).toBe(1);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});
