import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("palette overlays live split pages, navigates, switches tabs, and runs commands", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-palette-"));
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<title>Library ${req.url}</title><body style="background:#334155;color:white"><h1>Library ${req.url}</h1></body>`,
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
  const app = await electron.launch({
    args: [".", `--user-data-dir=${profile}`],
    env,
    colorScheme: null,
  });
  try {
    const chrome = await app.firstWindow();
    // Hosted macOS runners may constrain the window to their smaller display.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1024, 674),
    );
    const address = chrome.getByRole("textbox", { name: "Search or enter address" });
    await address.fill(`${origin}/one`);
    await address.press("Enter");
    await expect(chrome.getByRole("tab", { name: "Library /one" })).toBeVisible();
    await chrome.getByRole("button", { name: "Split tabs", exact: true }).click();
    await chrome.getByRole("textbox", { name: "Search right pane" }).fill(`${origin}/two`);
    await chrome.getByRole("textbox", { name: "Search right pane" }).press("Enter");
    await expect(chrome.getByRole("tab", { name: "Library /two" })).toBeVisible();
    // A shortcut from the native website must open the palette, not just shortcuts in Svelte.
    await app.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((c) => c.getURL().endsWith("/two"))!;
      void page.executeJavaScript("window.paletteMarker = 73");
      page.focus();
      page.sendInputEvent({
        type: "keyDown",
        keyCode: "L",
        modifiers: [process.platform === "darwin" ? "meta" : "control"],
      });
      page.sendInputEvent({
        type: "keyUp",
        keyCode: "L",
        modifiers: [process.platform === "darwin" ? "meta" : "control"],
      });
    });
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
    const input = palette.getByRole("combobox", { name: "Search or enter a command" });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(`${origin}/two`);
    expect(
      await input.evaluate(
        (element: HTMLInputElement) => element.selectionEnd! - element.selectionStart!,
      ),
    ).toBe(`${origin}/two`.length);
    const { stack, contentSize } = await app.evaluate(({ BrowserWindow }) => {
      const host = BrowserWindow.getAllWindows()[0];
      return {
        contentSize: host.getContentSize(),
        stack: host.contentView.children.map((view) => ({
          visible: view.getVisible(),
          bounds: view.getBounds(),
        })),
      };
    });
    expect(stack.filter((view) => view.visible)).toHaveLength(3);
    expect(stack.at(-1)!.bounds).toEqual({
      x: 0,
      y: 0,
      width: contentSize[0],
      height: contentSize[1],
    });
    await input.press("Escape");
    await expect
      .poll(() => chrome.evaluate(async () => (await window.browser!.getState()).palette))
      .toBeNull();
    await expect(address).toHaveValue(`${origin}/two`);
    expect(
      await app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .find((c) => c.getURL().endsWith("/two"))!
          .executeJavaScript("window.paletteMarker"),
      ),
    ).toBe(73);

    await chrome.getByRole("button", { name: "Command palette", exact: true }).click();
    await input.fill("Library /one");
    await expect(palette.getByRole("option", { name: /Library \/one.*Switch tab/ })).toBeVisible();
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(address).toHaveValue(`${origin}/one`);
    await expect(chrome.getByRole("tab")).toHaveCount(2);

    await chrome.getByRole("button", { name: "Command palette", exact: true }).click();
    await input.fill(`${origin}/updated`);
    await input.press("Enter");
    await expect(address).toHaveValue(`${origin}/updated`);
    await expect(chrome.getByRole("tab", { name: "Library /updated" })).toBeVisible();
    await expect(chrome.getByRole("tab", { name: "Library /two" })).toBeVisible();
    await expect(chrome.getByRole("tab")).toHaveCount(2);
    await chrome.getByRole("button", { name: "Command palette", exact: true }).click();
    expect(
      await palette.evaluate(() =>
        window.browser!.updateSettings({ theme: "light" }).then(
          () => false,
          () => true,
        ),
      ),
    ).toBe(true);
    await input.fill("> light");
    await input.press("Enter");
    await expect(chrome.locator("html")).toHaveAttribute("data-theme", "light");
    await chrome.getByRole("button", { name: "Command palette", exact: true }).click();
    await expect(palette.locator("html")).toHaveAttribute("data-theme", "light");
    await input.fill("> dark");
    await input.press("Enter");
    await expect(chrome.locator("html")).toHaveAttribute("data-theme", "dark");
    await chrome.getByRole("button", { name: "Command palette", exact: true }).click();
    await expect(palette.locator("html")).toHaveAttribute("data-theme", "dark");
    await input.fill("> no-such-command");
    await expect(palette.getByText("No matching commands.")).toBeVisible();
    await input.fill("javascript:alert(1)");
    await input.press("Enter");
    await expect(palette.getByRole("alert")).toContainText("Only HTTP and HTTPS");
    await expect(input).toBeVisible();
    await input.fill(`${origin}/three`);
    await input.press("Shift+Enter");
    await expect(chrome.getByRole("tab", { name: "Library /three" })).toBeVisible();
    await expect(chrome.getByRole("tab")).toHaveCount(3);
    await chrome.getByRole("button", { name: "Command palette", exact: true }).click();
    await input.fill("> settings");
    await input.press("Enter");
    await expect(chrome.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await chrome.getByRole("button", { name: "Command palette", exact: true }).click();
    await palette.mouse.click(10, 10);
    await expect
      .poll(() => chrome.evaluate(async () => (await window.browser!.getState()).palette))
      .toBeNull();
    await expect(chrome.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await chrome.getByRole("button", { name: "Back to browsing" }).click();
    await chrome.getByRole("button", { name: "Command palette", exact: true }).click();
    await input.fill("");
    // Verify native transparency, not just CSS, so the websites remain visible underneath.
    const backdropAlpha = await app.evaluate(async ({ webContents }) => {
      const contents = webContents
        .getAllWebContents()
        .find((page) => page.getURL().endsWith("#palette"))!;
      const image = await contents.capturePage();
      return image.toBitmap()[3];
    });
    expect(backdropAlpha).toBeGreaterThan(0);
    expect(backdropAlpha).toBeLessThan(255);
    await palette.screenshot({ path: test.info().outputPath("command-palette.png") });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(640, 420),
    );
    await expect.poll(() => palette.evaluate(() => innerWidth)).toBe(640);
    const panel = (await palette.getByRole("dialog", { name: "Command palette" }).boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.y + panel.height).toBeLessThanOrEqual(420);
    expect(panel.x + panel.width).toBeLessThanOrEqual(640);
    await input.press("Tab");
    await expect(input).toBeFocused();
    await input.press("Escape");
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});
