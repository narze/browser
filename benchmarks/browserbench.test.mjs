import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { summarizeBrowserBench } from "./browserbench-report.mjs";
import {
  browserBenchSuites,
  validateBrowserBenchEnvironment,
  validateBrowserBenchResult,
} from "./browserbench-suites.mjs";

test("a false pre-start focus flag is rejected even when the page stayed visible", () => {
  const environment = { width: 1280, height: 750, dpr: 2, focused: false, visibility: "visible" };
  assert.throws(
    () =>
      validateBrowserBenchEnvironment({
        environment,
        endedEnvironment: environment,
        hiddenDuringRun: false,
      }),
    /not focused/,
  );
  environment.focused = true;
  assert.doesNotThrow(() =>
    validateBrowserBenchEnvironment({
      environment,
      endedEnvironment: { ...environment, focused: false },
      hiddenDuringRun: false,
    }),
  );
});

test("MotionMark's initially enabled button does not count as completed calibration", () => {
  const suite = browserBenchSuites.find((suite) => suite.id === "motionmark");
  const button = { disabled: false };
  const context = {
    benchmarkController: {},
    document: { readyState: "complete", querySelector: () => button },
  };
  assert.equal(runInNewContext(suite.ready, context), false);
  context.benchmarkController._startButton = button;
  button.disabled = true;
  assert.equal(runInNewContext(suite.ready, context), false);
  button.disabled = false;
  assert.equal(runInNewContext(suite.ready, context), true);
});

test("a MotionMark pass whose frame-rate options changed after start is rejected", () => {
  const names = [
    "Multiply",
    "Canvas Arcs",
    "Leaves",
    "Paths",
    "Canvas Lines",
    "Images",
    "Design",
    "Suits",
  ];
  assert.throws(
    () =>
      validateBrowserBenchResult("motionmark", {
        valid: true,
        score: 48,
        frameRate: 60,
        systemFrameRate: 60,
        options: {
          "test-interval": 30,
          controller: "ramp",
          "frame-rate": 120,
          "system-frame-rate": 120,
        },
        results: [{}],
        testResults: [{ MotionMark: Object.fromEntries(names.map((name) => [name, {}])) }],
        expectedTests: [{ name: "MotionMark", tests: names }],
      }),
    /calibration/,
  );
});

test("a shortened Speedometer pass is rejected even when it has a positive score", () => {
  const parameters = { iterationCount: 1, suites: [], tags: [], developerMode: false };
  assert.throws(
    () =>
      validateBrowserBenchResult("speedometer", {
        valid: true,
        score: 100,
        iterations: [{ score: 100 }],
        parameters,
        defaults: parameters,
        completedSteps: 3,
        expectedSteps: 3,
      }),
    /full default ten-iteration/,
  );
});

test("JetStream with one failed workload is rejected rather than reporting a partial score", () => {
  assert.throws(
    () =>
      validateBrowserBenchResult("jetstream", {
        valid: true,
        score: 100,
        defaultParameters: true,
        benchmarks: [
          { name: "passed", done: true, success: true, score: 100 },
          { name: "failed", done: true, success: false, score: 80 },
        ],
      }),
    /failed subtest/,
  );
});

const geometry = { width: 1280, height: 750, dpr: 2 };
const trial = (kind, score, frameRate = 60) => ({
  kind,
  suite: "motionmark",
  score,
  frameRate,
  status: "complete",
  environment: geometry,
});
const sample = (trials, runs = 1) => ({
  runs,
  suites: [{ id: "motionmark", name: "MotionMark 1.3.2" }],
  trials,
});

test("MotionMark scores at different target frame rates are not ranked", () => {
  const [summary] = summarizeBrowserBench(
    sample([trial("electron", 100, 60), trial("electrobun", 200, 120)]),
  );
  assert.equal(summary.comparable, false);
  assert.equal(summary.cefDifferencePercent, null);
  assert.ok(summary.reasons.includes("MotionMark target frame rates differ"));
});

test("an interrupted run is retained as incomplete and cannot produce a comparative percentage", () => {
  const [summary] = summarizeBrowserBench(
    sample([
      trial("electron", 100),
      { ...trial("electrobun", 200), status: "failed", error: "timeout" },
    ]),
  );
  assert.equal(summary.apps.electrobun.n, 0);
  assert.equal(summary.apps.electrobun.median, null);
  assert.equal(summary.cefDifferencePercent, null);
});

test("summaries use the median of full passes and retain every score", () => {
  const [summary] = summarizeBrowserBench(
    sample(
      [
        ...[100, 110, 900].map((score) => trial("electron", score)),
        ...[90, 100, 120].map((score) => trial("electrobun", score)),
      ],
      3,
    ),
  );
  assert.equal(summary.apps.electron.median, 110);
  assert.equal(summary.apps.electrobun.median, 100);
  assert.deepEqual(summary.apps.electron.scores, [100, 110, 900]);
  assert.ok(Math.abs(summary.cefDifferencePercent - -100 / 11) < 1e-9);
});
