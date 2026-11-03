import { mkdir, writeFile, readdir, lstat, realpath, readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { cpus, arch, release, totalmem } from "node:os";
import electron from "electron";
import { createHash } from "node:crypto";
import { launch, root, electrobunBundle } from "./driver.mjs";
import { startFixture } from "./fixture.mjs";
import { features, performanceSuite } from "./suite.mjs";
import { writeReport } from "./report.mjs";

if (process.platform !== "darwin" || arch() !== "arm64") {
  throw new Error(
    "This first benchmark runner targets macOS arm64. Configure the native Electrobun bundle path before running elsewhere.",
  );
}
const args = process.argv.slice(2);
const option = (name, fallback) =>
  args
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=") ?? fallback;
const runs = Number(option("runs", "5"));
const warmups = Number(option("warmups", "1"));
const selectedApp = option("app", "both");
if (!["both", "electron", "electrobun"].includes(selectedApp))
  throw new Error("Invalid app selection");
const included = (kind) => selectedApp === "both" || selectedApp === kind;
if (!Number.isSafeInteger(runs) || runs < 1 || !Number.isSafeInteger(warmups) || warmups < 0)
  throw new Error("Invalid run counts");
const output = resolve(root, option("output", "benchmarks/results/latest"));
await mkdir(join(output, "logs"), { recursive: true });
const { server, origin } = await startFixture();
let activeApp;
const cancel = async () => {
  await activeApp?.stop();
  server.closeAllConnections();
  server.close();
  process.exit(130);
};
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
const result = {
  schemaVersion: 1,
  recordedAt: new Date().toISOString(),
  machine: {
    platform: process.platform,
    arch: arch(),
    release: release(),
    cpu: cpus()[0].model,
    logicalCpus: cpus().length,
    memoryGiB: totalmem() / 1024 ** 3,
    node: process.version,
  },
  baselineCommit: "011d155",
  runs,
  warmups,
  versions: {},
  features: {},
  trials: [],
  warmupTrials: [],
  failures: [],
  methodology: [
    "Production-built Svelte assets; unsigned development desktop runtimes; no Vite dev server or HMR.",
    "One app at a time. One excluded warmup per app, then alternating Electron/Electrobun run order.",
    "CEF disables occluded-window backgrounding by default. Electron receives the matching --disable-backgrounding-occluded-windows flag so desktop overlap cannot suspend animation frames. Other background defaults are retained.",
    "Startup: OS spawn to interactive new-tab DOM plus two animation frames, observed over direct page CDP (25 ms discovery polling). Not cold disk-cache startup or physical screen presentation.",
    "Same no-store HTTP fixture: 300 rows, no external assets, network requests, fonts, or public websites.",
    "Electron gets a temporary user-data directory; Electrobun gets a unique storage partition. Electrobun still uses its shared CEF root/UI cache. OS caches are warm; this is not full-profile cold-start parity.",
    "RSS is summed across the detached OS process group, including launcher, backend, GPU, storage, network and renderer helpers. Shared pages can be counted more than once; this is not private memory/physical footprint.",
    "Idle CPU uses deltas in cumulative process-group CPU time over 2 seconds (1 second after tab close); 100% equals one CPU core. Very small differences are noisy.",
    "Page JS and DOM timings use performance.now inside the same fixture, with one excluded JS workload warmup. DOM metric includes forced layout, not GPU presentation.",
    "Tab switching: BrowserApi command through two requestAnimationFrame callbacks in the selected content page, including CDP discovery/transport. This is a responsiveness proxy, not input-to-photon latency.",
    "UI feature tests invoke real DOM form/button handlers or BrowserApi and use CDP to inspect content. Native OS menus/clipboard, live window resizing, DRM, extensions, downloads and session restore are not verified.",
    "These are the two prototype implementations on this host, not a framework-wide speed or security guarantee. Chromium versions and implementation architecture are recorded.",
  ],
};

const sha256 = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
result.artifacts = {
  electronMain: await sha256(join(root, "benchmarks/electron/electron/main.cjs")),
  electronUi: await sha256(join(root, "benchmarks/electron/dist/index.html")),
  electrobunMain: await sha256(join(electrobunBundle, "Contents/Resources/main.js")),
  electrobunUi: await sha256(
    join(electrobunBundle, "Contents/Resources/app/views/mainview/index.html"),
  ),
};

async function bytes(path, seen = new Set()) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) return 0;
  const canonical = await realpath(path);
  if (seen.has(canonical)) return 0;
  seen.add(canonical);
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  return (
    await Promise.all((await readdir(path)).map((name) => bytes(join(path, name), seen)))
  ).reduce((a, b) => a + b, 0);
}

try {
  if (!args.includes("--performance-only")) {
    for (const kind of ["electron", "electrobun"]) {
      if (!included(kind)) continue;
      console.log(`${kind}: testing browser features`);
      activeApp = await launch(kind, join(output, "logs", `${kind}-features.log`));
      try {
        result.versions[kind] = activeApp.version;
        result.features[kind] = await features(activeApp, origin);
      } finally {
        await activeApp.stop();
        activeApp = null;
      }
    }
  }
  if (!args.includes("--features-only")) {
    for (let round = -warmups; round < runs; round++) {
      const order = Math.abs(round) % 2 ? ["electrobun", "electron"] : ["electron", "electrobun"];
      for (const kind of order) {
        if (!included(kind)) continue;
        const label = round < 0 ? `warmup-${round + warmups + 1}` : `run-${round + 1}`;
        console.log(`${kind}: ${label}`);
        try {
          activeApp = await launch(kind, join(output, "logs", `${kind}-${label}.log`));
          const metrics = await performanceSuite(activeApp, origin);
          result.versions[kind] = activeApp.version;
          const trial = { kind, round, metrics };
          (round < 0 ? result.warmupTrials : result.trials).push(trial);
          console.log(
            `  startup ${metrics.startupMs.toFixed(0)} ms; RSS ${metrics.oneTab.rssMiB.toFixed(1)} / ${metrics.tenTabs.rssMiB.toFixed(1)} MiB (1 / 10 tabs)`,
          );
        } catch (error) {
          result.failures.push({ kind, round, error: error.message });
          console.error(`  failed: ${error.message}`);
        } finally {
          await activeApp?.stop();
          activeApp = null;
        }
      }
      await writeFile(join(output, "results.json"), JSON.stringify(result, null, 2) + "\n");
    }
  }
  result.distributionBytes = {
    electron:
      (await bytes(resolve(dirname(electron), "../.."))) +
      (await bytes(join(root, "benchmarks/electron/electron"))) +
      (await bytes(join(root, "benchmarks/electron/dist"))) +
      (await bytes(join(root, "benchmarks/electron/shared"))),
    electrobun: await bytes(electrobunBundle),
  };
  result.electrobunBuild = JSON.parse(
    await readFile(join(electrobunBundle, "Contents/Resources/build.json"), "utf8"),
  );
  await writeFile(join(output, "results.json"), JSON.stringify(result, null, 2) + "\n");
  await writeReport(result, output);
  console.log(`Report: ${join(output, "report.html")}`);
  if (
    result.failures.length ||
    Object.values(result.features)
      .flat()
      .some((check) => check.status === "fail")
  )
    process.exitCode = 1;
} finally {
  await activeApp?.stop();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
