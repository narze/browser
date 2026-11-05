import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { peekLayout } from "../../shared/float-layout.js";

// A native click on a link in the page view whose URL is `url`. The pointer moves
// over the link first, and the click comes as soon as the page reports the link
// under the pointer, like a real click. Alt is held with native key events.
const clickLink = (app: ElectronApplication, url: string, selector: string, alt = false) =>
  app.evaluate(
    async ({ webContents }, [url, selector, alt]) => {
      const page = webContents.getAllWebContents().find((c) => c.getURL() === url)!;
      const [x, y, href] = (await page.executeJavaScript(
        `(() => { const link = document.querySelector(${JSON.stringify(selector)}); const r = link.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2), link.href]; })()`,
      )) as [number, number, string];
      // Leave the link first: the page reports a link only when the pointer reaches it.
      page.sendInputEvent({ type: "mouseMove", x: 1, y: 1 });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const hovered = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`The page did not report ${href}.`)), 3000);
        const listener = (_event: unknown, target: string) => {
          if (target !== href) return;
          clearTimeout(timer);
          page.off("update-target-url", listener);
          resolve();
        };
        page.on("update-target-url", listener);
      });
      if (alt) page.sendInputEvent({ type: "keyDown", keyCode: "Alt" });
      page.sendInputEvent({ type: "mouseMove", x, y });
      await hovered;
      for (const type of ["mouseDown", "mouseUp"] as const)
        page.sendInputEvent({ type, x, y, button: "left", clickCount: 1 });
      if (alt) page.sendInputEvent({ type: "keyUp", keyCode: "Alt" });
    },
    [url, selector, alt] as const,
  );

const pageViews = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return {
      size: window.getContentSize(),
      views: window.contentView.children.map((view) => ({
        url: "webContents" in view ? (view.webContents as Electron.WebContents).getURL() : "",
        visible: view.getVisible(),
        bounds: view.getBounds(),
      })),
    };
  });

test("Alt+click and pinned tab links open a peek that closes or becomes a tab", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-peek-e2e-"));
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    const host = request.headers.host?.split(":")[0];
    if (host === "home.test")
      return response.end(
        `<title>Home ${request.url}</title><h1>Home ${request.url}</h1>
        <p><a id="away" href="http://away.test/page">Away link</a></p>
        <p><a id="same" href="/second">Same site link</a></p>`,
      );
    response.end(
      `<title>Away page</title><body style="background:#e8f0ff"><h1>Away ${request.url}</h1></body>`,
    );
  });
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
    app = await electron.launch({
      args: [
        ".",
        `--user-data-dir=${profile}`,
        `--host-resolver-rules=MAP *.test 127.0.0.1:${port}`,
      ],
      env,
    });
    const chrome = await app.firstWindow();
    const address = chrome.getByRole("textbox", { name: "Search or enter address" });
    await address.fill("http://home.test/");
    await address.press("Enter");
    const tabs = chrome.getByRole("tab");
    await expect(chrome.getByRole("tab", { name: "Home /" })).toBeVisible();
    const state = () => chrome.evaluate(() => window.browser!.getState());

    // Alt+click peeks at the link above the page, without a new tab.
    await clickLink(app, "http://home.test/", "#away", true);
    await expect.poll(async () => (await state()).peek?.url).toBe("http://away.test/page");
    await expect.poll(async () => (await state()).peek?.title).toBe("Away page");
    await expect(tabs).toHaveCount(1);
    const frame = app
      .context()
      .pages()
      .find((page) => page.url().endsWith("#peek"))!;
    await expect(frame.getByRole("region", { name: "Peek" })).toContainText("Away page");
    await expect(frame.getByRole("region", { name: "Peek" })).toContainText("away.test");
    let stack = await pageViews(app);
    const [width, height] = stack.size;
    // The home page stays live below the frame; the peeked page is on top, in the card.
    expect(stack.views.filter((view) => view.visible).map((view) => view.url)).toEqual([
      "http://home.test/",
      expect.stringMatching(/#peek$/),
      "http://away.test/page",
    ]);
    expect(stack.views.at(-1)?.bounds).toEqual(peekLayout(width, height).page);

    // Escape in the peeked page closes the peek.
    await app.evaluate(({ webContents }) => {
      const page = webContents
        .getAllWebContents()
        .find((c) => c.getURL() === "http://away.test/page")!;
      page.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    });
    await expect.poll(async () => (await state()).peek).toBeNull();
    stack = await pageViews(app);
    expect(stack.views.filter((view) => view.visible).map((view) => view.url)).toEqual([
      "http://home.test/",
    ]);

    // A click outside the card closes it too.
    await clickLink(app, "http://home.test/", "#away", true);
    await expect.poll(async () => (await state()).peek?.title).toBe("Away page");
    await frame.mouse.click(8, 8);
    await expect.poll(async () => (await state()).peek).toBeNull();

    // "Open as tab" keeps the page as it is: no reload.
    await clickLink(app, "http://home.test/", "#away", true);
    await expect.poll(async () => (await state()).peek?.title).toBe("Away page");
    await app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .find((c) => c.getURL() === "http://away.test/page")!
        .executeJavaScript("window.peekMarker = 42"),
    );
    await frame.getByRole("button", { name: "Open as tab" }).click();
    await expect(tabs).toHaveCount(2);
    await expect(chrome.getByRole("tab", { name: "Away page" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      await app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .find((c) => c.getURL() === "http://away.test/page")!
          .executeJavaScript("window.peekMarker"),
      ),
    ).toBe(42);
    expect((await state()).peek).toBeNull();

    // In a pinned tab, a link to another site peeks; a link on the same site does not.
    const home = (await state()).tabs.find((tab) => tab.url === "http://home.test/")!;
    await chrome.evaluate((id) => window.browser!.moveTab(id, "pinned", null, 0), home.id);
    await chrome.getByRole("tab", { name: "Home /" }).click();
    await clickLink(app, "http://home.test/", "#away");
    await expect.poll(async () => (await state()).peek?.url).toBe("http://away.test/page");
    expect((await state()).tabs.find((tab) => tab.id === home.id)?.url).toBe("http://home.test/");
    await frame.getByRole("button", { name: "Close peek" }).click();
    await expect.poll(async () => (await state()).peek).toBeNull();
    await clickLink(app, "http://home.test/", "#same");
    await expect
      .poll(async () => (await state()).tabs.find((tab) => tab.id === home.id)?.url)
      .toBe("http://home.test/second");
    expect((await state()).peek).toBeNull();
  } finally {
    await app?.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
