import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const primary = process.platform === "darwin" ? "meta" : "control";
// Native key events reach before-input-event like a real keypress; Playwright's do not.
// Pressing on the web page proves the shortcut wins over the page's own Cmd+S.
const toggleSidebar = (app: ElectronApplication) =>
  app.evaluate(({ webContents }, modifier) => {
    const page = webContents
      .getAllWebContents()
      .find((c) => c.getURL().startsWith("http://127.0.0.1:"))!;
    page.focus();
    for (const type of ["keyDown", "keyUp"] as const)
      page.sendInputEvent({ type, keyCode: "S", modifiers: [modifier as never] });
  }, primary);

const pageBounds = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow, webContents }) => {
    const page = webContents
      .getAllWebContents()
      .find((c) => c.getURL().startsWith("http://127.0.0.1:"))!;
    return BrowserWindow.getAllWindows()[0]
      .contentView.children.find((view) => "webContents" in view && view.webContents === page)!
      .getBounds();
  });

test("the side tab sidebar toggles with its shortcut and gives the page full width", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-sidebar-e2e-"));
  const server = createServer((_request, response) =>
    response.end("<title>Sidebar fixture</title><h1>Wide page</h1>"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(entry[0]),
    ),
  );
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
    const chrome = await app.firstWindow();
    const address = chrome.getByRole("textbox", { name: "Search or enter address" });
    await address.fill(`http://127.0.0.1:${port}`);
    await address.press("Enter");
    const tab = chrome.getByRole("tab", { name: "Sidebar fixture" });
    await expect(tab).toBeVisible();

    // Top tabs have no sidebar, so the shortcut leaves the layout alone.
    await toggleSidebar(app);
    await expect(tab).toBeVisible();
    expect((await chrome.evaluate(() => window.browser!.getState())).settings.sidebarVisible).toBe(
      true,
    );

    await chrome.evaluate(() => window.browser!.setTabLayout("left"));
    await expect.poll(async () => (await pageBounds(app!)).x).toBeGreaterThan(100);
    const sidebarWidth = (await pageBounds(app)).x;

    await toggleSidebar(app);
    await expect(tab).toBeHidden();
    await expect(chrome.getByRole("separator", { name: "Resize tab sidebar" })).toHaveCount(0);
    await expect(chrome.getByRole("navigation", { name: "Spaces" })).toBeHidden();
    await expect.poll(async () => (await pageBounds(app!)).x).toBe(0);

    await toggleSidebar(app);
    await expect(tab).toBeVisible();
    await expect.poll(async () => (await pageBounds(app!)).x).toBe(sidebarWidth);

    // Moving tabs to the other side always reveals them again.
    await toggleSidebar(app);
    await expect(tab).toBeHidden();
    await chrome.evaluate(() => window.browser!.setTabLayout("right"));
    await expect(tab).toBeVisible();
  } finally {
    await app?.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
