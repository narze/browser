#!/usr/bin/env node
// Drive the real Electron browser for verification.
// A detached host process owns one Playwright Electron session per run and
// exposes it on a loopback control port. Each CLI call is one user action.
import { spawn, execFileSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  rmSync,
  readdirSync,
  statSync,
  openSync,
} from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT), "../../../..");
const VERIFY = join(ROOT, ".verify");
const RUNS = join(VERIFY, "runs");
const EVIDENCE = join(VERIFY, "evidence");

const [command = "help", ...rest] = process.argv.slice(2);
const opts = parseArgs(rest);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function die(message) {
  console.error(`verify: ${message}`);
  process.exit(1);
}

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function liveRuns() {
  if (!existsSync(RUNS)) return [];
  return readdirSync(RUNS).filter((id) => {
    const file = join(RUNS, id, "session.json");
    if (!existsSync(file)) return false;
    return pidAlive(JSON.parse(readFileSync(file, "utf8")).hostPid);
  });
}

function resolveRun() {
  const id = opts.run || process.env.VERIFY_RUN;
  if (id) return id;
  const live = liveRuns();
  if (live.length === 1) return live[0];
  if (!live.length) die("no live run. Start one with: verify.mjs launch");
  die(`several live runs (${live.join(", ")}). Pass --run <id>.`);
}

function session(id) {
  const file = join(RUNS, id, "session.json");
  if (!existsSync(file)) die(`run ${id} has no session.json (never launched or cleaned up)`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function call(port, body, timeout = 120_000) {
  return new Promise((resolvePromise, reject) => {
    const data = JSON.stringify(body);
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/cmd",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) },
        timeout,
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          try {
            resolvePromise(JSON.parse(text));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("control request timed out")));
    req.on("error", reject);
    req.end(data);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- CLI side

async function launch() {
  const id =
    opts.run ||
    `${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-")}-${process.pid}`;
  const runDir = join(RUNS, id);
  if (existsSync(join(runDir, "session.json"))) die(`run ${id} already exists`);
  mkdirSync(runDir, { recursive: true });
  mkdirSync(join(EVIDENCE, id), { recursive: true });
  if (!opts["no-build"]) {
    console.error("verify: building dist/ (pnpm build)…");
    try {
      execFileSync("pnpm", ["build"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
    } catch {
      die("pnpm build failed; fix the build before verifying");
    }
  }
  if (!existsSync(join(ROOT, "dist/index.html")) || !existsSync(join(ROOT, "dist/preload.cjs")))
    die("dist/index.html or dist/preload.cjs missing; run pnpm build");
  const log = openSync(join(runDir, "host.log"), "a");
  const child = spawn(process.execPath, [SCRIPT, "__host", id], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  const deadline = Date.now() + 90_000;
  const file = join(runDir, "session.json");
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const s = JSON.parse(readFileSync(file, "utf8"));
      if (s.ready) {
        console.log(JSON.stringify({ run: id, ...s }, null, 2));
        return;
      }
      if (s.error) die(`launch failed: ${s.error} (see ${join(runDir, "host.log")})`);
    }
    if (!pidAlive(child.pid)) die(`host exited early; see ${join(runDir, "host.log")}`);
    await sleep(250);
  }
  die(`not ready after 90s; see ${join(runDir, "host.log")}`);
}

async function doctor() {
  const id = resolveRun();
  const s = session(id);
  const report = {
    run: id,
    hostPid: s.hostPid,
    hostAlive: pidAlive(s.hostPid),
    electronPid: s.electronPid,
    electronAlive: s.electronPid ? pidAlive(s.electronPid) : false,
    controlPort: s.controlPort,
    fixtureOrigin: s.fixtureOrigin,
    profile: s.profile,
    evidence: s.evidence,
    builtFrom: s.gitRev,
    checkoutRev: gitRev(),
    distStale: distStale(),
  };
  try {
    const res = await call(s.controlPort, { cmd: "ping" }, 10_000);
    report.control = res.ok ? "ok" : res.error;
    if (res.ok) Object.assign(report, res.result);
  } catch (error) {
    report.control = `unreachable: ${error.message}`;
  }
  const healthy =
    report.hostAlive &&
    report.electronAlive &&
    report.control === "ok" &&
    report.chromeReady &&
    report.builtFrom === report.checkoutRev &&
    !report.distStale;
  report.healthy = !!healthy;
  console.log(JSON.stringify(report, null, 2));
  process.exit(healthy ? 0 : 2);
}

function gitRev() {
  try {
    const rev = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT })
      .toString()
      .trim();
    const dirty = execFileSync(
      "git",
      ["status", "--porcelain", "--", "src", "electron", "shared"],
      {
        cwd: ROOT,
      },
    )
      .toString()
      .trim();
    return dirty ? `${rev}+dirty` : rev;
  } catch {
    return "unknown";
  }
}

// True when a source file is newer than the built bundle the app loaded.
function distStale() {
  const built = statSync(join(ROOT, "dist/index.html")).mtimeMs;
  const newest = (dir) =>
    readdirSync(join(ROOT, dir), { recursive: true }).reduce((max, file) => {
      const st = statSync(join(ROOT, dir, file));
      return st.isFile() ? Math.max(max, st.mtimeMs) : max;
    }, 0);
  return Math.max(newest("src"), newest("shared"), newest("electron")) > built;
}

async function cleanup() {
  const ids = opts.all ? (existsSync(RUNS) ? readdirSync(RUNS) : []) : [resolveRun()];
  for (const id of ids) {
    const runDir = join(RUNS, id);
    const file = join(runDir, "session.json");
    if (existsSync(file)) {
      const s = JSON.parse(readFileSync(file, "utf8"));
      if (pidAlive(s.hostPid)) {
        try {
          await call(s.controlPort, { cmd: "shutdown" }, 15_000);
        } catch {}
        for (let i = 0; i < 40 && pidAlive(s.hostPid); i++) await sleep(250);
      }
      // Only signal processes this run recorded; never kill by name.
      for (const pid of [s.electronPid, s.hostPid]) {
        if (pid && pidAlive(pid)) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
      }
    }
    rmSync(runDir, { recursive: true, force: true });
    const evidence = join(EVIDENCE, id);
    console.log(
      `cleaned run ${id}; evidence kept at ${existsSync(evidence) ? evidence : "(none)"}`,
    );
  }
}

async function forward(cmd) {
  const id = resolveRun();
  const s = session(id);
  const args = { ...opts };
  delete args.run;
  let res;
  try {
    res = await call(s.controlPort, { cmd, args });
  } catch (error) {
    die(`control port ${s.controlPort} unreachable (${error.message}); run doctor`);
  }
  if (!res.ok) {
    console.error(`verify ${cmd} failed: ${res.error}`);
    process.exit(1);
  }
  const result = res.result;
  console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
}

const HELP = `Usage: node .claude/skills/verify-browser/scripts/verify.mjs <command> [--run ID] [options]

Lifecycle
  launch [--run ID] [--no-build]                        build, start an isolated app, wait until usable
  doctor                                                read-only health check (exit 0 healthy, 2 not)
  relaunch                                              quit and restart with the same profile
  cleanup [--all]                                       stop what this run started, delete scratch, keep evidence
  runs                                                  list live runs

Targets (--target): chrome (default) | palette | peek | quick | page:<url substring> | active
  state                                                 window.browser.getState() as JSON
  snapshot [--target T] [--out name.aria.txt]           ARIA snapshot (printed; saved when --out)
  click   <locator> [--target T]                        click
  fill    <locator> --value V [--target T]              replace text in a field
  select  <locator> --value V                           choose a <select> option
  press   --key K [<locator>] [--target T]              e.g. Enter, ArrowDown, Meta+K, Control+Tab
  type    --text T [--target T]                         type into the focused element
  wait    <locator> [--state visible|hidden] [--timeout ms]
  wait    --until "<JS expr over state>" [--timeout ms] e.g. "state.tabs.length === 2"
  value   <locator>                                     input value
  screenshot --out name.png [--window quick]            whole window, page views composited in
  shortcut --key K [--modifiers meta,control,alt,shift] keyboard shortcut through Electron input (before-input-event)
  menu    --path "File>New tab"                         click an application-menu item (accelerator-only shortcuts)
  eval    --js "<async body>"                           escape hatch; gets {app, chrome, pages, target, fixture}
  note    --text "..."                                  append a note to the evidence log
  live    [--port 6090]                                 serve a live, clickable view of the window on localhost

Locator: --role R --name N [--loose] | --label L | --text T | --css S   (+ --nth N)
Fixture server: <fixtureOrigin>/<anything> serves "<title>Fixture /<anything></title>";
  /links has a same-tab link "Next", a popup link "Popup", and "Elsewhere", a link to
  another site (localhost instead of 127.0.0.1) for peek checks.
`;

// ---------------------------------------------------------------- host side

async function host(id) {
  const { _electron } = await import("@playwright/test");
  const runDir = join(RUNS, id);
  const profile = join(runDir, "profile");
  const evidence = join(EVIDENCE, id);
  mkdirSync(profile, { recursive: true });
  mkdirSync(evidence, { recursive: true });
  const file = join(runDir, "session.json");
  const write = (extra) => writeFileSync(file, JSON.stringify({ ...current, ...extra }, null, 2));
  const logAction = (entry) =>
    appendFileSync(
      join(evidence, "actions.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    );

  const fixture = createServer((req, res) => {
    const path = decodeURIComponent((req.url || "/").split("?")[0]);
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (path === "/links") {
      res.end(
        `<title>Fixture /links</title><h1>Fixture /links</h1><p><a href="/next">Next</a> <a href="/popup-target" target="_blank">Popup</a> <a href="http://localhost:${fixture.address().port}/elsewhere">Elsewhere</a></p>`,
      );
      return;
    }
    if (path === "/slow") {
      setTimeout(() => res.end("<title>Fixture /slow</title><h1>Fixture /slow</h1>"), 5000);
      return;
    }
    const safe = path.replace(/[<>&"]/g, "");
    res.end(
      `<title>Fixture ${safe}</title><body style="font:20px system-ui;padding:24px"><h1>Fixture ${safe}</h1><p>Served by the verify-browser fixture.</p></body>`,
    );
  });
  await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
  const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;

  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined && !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(key),
    ),
  );
  let app;
  let chrome;
  const current = {
    run: id,
    hostPid: process.pid,
    electronPid: null,
    controlPort: null,
    fixtureOrigin,
    profile,
    evidence,
    gitRev: gitRev(),
    startedAt: new Date().toISOString(),
    ready: false,
  };

  async function start() {
    app = await _electron.launch({
      cwd: ROOT,
      args: [".", `--user-data-dir=${profile}`],
      env,
      // Let Electron's nativeTheme drive prefers-color-scheme, like a real launch.
      colorScheme: null,
    });
    current.electronPid = app.process().pid;
    write({ ready: false });
    chrome = await app.firstWindow();
    await chrome.waitForFunction(() => !!window.browser, null, { timeout: 30_000 });
    await chrome.getByRole("tablist", { name: "Browser tabs" }).waitFor({ timeout: 30_000 });
    await chrome.waitForFunction(
      async () => (await window.browser.getState()).tabs.length >= 1,
      null,
      { timeout: 30_000 },
    );
  }

  const pages = () => app.context().pages();
  async function target(name = "chrome") {
    if (name === "chrome") return chrome;
    // The palette and peek frame are views above the pages; quick is the quick window.
    const views = { palette: "#palette", peek: "#peek", quick: "#mini" };
    if (name in views) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const page = pages().find((p) => p.url().endsWith(views[name]));
        if (page) return page;
        await sleep(100);
      }
      throw new Error(`${name} view not found; open it first`);
    }
    if (name === "active") {
      const state = await chrome.evaluate(() => window.browser.getState());
      const tab = state.tabs.find((t) => t.id === state.activeId);
      if (!tab?.url) throw new Error("active tab shows the new-tab page; use --target chrome");
      name = `page:${tab.url}`;
    }
    if (name.startsWith("page:")) {
      const part = name.slice(5);
      const page = pages().find(
        (p) => p !== chrome && !/#(palette|peek|mini)$/.test(p.url()) && p.url().includes(part),
      );
      if (!page)
        throw new Error(
          `no page whose URL contains ${part}; open: ${pages()
            .map((p) => p.url())
            .join(", ")}`,
        );
      return page;
    }
    throw new Error(`unknown target ${name}`);
  }

  function locator(page, a) {
    let loc;
    if (a.role)
      loc = page.getByRole(
        a.role,
        a.name !== undefined ? { name: String(a.name), exact: !a.loose } : {},
      );
    else if (a.label) loc = page.getByLabel(String(a.label), { exact: !a.loose });
    else if (a.text) loc = page.getByText(String(a.text), { exact: !a.loose });
    else if (a.css) loc = page.locator(String(a.css));
    else return null;
    if (a.nth !== undefined) loc = loc.nth(Number(a.nth));
    return loc;
  }
  const need = (page, a) => {
    const loc = locator(page, a);
    if (!loc) throw new Error("pass a locator: --role/--name, --label, --text, or --css");
    return loc;
  };
  const outPath = (name, fallback) => {
    const out = name && name !== true ? String(name) : fallback;
    const full = isAbsolute(out) ? out : join(evidence, out);
    mkdirSync(dirname(full), { recursive: true });
    return full;
  };

  async function screenshot(out, which) {
    const capture = await app.evaluate(async ({ BrowserWindow }, quick) => {
      const win = BrowserWindow.getAllWindows().find((entry) =>
        quick
          ? entry.webContents.getURL().endsWith("#mini")
          : !entry.webContents.getURL().includes("#"),
      );
      if (!win) throw new Error(quick ? "the quick window is not open" : "no main window");
      const [width, height] = win.getContentSize();
      const shot = async (contents) => (await contents.capturePage()).toPNG().toString("base64");
      const layers = [{ png: await shot(win.webContents), x: 0, y: 0, width, height }];
      for (const view of win.contentView.children) {
        if (!view.getVisible() || !view.webContents) continue;
        const b = view.getBounds();
        if (b.width < 2 || b.height < 2) continue;
        layers.push({ png: await shot(view.webContents), ...b });
      }
      return { width, height, layers };
    }, which === "quick");
    const dataUrl = await chrome.evaluate(async ({ width, height, layers }) => {
      const bitmaps = await Promise.all(
        layers.map((l) =>
          createImageBitmap(
            new Blob([Uint8Array.from(atob(l.png), (c) => c.charCodeAt(0))], { type: "image/png" }),
          ),
        ),
      );
      const scale = bitmaps[0].width / width;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      layers.forEach((l, i) =>
        ctx.drawImage(bitmaps[i], l.x * scale, l.y * scale, l.width * scale, l.height * scale),
      );
      return canvas.toDataURL("image/png");
    }, capture);
    const full = outPath(out, `screenshot-${Date.now()}.png`);
    writeFileSync(full, Buffer.from(dataUrl.split(",")[1], "base64"));
    return { saved: full, layers: capture.layers.length };
  }

  const handlers = {
    async ping() {
      const state = await chrome.evaluate(() => window.browser.getState());
      return {
        chromeReady: true,
        chromeUrl: chrome.url(),
        tabs: state.tabs.length,
        activeId: state.activeId,
        settings: state.settings,
        electronVersion: await app.evaluate(() => process.versions.electron),
      };
    },
    state: () => chrome.evaluate(() => window.browser.getState()),
    async snapshot(a) {
      const page = await target(a.target);
      const text = await page.locator("body").ariaSnapshot();
      if (a.out) {
        const full = outPath(a.out);
        writeFileSync(full, `# target: ${a.target || "chrome"} url: ${page.url()}\n${text}\n`);
        return `${text}\n# saved ${full}`;
      }
      return text;
    },
    async click(a) {
      await need(await target(a.target), a).click({ timeout: Number(a.timeout || 10_000) });
      return "clicked";
    },
    async fill(a) {
      if (a.value === undefined) throw new Error("--value is required");
      await need(await target(a.target), a).fill(String(a.value === true ? "" : a.value), {
        timeout: Number(a.timeout || 10_000),
      });
      return "filled";
    },
    async select(a) {
      const chosen = await need(await target(a.target), a).selectOption(String(a.value), {
        timeout: Number(a.timeout || 10_000),
      });
      return { selected: chosen };
    },
    async press(a) {
      if (!a.key) throw new Error("--key is required");
      const page = await target(a.target);
      const loc = locator(page, a);
      if (loc) await loc.press(String(a.key), { timeout: Number(a.timeout || 10_000) });
      else await page.keyboard.press(String(a.key));
      return "pressed";
    },
    async type(a) {
      await (await target(a.target)).keyboard.type(String(a.text));
      return "typed";
    },
    async menu(a) {
      if (!a.path) throw new Error('--path is required, e.g. "File>New tab"');
      return app.evaluate(({ Menu }, path) => {
        const labels = path.split(">").map((part) => part.trim());
        let items = Menu.getApplicationMenu().items;
        let item;
        for (const label of labels) {
          item = items.find((entry) => entry.label === label);
          if (!item)
            throw new Error(`no menu item "${label}" in ${items.map((e) => e.label).join(", ")}`);
          items = item.submenu?.items || [];
        }
        item.click();
        return `clicked menu ${path} (${item.accelerator || "no accelerator"})`;
      }, String(a.path));
    },
    async shortcut(a) {
      if (!a.key) throw new Error("--key is required");
      const modifiers = a.modifiers ? String(a.modifiers).split(",") : [];
      // Default receiver: whatever has keyboard focus, like a real keypress. --target
      // chrome|palette|page:<url part> picks one explicitly.
      const want = a.target ? (await target(String(a.target))).url() : null;
      return app.evaluate(
        ({ webContents, BrowserWindow }, { key, modifiers, want }) => {
          const all = webContents.getAllWebContents();
          const receiver = want
            ? all.find((c) => c.getURL() === want)
            : webContents.getFocusedWebContents() || BrowserWindow.getAllWindows()[0].webContents;
          if (!receiver) throw new Error("no receiver for the shortcut");
          receiver.sendInputEvent({ type: "keyDown", keyCode: key, modifiers });
          receiver.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
          return `sent ${[...modifiers, key].join("+")} to ${receiver.getURL()}`;
        },
        { key: String(a.key), modifiers, want },
      );
    },
    async wait(a) {
      const timeout = Number(a.timeout || 15_000);
      if (a.until) {
        // The chrome's CSP forbids eval, so poll state here and test the expression in Node.
        const expr = String(a.until);
        const test = new Function("state", `return (${expr});`);
        const deadline = Date.now() + timeout;
        let state;
        while (Date.now() < deadline) {
          state = await chrome.evaluate(() => window.browser.getState());
          if (test(state)) return `until ${expr}: true`;
          await sleep(100);
        }
        throw new Error(`timed out after ${timeout}ms waiting for ${expr}`);
      }
      await need(await target(a.target), a).waitFor({ state: a.state || "visible", timeout });
      return `${a.state || "visible"}`;
    },
    async value(a) {
      return need(await target(a.target), a).inputValue({ timeout: Number(a.timeout || 10_000) });
    },
    screenshot: (a) => screenshot(a.out, a.window),
    async eval(a) {
      const fn = new Function(
        "ctx",
        `return (async ({ app, chrome, pages, target, fixture }) => { ${a.js} })(ctx);`,
      );
      const result = await fn({ app, chrome, pages, target, fixture: fixtureOrigin });
      return result === undefined ? "ok" : result;
    },
    note: (a) => String(a.text || ""),
    async live(a) {
      if (!liveSession) {
        const { startLive } = await import("../../live-browser/scripts/live.mjs");
        liveSession = await startLive({ app, port: Number(a.port || 6090) });
        current.liveUrl = liveSession.url;
        write({ ready: true });
      }
      return { url: liveSession.url };
    },
    async relaunch() {
      const livePort = liveSession && Number(new URL(liveSession.url).port);
      liveSession?.close();
      liveSession = null;
      await app.close();
      await start();
      if (livePort) {
        const { startLive } = await import("../../live-browser/scripts/live.mjs");
        liveSession = await startLive({ app, port: livePort });
      }
      write({ ready: true });
      return { electronPid: current.electronPid };
    },
    async shutdown() {
      setTimeout(() => void stop(0), 50);
      return "stopping";
    },
  };

  let liveSession = null;
  let stopping = false;
  async function stop(code) {
    if (stopping) return;
    stopping = true;
    liveSession?.close();
    try {
      await app?.close();
    } catch {}
    fixture.close();
    control.close();
    process.exit(code);
  }

  const control = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let reply;
      let parsed = {};
      try {
        parsed = JSON.parse(body);
        const handler = handlers[parsed.cmd];
        if (!handler) throw new Error(`unknown command ${parsed.cmd}`);
        reply = { ok: true, result: await handler(parsed.args || {}) };
      } catch (error) {
        reply = {
          ok: false,
          error: String(error?.message || error)
            .split("\n")
            .slice(0, 8)
            .join("\n"),
        };
      }
      if (parsed.cmd && parsed.cmd !== "ping") {
        const summary =
          typeof reply.result === "string" ? reply.result.slice(0, 200) : reply.result;
        logAction({
          cmd: parsed.cmd,
          args: parsed.args,
          ok: reply.ok,
          result: summary,
          error: reply.error,
        });
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise((r) => control.listen(0, "127.0.0.1", r));
  current.controlPort = control.address().port;

  process.on("SIGTERM", () => void stop(0));
  process.on("SIGINT", () => void stop(0));
  try {
    await start();
    write({ ready: true });
    logAction({ cmd: "launch", result: { fixtureOrigin, profile, gitRev: current.gitRev } });
    console.error(`ready: run ${id} control ${current.controlPort} fixture ${fixtureOrigin}`);
  } catch (error) {
    write({ ready: false, error: String(error?.message || error) });
    console.error(error);
    await stop(1);
  }
}

// ---------------------------------------------------------------- dispatch

switch (command) {
  case "launch":
    await launch();
    break;
  case "doctor":
    await doctor();
    break;
  case "cleanup":
    await cleanup();
    break;
  case "runs":
    console.log(liveRuns().join("\n") || "(no live runs)");
    break;
  case "__host":
    await host(opts._[0]);
    break;
  case "help":
  case "--help":
    console.log(HELP);
    break;
  default:
    await forward(command);
}
