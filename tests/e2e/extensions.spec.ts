import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("unpacked extensions run in their space, open isolated pages, and survive restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-extensions-"));
  const profile = join(directory, "profile");
  const extension = join(directory, "extension");
  await mkdir(extension);
  await writeFile(
    join(extension, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Extension fixture",
      version: "1.0.0",
      permissions: ["storage"],
      background: { service_worker: "background.js" },
      content_scripts: [{ matches: ["http://127.0.0.1/*"], js: ["content.js"] }],
      action: { default_popup: "popup.html" },
      options_ui: { page: "options.html" },
    }),
  );
  await writeFile(
    join(extension, "background.js"),
    `
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (message === 'fixture') {
        chrome.storage.local.set({ proof: 'background works' }).then(() => reply('extension works'));
        return true;
      }
    });
  `,
  );
  await writeFile(
    join(extension, "content.js"),
    `
    chrome.runtime.sendMessage('fixture', reply => {
      document.documentElement.dataset.extension = chrome.runtime.lastError?.message ?? reply;
    });
  `,
  );
  await writeFile(
    join(extension, "popup.html"),
    '<h1>Fixture popup</h1><p id="proof"></p><script src="popup.js"></script>',
  );
  await writeFile(
    join(extension, "popup.js"),
    `
    chrome.storage.local.get('proof').then(data => document.querySelector('#proof').textContent = data.proof || 'empty');
  `,
  );
  await writeFile(join(extension, "options.html"), "<h1>Fixture options</h1>");
  const server = createServer((_req, res) =>
    res.end("<title>Extension page</title><h1>Test page</h1>"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
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
    // Exercise the real settings/picker path without interacting with an OS dialog.
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, extension);
    await chrome.getByRole("button", { name: "Settings", exact: true }).click();
    const section = chrome.getByRole("region", { name: "Extensions", exact: true });
    await section.getByRole("button", { name: "Load unpacked" }).click();
    await expect(section.getByText("Extension fixture", { exact: true })).toBeVisible();
    await expect(section.getByRole("checkbox", { name: "Enable Extension fixture" })).toBeChecked();
    await section.getByRole("button", { name: "Load unpacked" }).click();
    await expect(section.getByRole("alert")).toContainText("already installed");
    await chrome.getByRole("button", { name: "Back to browsing" }).click();
    await chrome.evaluate((url) => window.browser!.navigate(url), url);
    let pageUrl = url + "/";
    const injected = () =>
      app!.evaluate(({ webContents }, target) => {
        const page = webContents.getAllWebContents().find((c) => c.getURL() === target);
        return page?.executeJavaScript("document.documentElement.dataset.extension ?? null");
      }, pageUrl);
    await expect.poll(injected).toBe("extension works");
    await chrome.getByRole("button", { name: "Settings", exact: true }).click();
    const popupPromise = app.waitForEvent("window");
    await section.getByRole("button", { name: "Open popup" }).click();
    const popup = await popupPromise;
    await expect(popup.getByRole("heading")).toHaveText("Fixture popup");
    await expect(popup.locator("#proof")).toHaveText("background works");
    expect(
      await popup.evaluate(() => ({
        node: typeof (window as any).require,
        bridge: typeof window.browser?.getState,
        extensionApi: typeof (window.browser as any)?.runtime?.id,
      })),
    ).toEqual({ node: "undefined", bridge: "undefined", extensionApi: "string" });
    await popup.evaluate(() => (window.browser as any).storage.local.set({ remembered: 42 }));
    await popup.close();
    const optionsPromise = app.waitForEvent("window");
    await section.getByRole("button", { name: "Options", exact: true }).click();
    const options = await optionsPromise;
    await expect(options.getByRole("heading")).toHaveText("Fixture options");
    await section.getByRole("checkbox", { name: "Enable Extension fixture" }).uncheck();
    await expect.poll(() => options.isClosed()).toBe(true);
    await expect(section.getByRole("button", { name: "Open popup" })).toHaveCount(0);
    await chrome.evaluate(() => window.browser!.reload());
    await expect.poll(injected).toBe(null);
    await section.getByRole("checkbox", { name: "Enable Extension fixture" }).check();
    await section.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(section).toHaveAttribute("aria-busy", "false");
    await chrome.evaluate(() => window.browser!.reload());
    await expect.poll(injected).toBe("extension works");
    const reloadedPopupPromise = app.waitForEvent("window");
    await section.getByRole("button", { name: "Open popup" }).click();
    const reloadedPopup = await reloadedPopupPromise;
    expect(
      await reloadedPopup.evaluate(() => (window.browser as any).storage.local.get("remembered")),
    ).toEqual({ remembered: 42 });
    await reloadedPopup.close();

    // Removing and loading the same extension again must also restart its worker.
    await section.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(section.getByText("No extensions in this space.")).toBeVisible();
    await section.getByRole("button", { name: "Load unpacked" }).click();
    await expect(section.getByText("Extension fixture", { exact: true })).toBeVisible();
    await chrome.evaluate(() => window.browser!.reload());
    await expect.poll(injected).toBe("extension works");

    // Another space starts with no extension and does not receive its content script.
    await chrome.evaluate(async () => {
      await window.browser!.createSpace();
      await window.browser!.closeSettings();
    });
    pageUrl = url + "/other";
    await chrome.evaluate((url) => window.browser!.navigate(url), pageUrl);
    const otherId = await chrome.evaluate(
      async () => (await window.browser!.getState()).activeSpaceId,
    );
    expect(await chrome.evaluate((id) => window.browser!.getExtensions(id), otherId)).toEqual([]);
    await expect.poll(injected).toBe(null);
    const originalId = await chrome.evaluate(
      async () => (await window.browser!.getState()).spaces[0].id,
    );
    await chrome.evaluate((id) => window.browser!.switchSpace(id), originalId);
    pageUrl = url + "/";

    await app.close();
    app = await launch();
    chrome = await app.firstWindow();
    await expect.poll(injected).toBe("extension works");
    await chrome.getByRole("button", { name: "Settings", exact: true }).click();
    const restored = chrome.getByRole("region", { name: "Extensions", exact: true });
    await expect(restored.getByText("Extension fixture", { exact: true })).toBeVisible();
    await restored.screenshot({ path: test.info().outputPath("extensions.png") });
    await restored.getByRole("checkbox", { name: "Enable Extension fixture" }).uncheck();
    await app.close();
    app = await launch();
    chrome = await app.firstWindow();
    await expect.poll(injected).toBe(null);
    await chrome.getByRole("button", { name: "Settings", exact: true }).click();
    const disabled = chrome.getByRole("region", { name: "Extensions", exact: true });
    await expect(disabled.getByRole("checkbox")).not.toBeChecked();
    await disabled.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(disabled.getByText("No extensions in this space.")).toBeVisible();
    await app.close();
    app = await launch();
    chrome = await app.firstWindow();
    expect(await chrome.evaluate((id) => window.browser!.getExtensions(id), originalId)).toEqual(
      [],
    );
  } finally {
    await app?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
