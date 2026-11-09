import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// This uses the real store page and real Google download in an isolated profile.
// Opt in explicitly: BROWSER_LIVE_STORE=1 pnpm exec playwright test web-store.
for (const [slug, id] of [
  ["dark-reader", "eimadpbcbfnmbkopoojfekhnkhdbieeh"],
  ["browse", "mfnicocicmmlkpjnaffgihfjhdgjkdjg"],
]) {
  test(`Chrome Web Store installs, persists, and disables ${slug}`, async () => {
    test.skip(process.env.BROWSER_LIVE_STORE !== "1", "Needs access to Google Chrome Web Store");
    test.setTimeout(180_000);
    const profile = await mkdtemp(join(tmpdir(), "browser-live-store-"));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined &&
          !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(entry[0]),
      ),
    );
    let app: ElectronApplication | undefined;
    const url = `https://chromewebstore.google.com/detail/${slug}/${id}`;
    const launch = () => electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
    try {
      app = await launch();
      let chrome = await app.firstWindow();
      const prompts: any[] = [];
      await app.evaluate(({ dialog }) => {
        (globalThis as any).storePrompts = [];
        dialog.showMessageBox = async (...args: any[]) => {
          (globalThis as any).storePrompts.push(args.at(-1));
          return { response: 1, checkboxChecked: false };
        };
      });
      await chrome.getByRole("button", { name: "Settings", exact: true }).click();
      await chrome
        .getByRole("region", { name: "Extensions", exact: true })
        .getByRole("button", { name: "Chrome Web Store", exact: true })
        .click();
      await expect
        .poll(() => chrome.evaluate(async () => (await window.browser!.getState()).settingsOpen))
        .toBe(false);
      await chrome.evaluate((url) => window.browser!.navigate(url), url);
      // WebContentsViews are pages in the Electron application's browser context.
      const page = await expect
        .poll(
          () =>
            app!
              .context()
              .pages()
              .find((p) => p.url().startsWith(url))
              ?.url(),
          { timeout: 30_000 },
        )
        .toBeTruthy()
        .then(() =>
          app!
            .context()
            .pages()
            .find((p) => p.url().startsWith(url))!,
        );
      await expect(page.getByRole("button", { name: /Add to (Chrome|Browser)/ })).toBeEnabled({
        timeout: 30_000,
      });
      await page.getByRole("button", { name: /Add to (Chrome|Browser)/ }).click();
      const spaceId = await chrome.evaluate(
        async () => (await window.browser!.getState()).activeSpaceId,
      );
      await expect
        .poll(() => chrome.evaluate((id) => window.browser!.getExtensions(id), spaceId), {
          timeout: 60_000,
        })
        .toMatchObject([{ id, enabled: true, loaded: true }]);
      prompts.push(...(await app.evaluate(() => (globalThis as any).storePrompts)));
      expect(prompts[0].detail).toContain("Permissions");
      await app.close();
      app = await launch();
      chrome = await app.firstWindow();
      await expect
        .poll(() => chrome.evaluate((id) => window.browser!.getExtensions(id), spaceId))
        .toMatchObject([{ id, enabled: true, loaded: true }]);
      await chrome.evaluate(
        ({ spaceId, id }) => window.browser!.setExtensionEnabled(spaceId, id, false),
        { spaceId, id },
      );
      await app.close();
      app = await launch();
      chrome = await app.firstWindow();
      expect(
        await chrome.evaluate((id) => window.browser!.getExtensions(id), spaceId),
      ).toMatchObject([{ id, enabled: false, loaded: false }]);
    } finally {
      await app?.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
