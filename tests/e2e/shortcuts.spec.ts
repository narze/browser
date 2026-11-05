import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mac = process.platform === "darwin";
const primary = mac ? "meta" : "control";
const label = (macLabel: string, otherLabel: string) => (mac ? macLabel : otherLabel);

test("keyboard shortcuts can be changed, removed, reset, and persist", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-shortcuts-"));
  const server = createServer((req, res) => res.end(`<title>Page ${req.url}</title>`));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined && !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(key),
    ),
  ) as Record<string, string>;
  const launch = () => electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
  let app: ElectronApplication | undefined = await launch();
  // Native key events reach before-input-event like a real keypress; Playwright's do not.
  const press = (target: "chrome" | "page", keyCode: string, modifiers: string[] = []) =>
    app!.evaluate(
      ({ BrowserWindow, webContents }, { target, keyCode, modifiers }) => {
        const contents =
          target === "chrome"
            ? BrowserWindow.getAllWindows()[0].webContents
            : webContents.getAllWebContents().find((c) => c.getURL().startsWith("http://"))!;
        contents.focus();
        for (const type of ["keyDown", "keyUp"] as const)
          contents.sendInputEvent({ type, keyCode, modifiers: modifiers as never });
      },
      { target, keyCode, modifiers },
    );
  try {
    let chrome = await app.firstWindow();
    const tabs = chrome.getByRole("tab");
    const key = (id: string) => chrome.locator(`#shortcut-key-${id}`);
    const address = chrome.getByRole("textbox", { name: "Search or enter address" });
    await address.fill(`${origin}/a`);
    await address.press("Enter");
    await expect(chrome.getByRole("tab", { name: "Page /a" })).toBeVisible();

    // Default: the new-tab shortcut works from inside a website.
    await press("page", "T", [primary]);
    await expect(tabs).toHaveCount(2);

    // New default actions work from inside a website.
    const state = () => chrome.evaluate(() => window.browser!.getState());
    await chrome.getByRole("tab", { name: "Page /a" }).click();
    await press("page", "C", [primary, "shift"]);
    await expect
      .poll(() => app!.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(`${origin}/a`);
    await press("page", "D", [primary]);
    await expect
      .poll(async () => (await state()).tabs.find((tab) => tab.url.endsWith("/a"))?.zone)
      .toBe("pinned");
    await press("page", "D", [primary]);
    await expect
      .poll(async () => (await state()).tabs.find((tab) => tab.url.endsWith("/a"))?.zone)
      .toBe("today");
    await press("page", "=", ["control", "shift"]);
    await expect.poll(async () => !!(await state()).split).toBe(true);
    await press("page", "=", ["control", "shift"]);
    await expect.poll(async () => !!(await state()).split).toBe(false);
    await press("page", "W", [primary]);
    await expect(tabs).toHaveCount(1);
    await press("chrome", "T", [primary, "shift"]);
    await expect(chrome.getByRole("tab", { name: "Page /a" })).toBeVisible();
    await expect(tabs).toHaveCount(2);

    await chrome.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(chrome.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
    const newTabKey = key("newTab");
    await expect(newTabKey).toHaveAccessibleName(`New tab ${label("⌘T", "Ctrl+T")}`);
    await expect(chrome.getByRole("button", { name: "Reset all shortcuts" })).toBeDisabled();

    await chrome.getByRole("searchbox", { name: "Search shortcuts" }).fill("reopen");
    await expect(chrome.locator(".shortcut-row")).toHaveCount(1);
    await expect(chrome.locator(".shortcut-row")).toContainText("Reopen closed tab");
    await chrome
      .getByRole("searchbox", { name: "Search shortcuts" })
      .fill(label("⇧⌘A", "Ctrl+Shift+A"));
    await expect(chrome.locator(".shortcut-row")).toHaveText([/Archive/]);
    await chrome.getByRole("searchbox", { name: "Search shortcuts" }).fill("");

    // Record a new shortcut for "New tab".
    await newTabKey.click();
    await expect(newTabKey).toHaveText("Type shortcut…");
    await press("chrome", "Y", [primary, "alt"]);
    await expect(newTabKey).toHaveAccessibleName(`New tab ${label("⌥⌘Y", "Ctrl+Alt+Y")}`);
    await expect(chrome.getByRole("list", { name: "Customized shortcuts" })).toContainText(
      "New tab",
    );
    await expect(chrome.getByRole("region", { name: "Settings" }).getByRole("status")).toHaveText(
      "Saved.",
    );

    // A shortcut that another action uses is rejected.
    const reloadKey = key("reload");
    await reloadKey.click();
    await press("chrome", "W", [primary]);
    await expect(chrome.getByRole("alert")).toHaveText(
      `${label("⌘W", "Ctrl+W")} is already used by “Close tab”.`,
    );
    await expect(reloadKey).toHaveAccessibleName(`Reload page ${label("⌘R", "Ctrl+R")}`);

    // Delete removes a shortcut; Escape cancels recording without closing settings.
    await reloadKey.click();
    await press("chrome", "Backspace");
    await expect(reloadKey).toHaveAccessibleName("Reload page None");
    const closeKey = key("closeTab");
    await closeKey.click();
    await press("chrome", "Escape");
    await expect(closeKey).toHaveAccessibleName(`Close tab ${label("⌘W", "Ctrl+W")}`);
    await expect(chrome.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await chrome.screenshot({ path: test.info().outputPath("shortcuts.png") });

    await chrome.getByRole("button", { name: "Back to browsing" }).click();
    await chrome.getByRole("tab", { name: "Page /a" }).click();
    await press("page", "T", [primary]);
    await press("page", "Y", [primary, "alt"]);
    await expect(tabs).toHaveCount(3);
    const accelerator = await app.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu()!.items.find((item) => item.label === "File")!;
      return file.submenu!.items.find((item) => item.label === "New tab")!.accelerator;
    });
    expect(accelerator).toBe(mac ? "Alt+Cmd+Y" : "Ctrl+Alt+Y");
    const saved = JSON.parse(await readFile(join(profile, "settings.json"), "utf8"));
    expect(saved.shortcuts).toEqual({ newTab: mac ? "Alt+Cmd+Y" : "Ctrl+Alt+Y", reload: "" });

    await app.close();
    app = await launch();
    chrome = await app.firstWindow();
    await chrome.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      chrome.getByRole("button", { name: `New tab ${label("⌥⌘Y", "Ctrl+Alt+Y")}` }),
    ).toBeVisible();
    await chrome.getByRole("button", { name: "Reset Reload page shortcut" }).click();
    await expect(
      chrome.getByRole("button", { name: `Reload page ${label("⌘R", "Ctrl+R")}` }),
    ).toBeVisible();
    await chrome.getByRole("button", { name: "Reset all shortcuts" }).click();
    await expect(
      chrome.getByRole("button", { name: `New tab ${label("⌘T", "Ctrl+T")}` }),
    ).toBeVisible();
    await expect(chrome.getByRole("list", { name: "Customized shortcuts" })).toHaveCount(0);
  } finally {
    await app?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});
