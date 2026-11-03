import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createSocket } from "node:net";
import { createServer } from "vite-plus";
import { root, electrobunBundle } from "./driver.mjs";
import { CDP, until } from "./cdp.mjs";

const base = join(root, "experiments/electrobun");
const cssPath = join(base, "src/mainview/style.css");
const original = await readFile(cssPath, "utf8");
const server = await createServer({
  root: join(base, "src/mainview"),
  configFile: join(base, "vite.config.ts"),
  server: { port: 5187, strictPort: true },
});
await server.listen();
const socket = createSocket();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const profile = await mkdtemp(join(tmpdir(), "browser-bench-hmr-"));
const partition = profile.split("/").at(-1);
const cwd = join(electrobunBundle, "Contents/MacOS");
const child = spawn(join(cwd, "launcher"), [], {
  cwd,
  detached: true,
  stdio: "ignore",
  env: {
    ...process.env,
    BROWSER_HMR: "1",
    BROWSER_HMR_URL: "http://127.0.0.1:5187/",
    BROWSER_BENCH_PARTITION: partition,
    ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT: String(port),
  },
});
let page;
try {
  const target = await until(
    async () =>
      (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
        (target) => target.url === "http://127.0.0.1:5187/",
      ),
    "HMR target",
    20000,
  );
  page = await CDP.connect(target.webSocketDebuggerUrl);
  await until(
    () => page.evaluate("!!window.browser && !!document.querySelector('h1')"),
    "HMR Svelte browser",
    20000,
  );
  await writeFile(cssPath, original + "\nbody { --benchmark-hmr-probe: updated; }\n");
  await until(
    () =>
      page.evaluate(
        "getComputedStyle(document.body).getPropertyValue('--benchmark-hmr-probe').trim() === 'updated'",
      ),
    "live CSS update",
  );
  console.log("PASS: CEF loads Vite assets; Svelte mounts; CSS HMR updates without restart.");
  const tabs = await page.evaluate(
    "(async()=>{const a=await window.browser.newTab();const b=await window.browser.newTab();await Promise.all([window.browser.closeTab(1),window.browser.closeTab(a)]);return {remaining:b,state:await window.browser.getState()}})()",
  );
  assert.equal(tabs.state.tabs.length, 1);
  assert.equal(tabs.state.activeId, tabs.remaining);
  console.log("PASS: Concurrent tab closes retain the correct active tab.");
} finally {
  await writeFile(cssPath, original);
  page?.close();
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* Already closed. */
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* All helpers exited. */
  }
  await server.close();
  await rm(profile, { recursive: true, force: true });
  await rm(
    join(homedir(), "Library/Application Support/dev.narze.browser-cef/dev/CEF", partition),
    { recursive: true, force: true },
  );
}
