import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const primary = process.platform === "darwin" ? "meta" : "control";

test("copy the page address with a toast, and reopen closed tabs with history (D2, D3)", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-copy-reopen-"));
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<title>Page ${request.url}</title>`);
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
  const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
  try {
    const chrome = await app.firstWindow();
    const state = () => chrome.evaluate(() => window.browser!.getState());
    const address = chrome.getByRole("textbox", { name: "Search or enter address" });
    const tab = (path: string) => chrome.getByRole("tab", { name: `Page ${path}` });
    // Native key events reach before-input-event like a real keypress; Playwright's do not.
    const press = (keyCode: string, modifiers: string[]) =>
      app.evaluate(
        ({ BrowserWindow, webContents }, { keyCode, modifiers }) => {
          const page = webContents
            .getAllWebContents()
            .find((c) => c.getURL().startsWith("http://") && c.isFocused());
          const contents = page ?? BrowserWindow.getAllWindows()[0].webContents;
          contents.focus();
          for (const type of ["keyDown", "keyUp"] as const)
            contents.sendInputEvent({ type, keyCode, modifiers: modifiers as never });
        },
        { keyCode, modifiers },
      );
    const go = async (path: string) => {
      await address.fill(origin + path);
      await address.press("Enter");
      await expect(tab(path)).toBeVisible();
    };
    const activeUrl = async () => {
      const current = await state();
      return current.tabs.find((entry) => entry.id === current.activeId)?.url;
    };
    await chrome.evaluate(() => window.browser!.setTabLayout("left"));

    // D2: the shortcut copies the address and shows a short toast in the address bar.
    await go("/a");
    const toast = chrome.getByRole("status").filter({ hasText: "Copied" });
    await press("C", [primary, "shift"]);
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(`${origin}/a`);
    await expect(toast).toBeVisible();
    await chrome.screenshot({ path: test.info().outputPath("copied-toast.png") });
    await expect(toast).toBeHidden({ timeout: 4000 });

    // Compact mode shows the toolbar while the toast shows.
    await chrome.evaluate(() => window.browser!.toggleCompactMode());
    await expect(address).toBeHidden();
    await app.evaluate(({ clipboard }) => clipboard.writeText(""));
    await press("C", [primary, "shift"]);
    await expect(toast).toBeVisible();
    await expect(address).toBeVisible();
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(`${origin}/a`);
    await expect(address).toBeHidden({ timeout: 4000 });
    await chrome.evaluate(() => window.browser!.toggleCompactMode());

    // D3: closed tabs reopen newest first, with their back/forward history.
    await go("/b");
    await expect.poll(async () => (await state()).tabs[0]?.canGoBack).toBe(true);
    await chrome.getByRole("button", { name: "New tab", exact: true }).click();
    await go("/c");
    await press("W", [primary]);
    await expect(tab("/c")).toBeHidden();
    await tab("/b").click();
    await press("W", [primary]);
    await expect(tab("/b")).toBeHidden();

    await press("T", [primary, "shift"]);
    await expect(tab("/b")).toBeVisible();
    await expect.poll(activeUrl).toBe(`${origin}/b`);
    await expect(chrome.getByRole("button", { name: "Back", exact: true })).toBeEnabled();
    await press("T", [primary, "shift"]);
    await expect(tab("/c")).toBeVisible();
    await expect.poll(activeUrl).toBe(`${origin}/c`);
    await expect.poll(async () => (await state()).archive).toEqual([]);

    // Back on the reopened tab goes to the page before the close.
    await tab("/b").click();
    await chrome.getByRole("button", { name: "Back", exact: true }).click();
    await expect(tab("/a")).toBeVisible();
    await expect(chrome.getByRole("button", { name: "Forward", exact: true })).toBeEnabled();

    // A closed tab reopens in the space it came from.
    const spaces = chrome.getByRole("navigation", { name: "Spaces" });
    await spaces.getByRole("button", { name: "New space" }).click();
    await chrome.getByRole("textbox", { name: "Space name" }).fill("Work");
    await chrome.getByRole("textbox", { name: "Space name" }).press("Enter");
    await go("/w");
    await chrome.getByRole("button", { name: "New tab", exact: true }).click();
    await go("/w2");
    await press("W", [primary]);
    await spaces.getByRole("button", { name: "Personal" }).click();
    await expect(tab("/w")).toBeHidden();
    await press("T", [primary, "shift"]);
    await expect(spaces.getByRole("button", { name: "Work" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(tab("/w2")).toBeVisible();
    await expect.poll(activeUrl).toBe(`${origin}/w2`);
  } finally {
    await app.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
