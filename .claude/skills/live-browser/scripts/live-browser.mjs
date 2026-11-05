#!/usr/bin/env node
// Start, inspect, or stop a live, clickable view of the real Electron browser.
// The app runs as a verify-browser run; this script adds the live viewer and,
// optionally, a tailnet-only HTTPS address through `tailscale serve`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const VERIFY = join(ROOT, ".claude/skills/verify-browser/scripts/verify.mjs");

const [command = "help", ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i++) {
  const key = rest[i].replace(/^--/, "");
  const next = rest[i + 1];
  if (next === undefined || next.startsWith("--")) opts[key] = true;
  else {
    opts[key] = next;
    i++;
  }
}
const run = String(opts.run || "live");
let port = Number(opts.port || 6090);

const die = (message) => {
  console.error(`live-browser: ${message}`);
  process.exit(1);
};
const verify = (...args) =>
  execFileSync(process.execPath, [VERIFY, ...args, "--run", run], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
const sessionFile = join(ROOT, ".verify/runs", run, "session.json");
const session = () =>
  existsSync(sessionFile) ? JSON.parse(readFileSync(sessionFile, "utf8")) : null;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function tailscale(...args) {
  return execFileSync("tailscale", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function tailnetHost() {
  try {
    return JSON.parse(tailscale("status", "--json")).Self.DNSName.replace(/\.$/, "");
  } catch {
    return null;
  }
}
// Current `tailscale serve` proxy target for https://<host>:<port>, if any.
function servedTarget(host) {
  try {
    const web = JSON.parse(tailscale("serve", "status", "--json")).Web || {};
    return web[`${host}:${port}`]?.Handlers?.["/"]?.Proxy || null;
  } catch {
    return null;
  }
}
const ours = () => `http://127.0.0.1:${port}`;

async function start() {
  const existing = session();
  if (existing && alive(existing.hostPid)) console.error(`live-browser: reusing run ${run}`);
  else {
    console.error(`live-browser: launching run ${run} (pnpm build first unless --no-build)…`);
    verify("launch", ...(opts["no-build"] ? ["--no-build"] : []));
  }
  const { url } = JSON.parse(verify("live", "--port", String(port)));
  // A reused run keeps the port its viewer already has; never publish a different one.
  const actual = Number(new URL(url).port);
  if (opts.port && actual !== port)
    die(`run ${run} already serves its viewer on port ${actual}; stop it or use --port ${actual}`);
  port = actual;
  if (typeof opts.open === "string") {
    verify("fill", "--role", "textbox", "--name", "Search or enter address", "--value", opts.open);
    verify("press", "--role", "textbox", "--name", "Search or enter address", "--key", "Enter");
  }
  const result = { run, local: url, fixtureOrigin: session()?.fixtureOrigin };
  if (opts.tailnet) {
    const host = tailnetHost();
    if (!host) die("tailscale is not running or not logged in; local URL only: " + url);
    const target = servedTarget(host);
    if (target && target !== ours())
      die(`https://${host}:${port} already serves ${target}; pick another --port`);
    if (!target) tailscale("serve", "--bg", `--https=${port}`, ours());
    result.tailnet = `https://${host}:${port}/`;
  }
  console.log(JSON.stringify(result, null, 2));
}

function status() {
  const s = session();
  const host = tailnetHost();
  const target = host && servedTarget(host);
  console.log(
    JSON.stringify(
      {
        run,
        running: !!(s && alive(s.hostPid)),
        local: s?.liveUrl || null,
        tailnet: target === ours() ? `https://${host}:${port}/` : null,
        fixtureOrigin: s?.fixtureOrigin || null,
      },
      null,
      2,
    ),
  );
}

function stop() {
  const host = tailnetHost();
  // Only remove an entry this run's viewer actually serves; other projects may map the
  // same port to the same address.
  const s = session();
  const viewerPort = s?.liveUrl ? Number(new URL(s.liveUrl).port) : null;
  if (host && viewerPort === port && servedTarget(host) === ours()) {
    tailscale("serve", `--https=${port}`, "off");
    console.error(`live-browser: removed https://${host}:${port}`);
  }
  if (session()) process.stdout.write(verify("cleanup"));
  else console.log(`no run ${run} to stop`);
}

const HELP = `Usage: node .claude/skills/live-browser/scripts/live-browser.mjs <command> [options]

  start [--tailnet] [--open URL] [--no-build] [--run live] [--port 6090]
        Launch (or reuse) the app run, serve the live viewer on localhost:<port>.
        --tailnet also publishes https://<this-mac>.<tailnet>.ts.net:<port>/ (tailnet only).
        --open loads URL in the first tab.
  status [--run live] [--port 6090]
  stop   [--run live] [--port 6090]   remove the tailnet entry (only if it is ours) and stop the run
`;

if (command === "start") await start();
else if (command === "status") status();
else if (command === "stop") stop();
else console.log(HELP);
