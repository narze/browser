# Electron / Electrobun + CEF benchmark

This compares two copies of the browser at **Electron commit `011d155`** (top, left and right tabs). It deliberately does not follow ongoing work in the root application. `electron/` is an unchanged source snapshot; `../experiments/electrobun/` ports its Svelte UI, address handling and browser controls to Electrobun 2.0.5 with Bun and CEF.

The [recorded baseline and decision](baselines/2026-11-04.md) include the measured results, feature outcomes and machine-readable samples. Electron remains the main application; the CEF port stays experimental.

From the repository root, with Node, pnpm and Bun installed:

```sh
node benchmarks/prepare.mjs
node benchmarks/run.mjs
```

The second command runs both apps sequentially, one excluded warmup and five measurements each, alternating order. Native windows will open. Avoid interacting with the benchmark windows while it runs. Results, raw samples and charts are written to `results/latest/{results.json,report.md,report.html}`. Logs are retained locally in the ignored `logs/` directory. No server remains running after the benchmark exits.

The runner currently supports **macOS arm64**. It launches each native runtime directly, uses Chromium's page DevTools sockets for the same tests, and sums OS process-group RSS and CPU time across the launcher and all child processes. No Playwright-specific patches or debugging adapters are added to either application. The benchmark temporarily enables CDP on a random loopback port and removes its temporary profile/partition afterward.

Other commands:

```sh
node benchmarks/run.mjs --features-only
node benchmarks/run.mjs --performance-only --runs=10 --warmups=2
node benchmarks/run.mjs --app=electrobun --features-only
node benchmarks/run.mjs --runs=3 --output=benchmarks/results/my-run
node benchmarks/smoke-development.mjs
node benchmarks/browserbench.mjs
node benchmarks/browserbench.mjs --resume
```

A nonzero exit status means an automated behavior check or a measured run failed. The report still gets written. `manual`, `not-tested`, and `unsupported` are separate statuses and do not count as automated passes.

The development smoke test starts Vite on port 5187, opens the CEF app against it, verifies a live CSS HMR change and concurrent tab closes, restores the CSS file, and shuts down its own app/server. It leaves another application's server on port 5173 alone.

## BrowserBench

`node benchmarks/browserbench.mjs` runs the official HTTPS [BrowserBench](https://www.browserbench.org/) suites in the two native applications:

- [Speedometer 3.1](https://www.browserbench.org/Speedometer3.1/): all twenty default suites, ten iterations and 580 measured test steps.
- [JetStream 3.0](https://www.browserbench.org/JetStream3.0/): every default JavaScript/WebAssembly workload; failed or partial suites are rejected.
- [MotionMark 1.3.2](https://www.browserbench.org/MotionMark1.3.2/): all eight default 30-second graphics tests, with automatic frame-rate detection.

By default there are **three complete passes per app/suite**, alternating app order, with a fresh process/profile or partition per pass and a ten-second gap. Native windows stay in the foreground while tests run. The runner temporarily prevents display sleep. No test duration, iteration count, suite selection, GPU flag or score formula is changed. Completion hooks only notify the runner after the official suite finishes; it does not poll the renderer during measurements.

This can take tens of minutes. Keep the machine on AC power and avoid interacting with the benchmark windows. Other apps are left running; this is a desktop comparison, not a controlled lab measurement.

```sh
node benchmarks/browserbench.mjs
node benchmarks/browserbench.mjs --suites=speedometer --runs=3
node benchmarks/browserbench.mjs --suites=jetstream,motionmark --app=electrobun --runs=1
node benchmarks/browserbench.mjs --runs=5 --cooldown=15 --output=benchmarks/results/browserbench-repeat
node --test benchmarks/browserbench.test.mjs
```

Results go to `results/browserbench/`: `report.html`, `report.md`, `results.json`, full official data in `raw/`, and screenshots of completed results in `screenshots/`. Higher scores are better. The report retains every full-pass score and reports medians and sample counts; incomplete trials never become zero scores. A nonzero exit status records an incomplete or failed suite.

`--resume` checks app artifact hashes and suite selection, verifies checksums and default-workload validity of existing raw results, and runs only the remaining passes. Invalid/interrupted attempts retain their original files and appear separately in the report. MotionMark readiness waits for its initialized controller and completed frame-rate calibration; the initially enabled HTML Start button alone is insufficient. The validator rejects a run whose dashboard and final parameter frame rates disagree.

The runner activates the app and selects its native tab before checking `document.hasFocus()` and visibility. If needed, it clicks the page margin to restore content focus. DOM `focus()` alone cannot restore focus from Electron's browser controls to its native child view. A pass with a false pre-start focus flag is rejected, and its viewport/device scale must remain unchanged through completion. Resumed retries fill missing passes later; per-pass timestamps preserve the actual execution order.

MotionMark scores are not ranked if its detected target frame rates differ between apps. Viewport/device scale mismatches or a page becoming hidden also suppress the comparative percentage. Each trial records the real environment, focus/visibility, power source, Chromium version and artifact hashes. Raw data and screenshots are captured after score calculation. CDP stays attached during tests, so the results should be interpreted as automated native-app measurements.

The suites themselves determine what they measure: these are performance scores, not additional browser compatibility or security checks. Native-menu, network-error and sandbox findings from the local feature suite remain separate.

## Local benchmark coverage

- Launch to interactive new-tab UI and two animation frames.
- Local navigation to a 300-row deterministic page; DOM content/load/FCP timings when available.
- One-tab and ten-tab idle RSS, observed peak RSS, process count, and CPU time deltas.
- A JavaScript array/sort workload and insertion/layout of 3,000 DOM rows.
- Switching between loaded tabs and release of native page targets after closing nine tabs.
- Real browser behaviors: address form, titles, navigation links, history, reload, top/left/right tab layout, popups, iframe and SPA navigation, scheme restrictions, stop/error states, cross-tab storage, workers, WebAssembly, canvas/WebGL2 and editable controls.
- Application bridge isolation and the renderer process's OS-sandbox command-line setting, recorded separately.

## Local measurement limits

These are measurements of two **prototypes**, using optimized Svelte assets inside unsigned **development** desktop runtimes. They are not production installer benchmarks or an inherent speed ranking of the two frameworks.

OS disk caches are warm. Electron uses a temporary full user-data directory; Electrobun uses a fresh named persistent partition for tab storage, but keeps its shared CEF root/UI cache. CEF disables occluded-window backgrounding by default, so Electron receives that same flag for the benchmark. No other background settings are normalized. Both apps use their own Chromium version, recorded in the JSON.

RSS sums may count shared memory more than once; they are not private memory or physical footprint. Idle CPU over short windows is noisy. Startup/navigation/tab-switch timings include automation and observation overhead. Two animation frames do not establish when pixels appeared on the physical screen. Background ten-tab behavior is part of the implementations being compared.

Public websites, network variability, DRM, Chrome extensions, downloads, session restore, native window resizing, native menu keyboard shortcuts and clipboard integration are outside the automated checks. A green Node/Bun/bridge-isolation check does **not** establish a Chromium OS sandbox or production browser security.

The Electrobun port's README describes its macOS tab-close workaround and network-error/OS-sandbox limitations. Read feature failures alongside the timing charts.
