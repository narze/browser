import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";

test("links and second launches wait for extension restoration before opening windows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-startup-e2e-"));
  const bootstrap = join(directory, "startup.cjs");
  const url = "http://127.0.0.1:1/during-startup";
  // Deliver OS events inside the asynchronous restore boundary, before any UI exists.
  await writeFile(
    bootstrap,
    `
    const { app, BrowserWindow } = require('electron');
    const extensions = require(${JSON.stringify(join(process.cwd(), "electron/extensions.cjs"))});
    const create = extensions.createExtensionManager;
    extensions.createExtensionManager = (...args) => {
      const manager = create(...args);
      const restore = manager.restore;
      manager.restore = async (...args) => {
        app.emit('second-instance', {}, ['electron', '.']);
        app.emit('open-url', { preventDefault() {} }, ${JSON.stringify(url)});
        globalThis.startupWindowCount = BrowserWindow.getAllWindows().length;
        return restore(...args);
      };
      return manager;
    };
    require(${JSON.stringify(join(process.cwd(), "electron/main.cjs"))});
  `,
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(entry[0]),
    ),
  );
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [bootstrap, `--user-data-dir=${join(directory, "profile")}`],
      env,
    });
    await expect.poll(() => app!.evaluate(() => (globalThis as any).startupWindowCount)).toBe(0);
    await expect
      .poll(() =>
        app!.windows().some((page) => page.url().startsWith("file:") && !page.url().includes("#")),
      )
      .toBe(true);
    const chrome = app
      .windows()
      .find((page) => page.url().startsWith("file:") && !page.url().includes("#"))!;
    await expect
      .poll(async () => (await chrome.evaluate(() => window.browser!.getState())).mini?.url)
      .toBe(url);
    expect(await windowCount(app)).toBe(2);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

const primary = process.platform === "darwin" ? "meta" : "control";

// Native keys reach before-input-event like a real keypress; Playwright's do not.
const pressIn = (app: ElectronApplication, url: string, keyCode: string, modifiers: string[]) =>
  app.evaluate(
    ({ webContents }, [url, keyCode, modifiers]) => {
      const page = webContents.getAllWebContents().find((c) => c.getURL().startsWith(url))!;
      page.focus();
      for (const type of ["keyDown", "keyUp"] as const)
        page.sendInputEvent({ type, keyCode, modifiers: modifiers as never[] });
    },
    [url, keyCode, modifiers] as const,
  );

const windowCount = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
const quickPage = (app: ElectronApplication) =>
  app
    .context()
    .pages()
    .find((page) => page.url().endsWith("#mini"));

test("the quick window opens links from other apps and moves its page into a tab", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-quick-e2e-"));
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<title>Quick ${request.url}</title><h1>Quick ${request.url}</h1>`);
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
  let app: ElectronApplication | undefined;
  try {
    // A link that opens the app shows in the quick window, above the main window.
    app = await electron.launch({
      args: [".", `--user-data-dir=${profile}`, `${origin}/from-app`],
      env,
    });
    // The quick window opens at launch too, so find the main window by its address.
    const isChrome = (url: string) => url.startsWith("file:") && !url.includes("#");
    await expect.poll(() => app!.windows().some((page) => isChrome(page.url()))).toBe(true);
    const chrome = app.windows().find((page) => isChrome(page.url()))!;
    const state = () => chrome.evaluate(() => window.browser!.getState());
    await expect.poll(() => windowCount(app!)).toBe(2);
    await expect.poll(() => quickPage(app!)).toBeTruthy();
    let quick = quickPage(app)!;
    const quickAddress = quick.getByRole("textbox", { name: "Search or enter address" });
    await expect(quickAddress).toHaveValue(`${origin}/from-app`);
    await expect.poll(async () => (await state()).mini?.title).toBe("Quick /from-app");
    expect((await state()).tabs).toHaveLength(1);
    const quickView = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((entry) =>
        entry.webContents.getURL().endsWith("#mini"),
      )!;
      const [view] = window.contentView.children;
      return {
        bounds: view.getBounds(),
        size: window.getContentSize(),
        visible: view.getVisible(),
      };
    });
    expect(quickView.visible).toBe(true);
    expect(quickView.bounds).toEqual({
      x: 0,
      y: 44,
      width: quickView.size[0],
      height: quickView.size[1] - 44,
    });

    // "Open in browser" moves the page, as it is, into the main window as a tab.
    await app.evaluate(({ webContents }, url) => {
      void webContents
        .getAllWebContents()
        .find((c) => c.getURL() === url)!
        .executeJavaScript("window.quickMarker = 7");
    }, `${origin}/from-app`);
    await quick.getByRole("button", { name: "Open in browser" }).click();
    await expect.poll(() => windowCount(app!)).toBe(1);
    await expect(chrome.getByRole("tab", { name: "Quick /from-app" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      await app.evaluate(
        ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .find((c) => c.getURL() === url)!
            .executeJavaScript("window.quickMarker"),
        `${origin}/from-app`,
      ),
    ).toBe(7);
    expect((await state()).mini).toBeNull();

    // The shortcut opens an empty quick window, ready to type in.
    await pressIn(app, `${origin}/from-app`, "N", [primary, "alt"]);
    await expect.poll(() => windowCount(app!)).toBe(2);
    await expect.poll(() => quickPage(app!)).toBeTruthy();
    quick = quickPage(app)!;
    await expect(quick.getByText("Look something up without leaving your tabs.")).toBeVisible();
    await expect(quick.getByRole("button", { name: "Open in browser" })).toBeDisabled();
    const address = quick.getByRole("textbox", { name: "Search or enter address" });
    await expect(address).toBeFocused();
    await address.fill(`${origin}/lookup`);
    await address.press("Enter");
    await expect.poll(async () => (await state()).mini?.title).toBe("Quick /lookup");
    await expect(address).toHaveValue(`${origin}/lookup`);

    // Close tab in the quick window closes the quick window, not a tab.
    await pressIn(app, `${origin}/lookup`, "W", [primary]);
    await expect.poll(() => windowCount(app!)).toBe(1);
    expect((await state()).mini).toBeNull();
    expect((await state()).tabs).toHaveLength(2);

    // A second launch with a link hands the link to this app and quits.
    const second = spawn(
      electronPath as unknown as string,
      [".", `--user-data-dir=${profile}`, `${origin}/second`],
      { env, stdio: "ignore" },
    );
    const exitCode = await new Promise<number | null>((resolve) => second.on("exit", resolve));
    expect(exitCode).toBe(0);
    await expect.poll(async () => (await state()).mini?.url).toBe(`${origin}/second`);
    await expect.poll(() => windowCount(app!)).toBe(2);

    // Closing the window from the system closes its page too.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((entry) => entry.webContents.getURL().endsWith("#mini"))!
        .close(),
    );
    await expect.poll(async () => (await state()).mini).toBeNull();
    expect(await windowCount(app)).toBe(1);
    expect(
      await app.evaluate(
        ({ webContents }, url) => webContents.getAllWebContents().some((c) => c.getURL() === url),
        `${origin}/second`,
      ),
    ).toBe(false);
  } finally {
    await app?.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
