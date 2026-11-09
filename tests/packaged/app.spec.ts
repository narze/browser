import { test, expect, chromium } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `pnpm package` writes the app to release/mac-<arch>/Browser.app.
const release = join(import.meta.dirname, "../../release");
const folder = existsSync(release)
  ? readdirSync(release).find((name) => name.startsWith("mac"))
  : undefined;
const bundle = join(release, folder ?? "mac", "Browser.app");
const plist = (key: string) =>
  execFileSync("plutil", ["-extract", key, "raw", "-o", "-", join(bundle, "Contents/Info.plist")])
    .toString()
    .trim();

test("the packaged Browser.app is signed, can open web links, and browses", async () => {
  expect(existsSync(bundle), `${bundle} must exist`).toBe(true);
  expect(plist("CFBundleName")).toBe("Browser");
  expect(plist("CFBundleIconFile")).toBe("icon.icns");
  expect(plist("NSMicrophoneUsageDescription")).toContain("microphone");
  expect(plist("NSCameraUsageDescription")).toContain("camera");
  // Without it, macOS never asks for location access, and location requests time out.
  expect(plist("NSLocationWhenInUseUsageDescription")).toContain("location");
  expect(plist("NSLocationUsageDescription")).toContain("location");
  // The app asks macOS for location access with this native module.
  expect(
    existsSync(
      join(
        bundle,
        "Contents/Resources/app.asar.unpacked/node_modules/node-mac-permissions/build/Release/permissions.node",
      ),
    ),
  ).toBe(true);
  expect(existsSync(join(bundle, "Contents/Resources/icon.icns"))).toBe(true);
  // http and https make the app a choice for the default web browser.
  expect(plist("CFBundleURLTypes.0.CFBundleURLSchemes.0")).toBe("http");
  expect(plist("CFBundleURLTypes.0.CFBundleURLSchemes.1")).toBe("https");
  execFileSync("codesign", ["--verify", "--deep", "--strict", bundle]);

  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end("<title>Packaged page</title><h1>Packaged page</h1>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const userData = await mkdtemp(join(tmpdir(), "browser-packaged-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(entry[0]),
    ),
  );
  // Start the app as a user would, with only Chromium's debug port. Playwright's
  // _electron.launch also attaches a Node inspector, which stalls the packaged app.
  const app = spawn(
    join(bundle, "Contents/MacOS/Browser"),
    [`--user-data-dir=${userData}`, "--remote-debugging-port=0"],
    { env },
  );
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let output = "";
      app.stderr.on("data", (chunk) => {
        output += chunk;
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
        if (match) resolve(match[1]);
      });
      app.once("exit", (code) => reject(new Error(`Browser exited with ${code}: ${output}`)));
    });
    const browser = await chromium.connectOverCDP(endpoint);
    const pages = () => browser.contexts().flatMap((context) => context.pages());
    await expect
      .poll(() => pages().some((page) => page.url().endsWith("/dist/index.html")))
      .toBe(true);
    const chrome = pages().find((page) => page.url().endsWith("/dist/index.html"))!;
    expect(chrome.url()).toContain("/Contents/Resources/app.asar/");
    await expect(chrome.getByRole("heading", { name: "Where to next?" })).toBeVisible();
    const address = chrome.getByRole("textbox", { name: "Search or enter address" });
    await address.fill(`http://127.0.0.1:${port}`);
    await address.press("Enter");
    await expect(chrome.getByRole("tab", { name: "Packaged page" })).toBeVisible();
    // The site preload loads from app.asar, so sites see "prompt", not "denied".
    // The page is in its space's browser context, which Playwright does not attach to.
    const cdp = await browser.newBrowserCDPSession();
    const site = async () =>
      (await cdp.send("Target.getTargets")).targetInfos.find((target) =>
        target.url.startsWith(`http://127.0.0.1:${port}`),
      );
    await expect.poll(site).toBeTruthy();
    // Talk to the page's own DevTools endpoint on the same debug port.
    const socket = new WebSocket(
      `${new URL(endpoint).origin}/devtools/page/${(await site())!.targetId}`,
    );
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    const reply = new Promise<string>((resolve) => {
      socket.onmessage = (event) => resolve(JSON.parse(event.data).result.result.value);
    });
    socket.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression: "navigator.permissions.query({name: 'camera'}).then((p) => p.state)",
          awaitPromise: true,
          returnByValue: true,
        },
      }),
    );
    expect(await reply).toBe("prompt");
    socket.close();
    if (process.env.BROWSER_LIVE_STORE === "1") {
      // Check that the dependency's preload also runs from the packaged ASAR.
      const storeUrl =
        "https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh";
      await chrome.evaluate((url) => window.browser!.navigate(url), storeUrl);
      const store = async () =>
        (await cdp.send("Target.getTargets")).targetInfos.find((target) =>
          target.url.startsWith(storeUrl),
        );
      await expect.poll(store).toBeTruthy();
      const storeSocket = new WebSocket(
        `${new URL(endpoint).origin}/devtools/page/${(await store())!.targetId}`,
      );
      try {
        await new Promise((resolve, reject) => {
          storeSocket.onopen = resolve;
          storeSocket.onerror = reject;
        });
        const storeReady = () =>
          new Promise<boolean>((resolve) => {
            storeSocket.onmessage = (event) =>
              resolve(JSON.parse(event.data).result?.result?.value ?? false);
            storeSocket.send(
              JSON.stringify({
                id: 1,
                method: "Runtime.evaluate",
                params: {
                  expression:
                    "typeof chrome.webstorePrivate?.beginInstallWithManifest3 === 'function' && [...document.querySelectorAll('button')].some(b => /Add to (Chrome|Browser)/.test(b.innerText) && !b.disabled)",
                  returnByValue: true,
                },
              }),
            );
          });
        await expect.poll(storeReady, { timeout: 30_000 }).toBe(true);
      } finally {
        storeSocket.close();
      }
    }
    await browser.close();
  } finally {
    if (app.exitCode === null && app.signalCode === null) {
      const exited = new Promise((resolve) => app.once("exit", resolve));
      app.kill();
      await exited;
    }
    server.close();
    await rm(userData, { recursive: true, force: true });
  }
});
