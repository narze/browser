export const browserBenchSuites = [
  {
    id: "speedometer",
    name: "Speedometer 3.1",
    url: "https://www.browserbench.org/Speedometer3.1/",
    ready:
      "typeof benchmarkClient !== 'undefined' && typeof document.querySelector('.start-tests-button')?.onclick === 'function'",
    start: "document.querySelector('.start-tests-button').click()",
    install: function () {
      const done = benchmarkClient.didFinishLastIteration;
      benchmarkClient.didFinishLastIteration = function (...args) {
        const result = done.apply(this, args);
        window.__browserBenchSignal(JSON.stringify({ type: "complete" }));
        return result;
      };
      const failed = benchmarkClient.handleError;
      benchmarkClient.handleError = function (error) {
        failed.call(this, error);
        window.__browserBenchSignal(JSON.stringify({ type: "error", message: String(error) }));
      };
    },
    extract: async function () {
      const { params, defaultParams } = await import(
        new URL("resources/params.mjs", location.href)
      );
      return {
        score: benchmarkClient._computeResults(benchmarkClient._measuredValuesList, "score").mean,
        displayedScore: document.querySelector("#result-number").textContent,
        confidence: document.querySelector("#confidence-number").textContent,
        valid: document.querySelector("#summary").classList.contains("valid"),
        parameters: { ...params },
        defaults: { ...defaultParams },
        suiteCount: benchmarkClient.suitesCount,
        completedSteps: benchmarkClient._finishedTestCount,
        expectedSteps: benchmarkClient.stepCount,
        iterations: benchmarkClient._measuredValuesList,
        metrics: benchmarkClient.metrics,
      };
    },
  },
  {
    id: "jetstream",
    name: "JetStream 3.0",
    url: "https://www.browserbench.org/JetStream3.0/",
    ready:
      "typeof JetStream !== 'undefined' && JetStream.isReady && globalThis.allIsGood && !document.querySelector('#status').classList.contains('error')",
    start: "document.querySelector('#status').click()",
    install: function () {
      window.addEventListener(
        "JetStreamDone",
        () => {
          window.__browserBenchSignal(JSON.stringify({ type: "complete" }));
        },
        { once: true },
      );
      window.addEventListener("unhandledrejection", (event) => {
        window.__browserBenchSignal(
          JSON.stringify({ type: "error", message: String(event.reason) }),
        );
      });
    },
    extract: function () {
      const displayedScore = document.querySelector("#result-summary > .score")?.textContent;
      return {
        score: Number(displayedScore?.replaceAll(",", "")),
        displayedScore,
        valid: JetStream.isDone && JetStream.errors.length === 0 && globalThis.allIsGood,
        defaultParameters: JetStreamParams.isDefault,
        parameters: { ...JetStreamParams },
        errors: JetStream.errors,
        benchmarks: JetStream.benchmarks.map((benchmark) => ({
          name: benchmark.name,
          done: benchmark.isDone,
          success: benchmark.isSuccess,
          score: benchmark.score,
        })),
        results: JetStream.resultsObject(),
      };
    },
  },
  {
    id: "motionmark",
    name: "MotionMark 1.3.2",
    url: "https://www.browserbench.org/MotionMark1.3.2/",
    ready:
      "typeof benchmarkController !== 'undefined' && document.readyState === 'complete' && !!benchmarkController._startButton && benchmarkController._startButton === document.querySelector('#start-button') && !benchmarkController._startButton.disabled",
    start: "document.querySelector('#start-button').click()",
    install: function () {
      const done = benchmarkRunnerClient.didFinishLastIteration;
      benchmarkRunnerClient.didFinishLastIteration = function (...args) {
        const result = done.apply(this, args);
        window.__browserBenchSignal(JSON.stringify({ type: "complete" }));
        return result;
      };
    },
    extract: function () {
      const dashboard = benchmarkRunnerClient.results;
      return {
        score: dashboard.score,
        displayedScore: document.querySelector("#results .score")?.textContent,
        valid: Number.isFinite(dashboard.score) && dashboard.score > 0,
        version: dashboard.version,
        frameRate: dashboard._targetFrameRate,
        systemFrameRate: dashboard._systemFrameRate,
        confidence: { low: dashboard.scoreLowerBound, high: dashboard.scoreUpperBound },
        options: dashboard.options,
        results: dashboard.results,
        samples: dashboard.data,
        testResults: dashboard.results.map((iteration) => iteration[Strings.json.results.tests]),
        expectedTests: Suites.filter((suite) => !suite.disabled).map((suite) => ({
          name: suite.name,
          tests: suite.tests.filter((test) => !test.disabled).map((test) => test.name),
        })),
      };
    },
  },
];

export function validateBrowserBenchResult(id, raw) {
  if (!raw.valid || !Number.isFinite(raw.score) || raw.score <= 0)
    throw new Error("Suite did not produce a valid positive overall score");
  if (id === "speedometer") {
    if (
      raw.iterations.length !== 10 ||
      raw.parameters.iterationCount !== 10 ||
      raw.parameters.suites.length ||
      raw.parameters.tags.length ||
      raw.parameters.developerMode ||
      JSON.stringify(raw.parameters) !== JSON.stringify(raw.defaults) ||
      raw.completedSteps !== raw.expectedSteps
    )
      throw new Error("Speedometer did not complete the full default ten-iteration workload");
  } else if (id === "jetstream") {
    if (
      !raw.defaultParameters ||
      !raw.benchmarks.length ||
      raw.benchmarks.some(
        (benchmark) =>
          !benchmark.done ||
          !benchmark.success ||
          !Number.isFinite(benchmark.score) ||
          benchmark.score <= 0,
      )
    )
      throw new Error("JetStream is incomplete, has a failed subtest, or uses custom parameters");
  } else if (id === "motionmark") {
    if (
      !Number.isFinite(raw.frameRate) ||
      raw.frameRate <= 0 ||
      raw.frameRate !== raw.systemFrameRate ||
      raw.frameRate !== raw.options["frame-rate"] ||
      raw.systemFrameRate !== raw.options["system-frame-rate"]
    )
      throw new Error("MotionMark frame-rate calibration was incomplete or changed during the run");
    const tests = raw.testResults.flatMap((iteration) =>
      Object.values(iteration).flatMap((tests) => Object.keys(tests)),
    );
    const expected = raw.expectedTests.flatMap((suite) => suite.tests);
    if (
      raw.results.length !== 1 ||
      expected.length !== 8 ||
      tests.length !== 8 ||
      expected.some((test) => !tests.includes(test)) ||
      raw.options["test-interval"] !== 30 ||
      raw.options.controller !== "ramp"
    )
      throw new Error("MotionMark did not complete all eight default 30-second tests");
  } else throw new Error(`Unknown BrowserBench suite: ${id}`);
  return raw.score;
}

export function validateBrowserBenchEnvironment(trial) {
  if (trial.environment.focused !== true || trial.environment.visibility !== "visible")
    throw new Error("Benchmark page was not focused and visible immediately before start");
  if (trial.hiddenDuringRun) throw new Error("Benchmark page became hidden during the run");
  const geometry = (environment) => [environment.width, environment.height, environment.dpr];
  if (
    JSON.stringify(geometry(trial.environment)) !== JSON.stringify(geometry(trial.endedEnvironment))
  )
    throw new Error("Benchmark viewport or device scale changed during the run");
}
