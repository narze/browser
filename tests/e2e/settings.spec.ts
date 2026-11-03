import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("settings preserve the current page and persist across launches", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-settings-e2e-"));
  const server = createServer((_request, response) =>
    response.end("<title>Settings fixture</title><h1>Page kept open</h1>"),
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
  const launch = () => electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
  try {
    app = await launch();
    let chrome = await app.firstWindow();
    await chrome
      .getByRole("textbox", { name: "Search or enter address" })
      .fill(`http://127.0.0.1:${port}`);
    await chrome.getByRole("textbox", { name: "Search or enter address" }).press("Enter");
    await expect(chrome.getByRole("tab", { name: "Settings fixture" })).toBeVisible();
    await app.evaluate(({ webContents }) => {
      const page = webContents
        .getAllWebContents()
        .find((c) => c.getURL().startsWith("http://127.0.0.1:"))!;
      return page.executeJavaScript("window.settingsMarker = 42");
    });
    await chrome.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(chrome.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].contentView.children.at(-1)!.getVisible(),
      ),
    ).toBe(false);
    await chrome.getByRole("radio", { name: "Right", exact: true }).check();
    await expect(chrome.getByRole("combobox", { name: "Tab layout" })).toHaveValue("right");
    await chrome.getByLabel("Search engine").selectOption("google");
    await chrome.getByRole("checkbox", { name: /New-tab shortcuts/ }).uncheck();
    await expect(chrome.getByRole("status")).toHaveText("Saved.");
    await chrome.screenshot({ path: test.info().outputPath("settings.png") });
    await chrome.getByRole("button", { name: "Back to browsing" }).click();
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].contentView.children.at(-1)!.getVisible(),
      ),
    ).toBe(true);
    expect(
      await app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .find((c) => c.getURL().startsWith("http://127.0.0.1:"))!
          .executeJavaScript("window.settingsMarker"),
      ),
    ).toBe(42);
    await chrome.getByRole("button", { name: "New tab", exact: true }).click();
    await expect(chrome.getByRole("heading", { name: "Where to next?" })).toBeVisible();
    await expect(chrome.getByRole("button", { name: /GitHub/ })).toHaveCount(0);
    await app.close();
    app = undefined;
    app = await launch();
    chrome = await app.firstWindow();
    await expect(chrome.getByRole("combobox", { name: "Tab layout" })).toHaveValue("right");
    await chrome.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(chrome.getByLabel("Search engine")).toHaveValue("google");
    await expect(chrome.getByRole("checkbox", { name: /New-tab shortcuts/ })).not.toBeChecked();
    await chrome.keyboard.press("Escape");
    await expect(chrome.getByRole("heading", { name: "Settings", exact: true })).toHaveCount(0);
  } finally {
    await app?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});
