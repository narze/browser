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
  // Let Electron control media queries instead of Playwright's default light emulation.
  const launch = () =>
    electron.launch({ args: [".", `--user-data-dir=${profile}`], env, colorScheme: null });
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
    await expect(chrome.getByLabel("Theme", { exact: true })).toHaveValue("system");
    await chrome.getByLabel("Theme", { exact: true }).selectOption("dark");
    await expect(chrome.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(chrome.locator(".chrome")).toHaveCSS("background-color", "rgb(25, 31, 42)");
    expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe("dark");
    await expect
      .poll(() =>
        app!.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .find((c) => c.getURL().startsWith("http://127.0.0.1:"))!
            .executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches"),
        ),
      )
      .toBe(true);

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
    await expect(chrome.locator("html")).toHaveCSS("color-scheme", "dark");
    await chrome.getByRole("button", { name: "Split tabs", exact: true }).click();
    await expect(chrome.locator(".split-pane").first()).toHaveCSS(
      "background-color",
      "rgb(18, 23, 34)",
    );
    await expect(chrome.locator(".pane-toolbar").first()).toHaveCSS("color", "rgb(226, 231, 240)");
    await chrome.getByRole("button", { name: "Exit split view", exact: true }).click();

    await app.close();
    app = undefined;
    app = await launch();
    chrome = await app.firstWindow();
    await expect(chrome.getByRole("combobox", { name: "Tab layout" })).toHaveValue("right");
    await chrome.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(chrome.getByLabel("Search engine")).toHaveValue("google");
    await expect(chrome.getByLabel("Theme", { exact: true })).toHaveValue("dark");
    await expect(chrome.locator("html")).toHaveAttribute("data-theme", "dark");
    await chrome.getByLabel("Theme", { exact: true }).selectOption("light");
    await expect(chrome.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(chrome.locator(".chrome")).toHaveCSS("background-color", "rgb(232, 236, 242)");
    await chrome.getByLabel("Theme", { exact: true }).selectOption("system");
    await expect
      .poll(() => app!.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
      .toBe("system");
    const systemTheme = await app.evaluate(({ nativeTheme }) =>
      nativeTheme.shouldUseDarkColors ? "dark" : "light",
    );
    await expect(chrome.locator("html")).toHaveAttribute("data-theme", systemTheme);
    // Trigger Electron's native theme update path without changing the user's OS preferences.
    const changedTheme = systemTheme === "dark" ? "light" : "dark";
    await app.evaluate(({ nativeTheme }, theme: "light" | "dark") => {
      nativeTheme.themeSource = theme;
    }, changedTheme);
    await expect(chrome.locator("html")).toHaveAttribute("data-theme", changedTheme);
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "system";
    });
    await expect(chrome.locator("html")).toHaveAttribute("data-theme", systemTheme);

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
