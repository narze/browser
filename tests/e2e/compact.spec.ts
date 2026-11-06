import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const primary = process.platform === "darwin" ? "meta" : "control";

// Native key events reach before-input-event like a real keypress; Playwright's do not.
const pressOnPage = (app: ElectronApplication, shift: boolean) =>
  app.evaluate(
    ({ webContents }, [modifier, shift]) => {
      const page = webContents
        .getAllWebContents()
        .find((c) => c.getURL().startsWith("http://127.0.0.1:"))!;
      page.focus();
      const modifiers = (shift ? [modifier, "shift"] : [modifier]) as never[];
      for (const type of ["keyDown", "keyUp"] as const)
        page.sendInputEvent({ type, keyCode: "S", modifiers });
    },
    [primary, shift] as const,
  );
const toggleCompact = (app: ElectronApplication) => pressOnPage(app, true);
const toggleTabs = (app: ElectronApplication) => pressOnPage(app, false);

// A native pointer move over the page view, in page coordinates.
const pointAt = (app: ElectronApplication, x: number, y: number) =>
  app.evaluate(
    ({ webContents }, [x, y]) =>
      webContents
        .getAllWebContents()
        .find((c) => c.getURL().startsWith("http://127.0.0.1:"))!
        .sendInputEvent({ type: "mouseMove", x, y }),
    [x, y],
  );

const pageBounds = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow, webContents }) => {
    const page = webContents
      .getAllWebContents()
      .find((c) => c.getURL().startsWith("http://127.0.0.1:"))!;
    const window = BrowserWindow.getAllWindows()[0];
    const view = window.contentView.children.find(
      (child) => "webContents" in child && child.webContents === page,
    )!;
    const [windowWidth, windowHeight] = window.getContentSize();
    return { ...view.getBounds(), windowWidth, windowHeight };
  });

test("compact mode hides the toolbar and tabs until the pointer reaches the window edge", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-compact-e2e-"));
  const server = createServer((_request, response) =>
    response.end("<title>Compact fixture</title><h1>Full window page</h1>"),
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
    const tab = chrome.getByRole("tab", { name: "Compact fixture" });
    await expect(tab).toBeVisible();
    await expect.poll(async () => (await pageBounds(app!)).y).toBeGreaterThan(50);
    const chromeHeight = (await pageBounds(app)).y;

    await toggleCompact(app);
    await expect(tab).toBeHidden();
    await expect(address).toBeHidden();
    await expect.poll(() => pageBounds(app!)).toMatchObject({ x: 0, y: 0 });
    let bounds = await pageBounds(app);
    expect(bounds.width).toBe(bounds.windowWidth);
    expect(bounds.height).toBe(bounds.windowHeight);
    await chrome.screenshot({ path: test.info().outputPath("compact-hidden.png") });

    // The top edge reveals the toolbar; the page moves below it.
    await pointAt(app, 400, 0);
    await expect(tab).toBeVisible();
    await expect.poll(async () => (await pageBounds(app!)).y).toBe(chromeHeight);
    await chrome.screenshot({ path: test.info().outputPath("compact-revealed.png") });
    // Pointing back into the page hides it again.
    await pointAt(app, 400, 300);
    await expect(tab).toBeHidden();
    await expect.poll(async () => (await pageBounds(app!)).y).toBe(0);

    // Side tabs come back from their own edge.
    await chrome.evaluate(() => window.browser!.setTabLayout("left"));
    await expect(tab).toBeHidden();
    await expect.poll(() => pageBounds(app!)).toMatchObject({ x: 0, y: 0 });
    await pointAt(app, 0, 400);
    await expect(tab).toBeVisible();
    await expect.poll(async () => (await pageBounds(app!)).x).toBeGreaterThan(100);
    await pointAt(app, 400, 400);
    await expect(tab).toBeHidden();
    await expect.poll(async () => (await pageBounds(app!)).x).toBe(0);
    // The opposite edge does nothing.
    bounds = await pageBounds(app);
    await pointAt(app, bounds.width - 1, 400);
    await expect(tab).toBeHidden();

    expect((await chrome.evaluate(() => window.browser!.getState())).settings.compactMode).toBe(
      true,
    );
    await toggleCompact(app);
    await expect(tab).toBeVisible();
    await expect(address).toBeVisible();
    await expect.poll(async () => (await pageBounds(app!)).x).toBeGreaterThan(100);
    await pointAt(app, 400, 400);
    await expect(tab).toBeVisible();
  } finally {
    await app?.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("compact mode keeps the tabs on screen after Cmd+S, and hides only the toolbar", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-compact-tabs-e2e-"));
  const server = createServer((_request, response) =>
    response.end("<title>Kept tabs fixture</title><h1>Page</h1>"),
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
    const tab = chrome.getByRole("tab", { name: "Kept tabs fixture" });
    await expect(tab).toBeVisible();
    await expect.poll(async () => (await pageBounds(app!)).y).toBeGreaterThan(50);
    const chromeHeight = (await pageBounds(app)).y;

    await toggleCompact(app);
    await expect(tab).toBeHidden();
    await expect.poll(() => pageBounds(app!)).toMatchObject({ x: 0, y: 0 });

    // Top tabs: the tab row stays, the toolbar hides.
    await toggleTabs(app);
    await expect(tab).toBeVisible();
    await expect(address).toBeHidden();
    await expect.poll(async () => (await pageBounds(app!)).y).toBe(46);
    await chrome.screenshot({ path: test.info().outputPath("compact-tabs-top.png") });
    // The top edge still brings the toolbar back.
    await pointAt(app, 400, 300);
    await chrome.mouse.move(400, 1);
    await expect(address).toBeVisible();
    await expect.poll(async () => (await pageBounds(app!)).y).toBe(chromeHeight);
    await pointAt(app, 400, 300);
    await expect(address).toBeHidden();
    await expect(tab).toBeVisible();

    // Side tabs: the sidebar reaches the top of the window, the page fills the rest.
    await chrome.evaluate(() => window.browser!.setTabLayout("left"));
    await expect(tab).toBeVisible();
    await expect(address).toBeHidden();
    await expect.poll(async () => (await pageBounds(app!)).y).toBe(0);
    expect((await pageBounds(app)).x).toBeGreaterThan(100);
    await chrome.screenshot({ path: test.info().outputPath("compact-tabs-left.png") });

    // Cmd+S again hides the tabs with the toolbar.
    await toggleTabs(app);
    await expect(tab).toBeHidden();
    await expect.poll(() => pageBounds(app!)).toMatchObject({ x: 0, y: 0 });
    const settings = (await chrome.evaluate(() => window.browser!.getState())).settings;
    expect(settings).toMatchObject({ compactMode: true, compactTabs: false, sidebarVisible: true });

    // A hidden sidebar still comes back from the edge in compact mode.
    await toggleCompact(app);
    await expect(tab).toBeVisible();
    await toggleTabs(app);
    await expect(tab).toBeHidden();
    await toggleCompact(app);
    await pointAt(app, 0, 400);
    await expect(tab).toBeVisible();
    await expect(address).toBeVisible();
  } finally {
    await app?.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
