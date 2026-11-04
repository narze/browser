import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("number shortcuts follow split segments from chrome and native pages", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-architecture-"));
  const server = createServer((req, res) => res.end(`<title>Page ${req.url}</title>`));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined && !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(key),
    ),
  ) as Record<string, string>;
  const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
  try {
    const chrome = await app.firstWindow();
    const address = chrome.getByRole("textbox", { name: "Search or enter address" });
    for (const page of ["a", "b", "c"]) {
      if (page !== "a") await chrome.getByRole("button", { name: "New tab", exact: true }).click();
      await address.fill(`${origin}/${page}`);
      await address.press("Enter");
      await expect(chrome.getByRole("tab", { name: `Page /${page}` })).toBeVisible();
    }
    await chrome.getByRole("button", { name: "Split tabs", exact: true }).click();
    await expect(chrome.getByRole("tab")).toHaveText(["Page /c", "Page /a", "Page /b"]);
    await address.focus();
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await chrome.keyboard.press(`${modifier}+1`);
    await expect(address).toHaveValue(`${origin}/c`);
    await app.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((c) => c.getURL().endsWith("/a"))!;
      page.focus();
      for (const type of ["keyDown", "keyUp"] as const)
        page.sendInputEvent({
          type,
          keyCode: "1",
          modifiers: [process.platform === "darwin" ? "meta" : "control"],
        });
    });
    await expect(address).toHaveValue(`${origin}/c`);
    await address.focus();
    await chrome.keyboard.press("Control+Tab");
    await expect(address).toHaveValue(`${origin}/a`);
    await address.focus();
    await chrome.keyboard.press("Control+Shift+Tab");
    await expect(address).toHaveValue(`${origin}/c`);
    await address.focus();
    await chrome.keyboard.press(`${modifier}+9`);
    await expect(address).toHaveValue(`${origin}/b`);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});
