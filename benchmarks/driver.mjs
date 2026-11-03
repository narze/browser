import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import electron from "electron";
import { CDP, until } from "./cdp.mjs";

export const root = resolve(import.meta.dirname, "..");
export const electrobunBundle = join(
  root,
  "experiments/electrobun/build/dev-macos-arm64/BrowserCEF-dev.app",
);

async function freePort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

function cpuSeconds(value) {
  const fields = value.split(":").map(Number);
  return fields.reduce((seconds, part) => seconds * 60 + part, 0);
}

export function resources(pgid) {
  const rows = execFileSync("ps", ["-axo", "pid=,pgid=,rss=,time="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => Number(fields[1]) === pgid);
  return {
    rssMiB: rows.reduce((sum, fields) => sum + Number(fields[2]), 0) / 1024,
    cpuSeconds: rows.reduce((sum, fields) => sum + cpuSeconds(fields[3]), 0),
    processes: rows.length,
  };
}

export async function launch(kind, logPath) {
  const port = await freePort();
  const profile = await mkdtemp(join(tmpdir(), `browser-bench-${kind}-`));
  const env = {
    ...process.env,
    BROWSER_BENCH_PARTITION: profile.split("/").at(-1),
    ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT: String(port),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  delete env.BROWSER_HMR;
  delete env.BROWSER_HMR_URL;
  const cwd =
    kind === "electron"
      ? join(root, "benchmarks/electron")
      : join(electrobunBundle, "Contents/MacOS");
  const command = kind === "electron" ? electron : join(cwd, "launcher");
  // CEF sets this flag by default. Match it in Electron so an overlapping
  // terminal/chat window cannot suspend the measured page's animation frames.
  const args =
    kind === "electron"
      ? [
          cwd,
          "--disable-backgrounding-occluded-windows",
          `--remote-debugging-port=${port}`,
          `--user-data-dir=${profile}`,
        ]
      : [];
  const log = createWriteStream(logPath);
  const started = performance.now();
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  let launchError;
  child.on("error", (error) => {
    launchError = error;
  });
  const sockets = new Map();
  const targets = async () => {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`App exited: ${child.exitCode}`);
    return await (
      await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
    ).json();
  };
  const connect = async (target) => {
    if (!sockets.has(target.id))
      sockets.set(target.id, await CDP.connect(target.webSocketDebuggerUrl));
    return sockets.get(target.id);
  };
  const stop = async () => {
    for (const socket of sockets.values()) socket.close();
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
    const deadline = performance.now() + 3000;
    while (resources(child.pid).processes && performance.now() < deadline) await delay(100);
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* All helpers exited. */
    }
    log.end();
    await rm(profile, { recursive: true, force: true });
    if (kind === "electrobun") {
      // Only the random partition created by this run; never the user's browsing profile.
      await rm(
        join(
          homedir(),
          "Library/Application Support/dev.narze.browser-cef/dev/CEF",
          env.BROWSER_BENCH_PARTITION,
        ),
        { recursive: true, force: true },
      );
    }
  };
  try {
    const shellTarget = await until(
      async () =>
        (await targets()).find(
          (target) =>
            target.type === "page" &&
            (target.url.startsWith("file:") || target.url.startsWith("views://mainview/")),
        ),
      "browser shell",
      20000,
    );
    const shell = await connect(shellTarget);
    await until(
      () =>
        shell.evaluate(
          "!!window.browser && !!document.querySelector('h1') && document.querySelector('h1').textContent === 'Where to next?'",
        ),
      "interactive new-tab screen",
      20000,
    );
    // The same visible ready criterion, followed by two frames, in both apps.
    await shell.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    const startupMs = performance.now() - started;
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    return {
      kind,
      shell,
      shellTargetId: shellTarget.id,
      startupMs,
      version: version.Browser,
      pid: child.pid,
      targets,
      connect,
      stop,
      state: () => shell.evaluate("window.browser.getState()"),
      api: (method, ...args) =>
        shell.evaluate(`window.browser[${JSON.stringify(method)}](...${JSON.stringify(args)})`),
      page: (url) =>
        until(async () => {
          const target = (await targets()).find(
            (target) => target.type === "page" && target.url === url,
          );
          return target ? await connect(target) : null;
        }, `page ${url}`),
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
