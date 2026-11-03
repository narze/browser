import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("real tabs, history, popups, isolation, and close-last-tab behavior", async () => {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      request.url === "/second"
        ? "<title>Second page</title><h1>Second page</h1>"
        : '<title>First page</title><h1>First page</h1><a href="/second">Next</a><a href="/second" target="_blank">Popup</a>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const userData = await mkdtemp(join(tmpdir(), "browser-test-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
    ),
  );
  const app = await electron.launch({ args: [".", `--user-data-dir=${userData}`], env });
  try {
    const chrome = await app.firstWindow();
    await expect(chrome.getByRole("heading", { name: "Where to next?" })).toBeVisible();
    const address = chrome.getByRole("textbox", { name: "Search or enter address" });
    await address.fill(`http://127.0.0.1:${port}`);
    await address.press("Enter");
    await expect(chrome.getByRole("tab", { name: "First page" })).toBeVisible();
    await expect
      .poll(() => chrome.evaluate(async () => (await window.browser!.getState()).tabs[0].loading))
      .toBe(false);
    // An iframe's pushState must never become the browser's top-level URL.
    await app.evaluate(async ({ webContents }) => {
      const page = webContents
        .getAllWebContents()
        .find((c) => c.getURL().startsWith("http://127.0.0.1:"))!;
      const navigation = new Promise<void>((resolve) =>
        page.once("did-navigate-in-page", () => resolve()),
      );
      await page.executeJavaScript(
        `new Promise(resolve => {
        const frame = document.createElement('iframe');
        frame.src = '/frame';
        frame.onload = () => { frame.contentWindow.history.pushState({}, '', '/frame?changed'); resolve(); };
        document.body.append(frame);
      })`,
        true,
      );
      await navigation;
    });
    await expect(address).toHaveValue(`http://127.0.0.1:${port}/`);
    await app.evaluate(({ webContents }) => {
      const page = webContents
        .getAllWebContents()
        .find((c) => c.getURL().startsWith("http://127.0.0.1:"))!;
      // Match a user's click so Chromium does not skip this history entry.
      return page.executeJavaScript('document.querySelector("a").click()', true);
    });
    await expect(chrome.getByRole("tab", { name: "Second page" })).toBeVisible();
    // Switching the tab rail must resize native web content without reloading it.
    const pageIdentity = await app.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((c) => c.getURL().endsWith("/second"))!;
      return page.executeJavaScript('window.layoutMarker = "kept"');
    });
    expect(pageIdentity).toBe("kept");
    for (const position of ["left", "right", "top"]) {
      await chrome.getByRole("combobox", { name: "Tab layout" }).selectOption(position);
      await expect(chrome.getByRole("tablist")).toHaveAttribute(
        "aria-orientation",
        position === "top" ? "horizontal" : "vertical",
      );
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setContentSize(900, 680);
      });
      await expect.poll(() => chrome.evaluate(() => innerWidth)).toBe(900);
      const main = await chrome.locator("main").boundingBox();
      const nativeBounds = await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        return win.contentView.children.at(-1)!.getBounds();
      });
      expect(nativeBounds).toEqual(main);
      const marker = await app.evaluate(({ webContents }) => {
        const page = webContents.getAllWebContents().find((c) => c.getURL().endsWith("/second"))!;
        return page.executeJavaScript("window.layoutMarker");
      });
      expect(marker).toBe("kept");
      await chrome.getByRole("button", { name: "New tab", exact: true }).click();
      await expect(chrome.getByRole("tab")).toHaveCount(2);
      await expect(chrome.getByRole("heading", { name: "Where to next?" })).toBeVisible();
      if (position !== "top")
        await chrome.screenshot({ path: test.info().outputPath(`tabs-${position}.png`) });
      await chrome.getByRole("tab", { name: "Second page" }).click();
      await expect(address).toHaveValue(`http://127.0.0.1:${port}/second`);
      await chrome.getByRole("button", { name: "Close tab: New tab", exact: true }).click();
      await expect(chrome.getByRole("tab")).toHaveCount(1);
    }
    await expect
      .poll(() => chrome.evaluate(async () => (await window.browser!.getState()).tabs[0].loading))
      .toBe(false);
    await chrome.getByRole("button", { name: "Back", exact: true }).click();
    await expect(chrome.getByRole("tab", { name: "First page" })).toBeVisible();
    await chrome.getByRole("button", { name: "Forward", exact: true }).click();
    await expect(chrome.getByRole("tab", { name: "Second page" })).toBeVisible();
    await chrome.getByRole("button", { name: "New tab", exact: true }).click();
    await expect(chrome.getByRole("tab")).toHaveCount(2);
    await expect(chrome.getByRole("heading", { name: "Where to next?" })).toBeVisible();
    await chrome.getByRole("tab", { name: "Second page" }).click();
    await expect(address).toHaveValue(`http://127.0.0.1:${port}/second`);
    const isolated = await app.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((c) => c.getURL().endsWith("/second"))!;
      return page.executeJavaScript(
        'typeof require === "undefined" && typeof window.browser === "undefined"',
      );
    });
    expect(isolated).toBe(true);
    await chrome.getByRole("button", { name: "Back", exact: true }).click();
    await expect(chrome.getByRole("tab", { name: "First page" })).toBeVisible();
    await app.evaluate(({ webContents }) => {
      const page = webContents
        .getAllWebContents()
        .find((c) => c.getURL().startsWith("http://127.0.0.1:"))!;
      return page.executeJavaScript('document.querySelectorAll("a")[1].click()');
    });
    await expect(chrome.getByRole("tab")).toHaveCount(3);
    await expect(chrome.getByRole("tab", { name: "Second page" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    for (let i = 0; i < 3; i++) {
      await chrome
        .getByRole("button", { name: /^Close tab:/ })
        .first()
        .click();
    }
    await expect(chrome.getByRole("tab")).toHaveCount(1);
    await expect(chrome.getByRole("heading", { name: "Where to next?" })).toBeVisible();
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(userData, { recursive: true, force: true });
  }
});
