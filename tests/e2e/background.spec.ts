import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// playwright.config.ts sets BROWSER_BACKGROUND=1, so local runs do not take focus
// from the person at the computer. BROWSER_BACKGROUND=0 shows the app as usual.
test("end-to-end runs keep the app in the background on macOS", async () => {
  test.skip(process.platform !== "darwin", "The background mode uses the macOS activation policy.");
  test.skip(process.env.BROWSER_BACKGROUND !== "1", "The background mode is off.");
  const profile = await mkdtemp(join(tmpdir(), "browser-background-e2e-"));
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
    await expect(chrome.getByRole("heading", { name: "Where to next?" })).toBeVisible();
    // The window is on screen, but the app never becomes active, so no window has focus.
    const state = () =>
      app.evaluate(({ BrowserWindow }) => ({
        visible: BrowserWindow.getAllWindows().some((window) => window.isVisible()),
        focused: BrowserWindow.getFocusedWindow() !== null,
      }));
    await expect.poll(state).toEqual({ visible: true, focused: false });
    // Focus calls in the app do not activate it either.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    expect(await state()).toEqual({ visible: true, focused: false });
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
