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
