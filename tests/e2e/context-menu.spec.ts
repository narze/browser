import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("website right clicks show native menus and act on the clicked page", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<title>Context menu fixture</title>
      <p id="plain">Page text</p><a id="link" href="/next">Next page</a>
      <input id="edit" value="Editable text">
      <img id="image" alt="Test image" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3XcAAAAASUVORK5CYII=">
      <p id="custom" oncontextmenu="event.preventDefault(); this.textContent = 'Custom menu'">Custom</p>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await mkdtemp(join(tmpdir(), "browser-context-menu-"));
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
    await chrome.getByRole("textbox", { name: "Search or enter address" }).fill(origin);
    await chrome.getByRole("textbox", { name: "Search or enter address" }).press("Enter");
    await expect(chrome.getByRole("tab", { name: "Context menu fixture" })).toBeVisible();
    // Observe real native menu popups, keeping the Menu for invoking its actions.
    await app.evaluate(({ Menu, webContents }) => {
      for (const page of webContents.getAllWebContents()) {
        page.on("context-menu", () => {
          (globalThis as any).rightClickReceived = true;
        });
      }
      const popup = Menu.prototype.popup;
      Menu.prototype.popup = function (options) {
        (globalThis as any).contextMenu = this;
        (globalThis as any).contextHost = options?.window?.id;
        popup.call(this, options);
      };
    });
    const rightClick = async (selector: string, url = origin + "/") => {
      await app.evaluate(
        async ({ webContents }, { url, selector }) => {
          (globalThis as any).contextMenu = null;
          const page = webContents.getAllWebContents().find((c) => c.getURL() === url)!;
          const point = await page.executeJavaScript(`(() => {
          const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
          return {x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2)};
        })()`);
          page.focus();
          page.sendInputEvent({ type: "mouseDown", button: "right", clickCount: 1, ...point });
          page.sendInputEvent({ type: "mouseUp", button: "right", clickCount: 1, ...point });
        },
        { url, selector },
      );
    };
    const labels = () =>
      app.evaluate(
        () => (globalThis as any).contextMenu?.items.map((item: any) => item.label) ?? [],
      );
    const dismiss = () => app.evaluate(() => (globalThis as any).contextMenu?.closePopup());
    const click = (label: string) =>
      app.evaluate((_, label) => {
        const menu = (globalThis as any).contextMenu;
        menu.closePopup();
        const item = menu.items.find((entry: any) => entry.label === label);
        if (!item?.enabled) throw new Error(`Missing or disabled menu action: ${label}`);
        item.click();
      }, label);

    await rightClick("#plain");
    await expect.poll(() => app.evaluate(() => (globalThis as any).rightClickReceived)).toBe(true);
    await expect.poll(labels).toContain("Reload");
    await dismiss();
    await rightClick("#link");
    await expect.poll(labels).toContain("Open Link in New Tab");
    await click("Copy Link Address");
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(origin + "/next");
    await rightClick("#link");
    await expect.poll(labels).toContain("Open Link in New Tab");
    await click("Open Link in New Tab");
    await expect(chrome.getByRole("tab")).toHaveCount(2);
    await chrome.getByRole("tab").first().click();

    await app.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find((c) => c.getURL() === origin + "/")!;
      await page.executeJavaScript(`document.querySelector('#edit').select()`);
    }, origin);
    await rightClick("#edit");
    await expect.poll(labels).toContain("Paste");
    await click("Copy");
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe("Editable text");
    await app.evaluate(({ clipboard }) => clipboard.writeText("Pasted text"));
    await rightClick("#edit");
    await expect.poll(labels).toContain("Paste");
    await click("Paste");
    await expect
      .poll(() =>
        app.evaluate(
          ({ webContents }, origin) =>
            webContents
              .getAllWebContents()
              .find((c) => c.getURL() === origin + "/")!
              .executeJavaScript(`document.querySelector('#edit').value`),
          origin,
        ),
      )
      .toBe("Pasted text");
    await rightClick("#image");
    await expect.poll(labels).toContain("Copy Image");
    await click("Copy Image");
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.has("image/png"))).toBe(true);
    await rightClick("#custom");
    await expect
      .poll(() =>
        app.evaluate(
          ({ webContents }, origin) =>
            webContents
              .getAllWebContents()
              .find((c) => c.getURL() === origin + "/")!
              .executeJavaScript(`document.querySelector('#custom').textContent`),
          origin,
        ),
      )
      .toBe("Custom menu");
    expect(await labels()).toEqual([]);

    // A quick window's native menu belongs to that window, not the main chrome.
    await chrome.evaluate(async (url) => {
      await window.browser!.openQuickWindow();
      await window.browser!.navigateQuickWindow(url);
    }, origin + "/quick");
    await expect
      .poll(() =>
        app.evaluate(
          ({ webContents }, url) =>
            webContents.getAllWebContents().some((c) => c.getURL() === url && !c.isLoading()),
          origin + "/quick",
        ),
      )
      .toBe(true);
    await rightClick("#link", origin + "/quick");
    await expect.poll(labels).toContain("Copy Link Address");
    expect(
      await app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith("#mini"))!
            .id,
      ),
    ).toBe(await app.evaluate(() => (globalThis as any).contextHost));
    await click("Copy Link Address");
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(origin + "/next");
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});
