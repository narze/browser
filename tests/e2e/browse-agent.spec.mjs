import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

// Live integration: requires the browse CLI and a store-installed browse extension.
// All relay, browser, pairing, and agent session data lives in temporary folders.
test("Browse pairs, clicks a real page through its CLI, and cleans up its tab", async () => {
  test.skip(
    process.env.BROWSER_LIVE_BROWSE !== "1",
    "Requires the browse CLI and installed extension",
  );
  test.setTimeout(90_000);
  const run = promisify(execFile);
  const id = "mfnicocicmmlkpjnaffgihfjhdgjkdjg";
  const original = JSON.parse(
    await readFile(
      join(process.env.HOME, "Library/Application Support/Browser/extensions.json"),
      "utf8",
    ),
  ).find((e) => e.id === id);
  const root = await mkdtemp(join(tmpdir(), "browse-live-"));
  const profile = join(root, "profile");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(profile);
  await writeFile(
    join(profile, "extensions.json"),
    JSON.stringify([{ ...original, profile: "browsing" }]),
  );
  const listener = createServer();
  await new Promise((r) => listener.listen(0, "127.0.0.1", r));
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  const fixture = createServer((_q, res) => {
    res.setHeader("content-type", "text/html");
    res.end(
      "<title>Browse proof</title><h1>Before</h1><button onclick=\"document.querySelector('h1').textContent='Agent worked'\">Run proof</button>",
    );
  });
  await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
  const pageUrl = `http://127.0.0.1:${fixture.address().port}/`;
  const cliEnv = {
    ...process.env,
    OPENCODE_BROWSER_HOME: join(root, "relay"),
    OPENCODE_BROWSER_PORT: String(port),
    OPENCODE_BROWSER_UPDATE_CHECK: "0",
    OPENCODE_BROWSER_MANAGED_RELAY: "1",
  };
  const cli = join(process.env.HOME, ".local/bin/browse");
  const relay = spawn(cli, ["serve"], { env: cliEnv, stdio: "ignore" });
  let app, pair;
  try {
    await expect
      .poll(
        async () =>
          fetch(`http://127.0.0.1:${port}/version`).then(
            (r) => r.ok,
            () => false,
          ),
        { timeout: 10000 },
      )
      .toBe(true);
    pair = spawn(cli, ["pair", "--wait-seconds", "60"], {
      env: cliEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const code = await new Promise((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => reject(new Error("No pairing code")), 10000);
      const read = (chunk) => {
        out += chunk.toString();
        const found = /\b([0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4})\b/.exec(out);
        if (found) {
          clearTimeout(timer);
          resolve(found[1]);
        }
      };
      pair.stdout.on("data", read);
      pair.stderr.on("data", read);
    });
    const env = { ...process.env, BROWSER_BACKGROUND: "1" };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
    const chrome = await app.firstWindow();
    await app.evaluate(async ({ session, BrowserWindow }, id) => {
      const s = session.fromPartition("persist:browsing");
      globalThis.workerErrors = [];
      s.serviceWorkers.on("console-message", (_e, d) => {
        if (d.level === 3) globalThis.workerErrors.push(d.message);
      });
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          session: s,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      await win.loadURL(`chrome-extension://${id}/onboarding.html`);
    }, id);
    const page = app
      .context()
      .pages()
      .find((p) => p.url().endsWith("/onboarding.html"));
    await expect(page.getByText("Checking…", { exact: true })).toBeHidden({ timeout: 5000 });
    await page.getByText("Connect to it", { exact: true }).click();
    await page.getByLabel("Relay address", { exact: true }).fill(`127.0.0.1:${port}`);
    await page.getByLabel("Pairing code", { exact: true }).fill(code);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect
      .poll(
        async () => {
          const r = await run(cli, ["status"], { env: cliEnv });
          return r.stdout;
        },
        { timeout: 15000 },
      )
      .toContain("Extension: connected");

    const proof = await run(
      cli,
      [
        "execute",
        "--rm",
        "--json",
        `await page.goto(${JSON.stringify(pageUrl)}); await page.getByRole('button', { name: 'Run proof' }).click(); console.log(await page.locator('h1').innerText());`,
      ],
      { env: cliEnv, timeout: 40000, maxBuffer: 100000 },
    );
    const result = JSON.parse(proof.stdout);
    expect(result.ok).toBe(true);
    expect(result.logs.some((log) => log.text === "Agent worked")).toBe(true);
    expect(await app.evaluate(() => globalThis.workerErrors)).toEqual([]);
    await expect
      .poll(() =>
        chrome
          .evaluate(() => window.browser.getState())
          .then((s) => s.tabs.filter((t) => t.url.startsWith(pageUrl)).length),
      )
      .toBe(0);
  } finally {
    await app?.close();
    pair?.kill();
    relay.kill();
    await new Promise((r) => fixture.close(r));
    await rm(root, { recursive: true, force: true });
  }
});
