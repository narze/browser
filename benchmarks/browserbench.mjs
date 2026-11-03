import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { arch, cpus, loadavg, release, totalmem } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { launch, root, electrobunBundle } from "./driver.mjs";
import { until } from "./cdp.mjs";
import {
  browserBenchSuites,
  validateBrowserBenchEnvironment,
  validateBrowserBenchResult,
} from "./browserbench-suites.mjs";
import { attachBrowserBenchReport, writeBrowserBenchReport } from "./browserbench-report.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const runs = Number(option("runs", "3"));
const cooldown = Number(option("cooldown", "10"));
const timeout = Number(option("timeout", "1200"));
const appFilter = option("app", "both");
const suiteFilter = option("suites", "speedometer,jetstream,motionmark").split(",");
if (process.platform !== "darwin" || arch() !== "arm64")
  throw new Error("This runner currently targets macOS arm64.");
if (
  !Number.isSafeInteger(runs) ||
  runs < 1 ||
  !Number.isFinite(cooldown) ||
  cooldown < 0 ||
  cooldown > 60 ||
  !Number.isFinite(timeout) ||
  timeout < 1
)
  throw new Error("Invalid runs/cooldown/timeout parameters");
if (
  !["both", "electron", "electrobun"].includes(appFilter) ||
  suiteFilter.some((id) => !browserBenchSuites.some((suite) => suite.id === id))
)
  throw new Error("Unknown app or suite filter");
const suites = browserBenchSuites.filter((suite) => suiteFilter.includes(suite.id));
const output = resolve(root, option("output", "benchmarks/results/browserbench"));
await Promise.all(
  ["logs", "raw", "screenshots"].map((name) => mkdir(join(output, name), { recursive: true })),
);
const hash = (data) => createHash("sha256").update(data).digest("hex");
const artifactHash = async (path) => hash(await readFile(path));
const power = () => execFileSync("pmset", ["-g", "batt"], { encoding: "utf8" }).trim();
const result = {
  schemaVersion: 1,
  recordedAt: new Date().toISOString(),
  baselineCommit: "011d155",
  runs,
  appFilter,
  cooldownSeconds: cooldown,
  timeoutSeconds: timeout,
  machine: {
    cpu: cpus()[0].model,
    logicalCpus: cpus().length,
    arch: arch(),
    release: release(),
    memoryGiB: totalmem() / 1024 ** 3,
    node: process.version,
    power: power(),
  },
  suites: suites.map(({ id, name, url }) => ({ id, name, url })),
  versions: {},
  trials: [],
  attempts: [],
  artifacts: {
    electronMain: await artifactHash(join(root, "benchmarks/electron/electron/main.cjs")),
    electronUi: await artifactHash(join(root, "benchmarks/electron/dist/index.html")),
    electrobunMain: await artifactHash(join(electrobunBundle, "Contents/Resources/main.js")),
    electrobunUi: await artifactHash(
      join(electrobunBundle, "Contents/Resources/app/views/mainview/index.html"),
    ),
  },
  methodology: [
    "Official HTTPS BrowserBench pages, full default workloads: Speedometer 3.1 (ten iterations), JetStream 3.0 (every default subtest), MotionMark 1.3.2 (all eight 30-second tests, automatic frame-rate detection). No shortened tests, custom suite filters, iteration overrides, or GPU/backend flags.",
    `Each full pass uses a new app process and a fresh browsing profile/partition. ${runs} passes per app/suite, with alternating app order in the planned schedule. Resumed retries fill missing slots later; per-pass timestamps preserve the actual chronology. Suite-internal warmups are retained; no separate full-pass warmup in this measurement loop. A ${cooldown}-second gap separates full passes. Separate full-workload adapter validation passes may precede the recorded comparison.`,
    "Same pinned Electron snapshot and Electrobun + CEF prototype as the local benchmark, optimized Svelte assets inside unsigned development desktop runtimes. Artifact hashes and actual Chromium versions are recorded.",
    "CEF disables occluded-window backgrounding by default; Electron receives the matching flag. Other browser/runtime defaults are retained. No headless mode or emulated viewport. Native app activation, Page.bringToFront and native tab selection are used before starting each test, with a normal page-margin click if needed to restore content focus; document focus and visible state are required before start.",
    "Default viewport is 1280 × 750 content pixels; actual viewport, screen, device scale, focus and visibility are recorded for each pass. MotionMark comparisons are withheld when detected target frame rates differ, viewport/scale differs, or a page becomes hidden.",
    "Completion callbacks/events are observed without changing workloads, score calculation or benchmark settings. A CDP binding signals completion; the runner does not poll the renderer while a benchmark is running. Data serialization and screenshots happen after completion.",
    "Scores are the suite's official overall scores; higher is better. The report shows median, every full-pass score and sample counts. JetStream's displayed score is rounded by its own UI; full per-subtest results are preserved.",
    "OS caches are warm. Electron uses a temporary full profile; Electrobun uses a unique named persistent tab partition but retains its CEF root/UI cache. Page resources come from the public HTTPS site, so network/cache conditions are not fully controlled.",
    "This is a normal desktop session, not a thermally controlled lab run. Power source, system load and browser versions are recorded. Other applications are not closed, and system power/refresh settings are not changed. Caffeinate keeps the display/system awake only while the runner is alive.",
    "These are measurements of the two prototype implementations on this Mac. They do not establish a framework-wide performance ranking, feature parity, or production browser security.",
    "MotionMark starts only after its controller has finished frame-rate calibration. Dashboard, system and final option frame rates must agree. Invalid/interrupted attempts are retained separately and excluded from summaries; --resume revalidates stored raw results before reusing completed passes.",
  ],
};
if (args.includes("--resume")) {
  const saved = JSON.parse(await readFile(join(output, "results.json"), "utf8"));
  assert.deepEqual(
    saved.artifacts,
    result.artifacts,
    "Cannot resume with different application artifacts",
  );
  assert.deepEqual(
    saved.suites,
    result.suites,
    "Cannot resume with different suite selection or versions",
  );
  assert.equal(saved.runs, result.runs, "Cannot resume with a different requested run count");
  assert.equal(saved.cooldownSeconds, cooldown, "Cannot resume with a different cooldown interval");
  assert.equal(
    saved.appFilter || "both",
    appFilter,
    "Cannot resume with a different app selection",
  );
  assert.equal(saved.machine.cpu, result.machine.cpu, "Cannot resume on a different CPU");
  assert.equal(
    saved.machine.arch,
    result.machine.arch,
    "Cannot resume on a different architecture",
  );
  result.recordedAt = saved.recordedAt;
  result.versions = saved.versions;
  result.resumptions = [...(saved.resumptions || []), new Date().toISOString()];
  result.attempts = saved.attempts || [];
  for (const trial of saved.trials) {
    if (trial.status === "complete") {
      try {
        const data = await readFile(join(output, trial.rawFile), "utf8");
        assert.equal(hash(data), trial.rawSha256, "Raw result checksum mismatch");
        const raw = JSON.parse(data);
        assert.equal(
          validateBrowserBenchResult(trial.suite, raw),
          trial.score,
          "Saved score does not match the raw result",
        );
        validateBrowserBenchEnvironment(trial);
        result.trials.push(trial);
        continue;
      } catch (error) {
        trial.status = "invalid";
        trial.error = error.message;
      }
    } else if (trial.status === "running") {
      trial.status = "interrupted";
      trial.error = "Runner interrupted before the suite completed";
    }
    result.attempts.push(trial);
  }
  console.log(
    `Resuming ${result.trials.length} validated completed passes; ${result.attempts.length} excluded attempts retained.`,
  );
}
let activeApp;
let canceled = false;
const awake = spawn("caffeinate", ["-di", "-w", String(process.pid)], { stdio: "ignore" });
awake.on("error", (error) => console.warn(`Could not inhibit display sleep: ${error.message}`));
const cancel = async () => {
  if (canceled) return;
  canceled = true;
  console.log("Stopping BrowserBench and saving partial results.");
  await activeApp?.stop();
  awake.kill();
  await writeBrowserBenchReport(result, output);
  process.exit(130);
};
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);

function foreground(app) {
  let pid = app.pid;
  if (app.kind === "electrobun") {
    const rows = execFileSync("ps", ["-axo", "pid=,pgid=,comm="], { encoding: "utf8" }).split("\n");
    const row = rows
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
      .find(
        (row) =>
          row &&
          Number(row[2]) === app.pid &&
          row[3] === join(electrobunBundle, "Contents/MacOS/bun"),
      );
    if (row) pid = Number(row[1]);
  }
  try {
    return execFileSync(
      "osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        `ObjC.import('AppKit'); const app=$.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}); app.activateWithOptions(3);`,
      ],
      { encoding: "utf8" },
    ).trim();
  } catch (error) {
    return error.message;
  }
}

async function environment(page) {
  return page.evaluate(`({url:location.href,title:document.title,userAgent:navigator.userAgent,
    width:innerWidth,height:innerHeight,dpr:devicePixelRatio,screenWidth:screen.width,screenHeight:screen.height,
    colorDepth:screen.colorDepth,hardwareConcurrency:navigator.hardwareConcurrency,
    focused:document.hasFocus(),visibility:document.visibilityState})`);
}

async function runSuite(app, suite, trial) {
  await app.api("navigate", suite.url);
  const target = await until(
    async () =>
      (await app.targets()).find(
        (target) => target.type === "page" && target.url.startsWith(suite.url),
      ),
    "BrowserBench page target",
    90000,
  );
  const page = await app.connect(target);
  await until(() => page.evaluate(suite.ready), `${suite.name} assets and controls ready`, 180000);
  trial.activation = foreground(app);
  await page.send("Page.bringToFront").catch((error) => {
    trial.bringToFrontError = error.message;
  });
  await page.evaluate("window.focus()");
  // Activating the window does not necessarily focus its native child view.
  await app.api("selectTab", (await app.state()).activeId);
  await page.evaluate(
    "document.querySelector('#start-button, .start-tests-button, #status a')?.focus()",
  );
  trial.focusBeforeInput = await environment(page);
  if (!trial.focusBeforeInput.focused) {
    // A real content click also transfers focus from native browser controls.
    // The top-left page margin is outside the suites' interactive controls.
    trial.focusInputElement = await page.evaluate("document.elementFromPoint(8, 8)?.tagName");
    await page.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: 8,
      y: 8,
      button: "left",
      clickCount: 1,
    });
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: 8,
      y: 8,
      button: "left",
      clickCount: 1,
    });
  }
  await until(
    () => page.evaluate("document.hasFocus() && document.visibilityState === 'visible'"),
    "native benchmark focus",
    10000,
  );
  trial.environment = await environment(page);
  if (suite.id === "motionmark")
    trial.settingsBefore = await page.evaluate(
      "({...benchmarkController.benchmarkDefaultParameters})",
    );
  if (trial.environment.visibility !== "visible") throw new Error("Benchmark page is not visible");
  const diagnostics = [];
  let resolveCompletion;
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });
  const onMessage = ({ data }) => {
    const message = JSON.parse(data);
    if (
      message.method === "Runtime.bindingCalled" &&
      message.params.name === "__browserBenchSignal"
    ) {
      try {
        resolveCompletion(JSON.parse(message.params.payload));
      } catch (error) {
        resolveCompletion({ type: "error", message: error.message });
      }
    } else if (message.method === "Runtime.exceptionThrown" && diagnostics.length < 100) {
      const detail = message.params.exceptionDetails;
      diagnostics.push(detail.exception?.description || detail.text);
    }
  };
  page.socket.addEventListener("message", onMessage);
  await page.send("Runtime.enable");
  await page.send("Runtime.addBinding", { name: "__browserBenchSignal" });
  await page.evaluate(
    `window.__browserBenchVisibility=[]; document.addEventListener('visibilitychange',()=>window.__browserBenchVisibility.push({at:performance.now(),state:document.visibilityState})); (${suite.install.toString()})()`,
  );
  const started = performance.now();
  const progress = setInterval(
    () =>
      console.log(
        `  ${trial.kind} ${suite.name} run ${trial.round + 1}: ${Math.round((performance.now() - started) / 1000)}s elapsed`,
      ),
    30000,
  );
  let timer;
  try {
    // Start returns immediately; the official completion hook resolves the wait.
    await page.evaluate(suite.start);
    const signal = await Promise.race([
      completion,
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ type: "error", message: `Suite exceeded ${timeout}s timeout` }),
          timeout * 1000,
        );
      }),
    ]);
    if (signal.type !== "complete") throw new Error(signal.message || "Suite did not complete");
    trial.durationMs = performance.now() - started;
    const extracted = await page.send(
      "Runtime.evaluate",
      { expression: `(${suite.extract.toString()})()`, awaitPromise: true, returnByValue: true },
      30000,
    );
    if (extracted.exceptionDetails)
      throw new Error(
        extracted.exceptionDetails.exception?.description || extracted.exceptionDetails.text,
      );
    const raw = extracted.result.value;
    trial.endedEnvironment = await environment(page);
    trial.visibilityChanges = await page.evaluate("window.__browserBenchVisibility");
    trial.hiddenDuringRun = trial.visibilityChanges.some((change) => change.state === "hidden");
    validateBrowserBenchEnvironment(trial);
    trial.diagnostics = diagnostics;
    trial.frameRate = raw.frameRate;
    trial.observedScore = raw.score;
    trial.confidence = raw.confidence;
    trial.rawFile = `raw/${trial.label}.json`;
    const rawText = JSON.stringify(raw, null, 2) + "\n";
    trial.rawSha256 = hash(rawText);
    await writeFile(join(output, trial.rawFile), rawText);
    trial.score = validateBrowserBenchResult(suite.id, raw);
    const capture = await page.send(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: false },
      15000,
    );
    trial.screenshot = `screenshots/${trial.label}.png`;
    await writeFile(join(output, trial.screenshot), Buffer.from(capture.data, "base64"));
    trial.status = "complete";
  } finally {
    clearTimeout(timer);
    clearInterval(progress);
    page.socket.removeEventListener("message", onMessage);
    trial.diagnostics = diagnostics;
  }
}

try {
  await writeBrowserBenchReport(result, output);
  for (const [suiteIndex, suite] of suites.entries()) {
    for (let round = 0; round < runs; round++) {
      const order =
        (round + suiteIndex) % 2 ? ["electrobun", "electron"] : ["electron", "electrobun"];
      for (const kind of order) {
        if (appFilter !== "both" && kind !== appFilter) continue;
        if (
          result.trials.some(
            (trial) =>
              trial.suite === suite.id &&
              trial.kind === kind &&
              trial.round === round &&
              trial.status === "complete",
          )
        )
          continue;
        const baseLabel = `${suite.id}-${kind}-${round + 1}`;
        const used = new Set([...result.trials, ...result.attempts].map((trial) => trial.label));
        let label = baseLabel;
        let attempt = 1;
        while (used.has(label)) label = `${baseLabel}-attempt-${++attempt}`;
        const trial = {
          kind,
          suite: suite.id,
          round,
          label,
          status: "running",
          startedAt: new Date().toISOString(),
          loadBefore: loadavg(),
          powerBefore: power(),
        };
        result.trials.push(trial);
        await writeBrowserBenchReport(result, output);
        console.log(`${suite.name}: ${kind} run ${round + 1}/${runs}`);
        try {
          activeApp = await launch(kind, join(output, "logs", `${trial.label}.log`));
          if (result.versions[kind])
            assert.equal(
              activeApp.version,
              result.versions[kind],
              "Browser version changed between passes",
            );
          result.versions[kind] = activeApp.version;
          await runSuite(activeApp, suite, trial);
          console.log(
            `  score ${trial.score.toFixed(3)}${trial.frameRate ? ` @ ${trial.frameRate} fps` : ""}; ${(trial.durationMs / 1000).toFixed(1)}s`,
          );
        } catch (error) {
          trial.status = "failed";
          trial.error = error.message;
          console.error(`  FAILED: ${error.message}`);
        } finally {
          trial.finishedAt = new Date().toISOString();
          trial.loadAfter = loadavg();
          trial.powerAfter = power();
          await activeApp?.stop();
          activeApp = null;
          await writeBrowserBenchReport(result, output);
        }
        if (cooldown) await delay(cooldown * 1000);
      }
    }
  }
  result.completedAt = new Date().toISOString();
  await writeBrowserBenchReport(result, output);
  const attached = await attachBrowserBenchReport(
    result,
    output,
    join(root, "benchmarks/results/latest"),
  );
  if (attached) console.log("Added BrowserBench scores to the existing local benchmark report.");
  console.log(`BrowserBench report: ${join(output, "report.html")}`);
  if (result.trials.some((trial) => trial.status !== "complete")) process.exitCode = 1;
} finally {
  await activeApp?.stop();
  awake.kill();
}
