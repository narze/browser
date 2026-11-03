import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { writeReport } from "./report.mjs";

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2
    : null;
};
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

export function summarizeBrowserBench(result) {
  return result.suites.map((suite) => {
    const apps = Object.fromEntries(
      ["electron", "electrobun"].map((kind) => {
        const trials = result.trials.filter(
          (trial) => trial.suite === suite.id && trial.kind === kind && trial.status === "complete",
        );
        const scores = trials.map((trial) => trial.score);
        return [
          kind,
          {
            n: scores.length,
            median: median(scores),
            min: scores.length ? Math.min(...scores) : null,
            max: scores.length ? Math.max(...scores) : null,
            scores,
            frameRates: [
              ...new Set(
                trials.map((trial) => trial.frameRate).filter((value) => value !== undefined),
              ),
            ],
          },
        ];
      }),
    );
    const trials = result.trials.filter(
      (trial) => trial.suite === suite.id && trial.status === "complete",
    );
    const frameRates = [
      ...new Set(trials.map((trial) => trial.frameRate).filter((value) => value !== undefined)),
    ];
    const geometries = [
      ...new Set(
        trials.map((trial) =>
          JSON.stringify([
            trial.environment.width,
            trial.environment.height,
            trial.environment.dpr,
          ]),
        ),
      ),
    ];
    const reasons = [];
    if (apps.electron.n !== result.runs || apps.electrobun.n !== result.runs)
      reasons.push("Incomplete set of requested runs");
    if (geometries.length > 1) reasons.push("Viewport or display scale differs");
    if (suite.id === "motionmark" && frameRates.length > 1)
      reasons.push("MotionMark target frame rates differ");
    if (trials.some((trial) => trial.hiddenDuringRun))
      reasons.push("A benchmark page was hidden during a run");
    return {
      ...suite,
      apps,
      frameRates,
      comparable: reasons.length === 0,
      reasons,
      cefDifferencePercent:
        reasons.length === 0 ? 100 * (apps.electrobun.median / apps.electron.median - 1) : null,
    };
  });
}

export async function writeBrowserBenchReport(result, output) {
  result.summary = summarizeBrowserBench(result);
  const number = (value) => (value === null ? "—" : value.toFixed(2));
  const cards = result.summary
    .map((suite) => {
      const max = Math.max(suite.apps.electron.median || 0, suite.apps.electrobun.median || 0, 1);
      return `<section class="card"><h2><a href="${escape(suite.url)}">${escape(suite.name)}</a></h2>${["electron", "electrobun"].map((kind) => `<div class="row"><span>${kind === "electron" ? "Electron" : "Electrobun + CEF"}</span><div class="track"><i class="${kind}" style="width:${(100 * (suite.apps[kind].median || 0)) / max}%"></i></div><b>${number(suite.apps[kind].median)}</b></div><p class="samples">${suite.apps[kind].n} run(s) · ${suite.apps[kind].scores.map(number).join(" / ") || "no completed scores"}</p>`).join("")}<p class="difference">${suite.comparable ? `CEF ${suite.cefDifferencePercent >= 0 ? "+" : ""}${suite.cefDifferencePercent.toFixed(2)}% relative to Electron` : escape(suite.reasons.join(". "))}${suite.frameRates.length ? ` · target ${suite.frameRates.join(" / ")} fps` : ""}</p></section>`;
    })
    .join("");
  const failed = result.trials.filter((trial) => trial.status !== "complete");
  const attempts = result.attempts || [];
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BrowserBench · Electron vs Electrobun CEF</title><style>
  :root{font-family:var(--font-sans,system-ui);color:var(--foreground,#263448)}*{box-sizing:border-box}body{margin:0}header p,.notes{font-size:12px;line-height:1.6;color:var(--muted-foreground,#6e7b8d)}h1{font-size:22px;margin:0 0 12px}a{color:inherit}h2{font-size:14px;margin:0 0 18px}.card{padding:16px;border:1px solid var(--border,#dce3ed);border-radius:var(--radius,10px);background:var(--card,#f2f5f9);margin:12px 0}.row{display:grid;grid-template-columns:125px minmax(0,1fr) 70px;gap:12px;align-items:center;font-size:12px}.track{height:16px;background:var(--secondary,#e0e6ef);border-radius:4px;overflow:hidden}.track i{display:block;height:16px;min-width:1px}.electron{background:var(--chart-1,#5279c6)}.electrobun{background:var(--chart-2,#299683)}b{text-align:right;font-variant-numeric:tabular-nums}.samples{font-size:10px;color:var(--muted-foreground,#6e7b8d);margin:6px 0 16px}.difference{font-size:12px;margin:14px 0 0}.failures{overflow-wrap:anywhere;font-size:12px;color:var(--destructive,#af4545)}li{margin-bottom:8px}@media(max-width:450px){.row{grid-template-columns:105px minmax(0,1fr) 58px;gap:7px}}
  </style></head><body><header><h1>BrowserBench · Electron / Electrobun + CEF</h1><p>${escape(result.machine.cpu)} · ${result.runs} requested full runs per suite/app · ${escape(result.recordedAt)}<br>Median official scores; higher is better. Default workloads, no shortened tests.<br>${escape(result.versions.electron || "Electron pending")} / ${escape(result.versions.electrobun || "CEF pending")}</p></header>${cards}${failed.length ? `<div class="failures"><strong>Incomplete or failed trials</strong><ul>${failed.map((trial) => `<li>${escape(trial.kind)} / ${escape(trial.suite)} / run ${trial.round + 1}: ${escape(trial.error || trial.status)}</li>`).join("")}</ul></div>` : ""}<details class="notes"><summary>Method and limits</summary><ul>${result.methodology.map((line) => `<li>${escape(line)}</li>`).join("")}</ul></details><p class="notes">Raw official results, per-run screenshots and app artifact hashes are saved with this report. Results describe these development prototypes on this Mac.</p></body></html>`;
  const excludedHtml = attempts.length
    ? `<details class="notes"><summary>${attempts.length} excluded or interrupted attempts</summary><p>These attempts are retained for audit and are excluded from score summaries.</p><ul>${attempts.map((trial) => `<li>${escape(trial.label)}: ${escape(trial.error || trial.status)}${trial.rawFile ? ` · <a href="${escape(trial.rawFile)}">raw result</a>` : ""}</li>`).join("")}</ul></details>`
    : "";
  const markdown = [
    "# BrowserBench · Electron / Electrobun + CEF",
    "",
    `${result.machine.cpu}; ${result.runs} requested full runs per suite/app. Median official scores; higher is better.`,
    "",
    "| Suite | Electron | Electrobun + CEF | Comparison |",
    "|---|---:|---:|---|",
    ...result.summary.map(
      (suite) =>
        `| ${suite.name} | ${number(suite.apps.electron.median)} (n=${suite.apps.electron.n}) | ${number(suite.apps.electrobun.median)} (n=${suite.apps.electrobun.n}) | ${suite.comparable ? `${suite.cefDifferencePercent.toFixed(2)}% CEF vs Electron` : suite.reasons.join("; ")} |`,
    ),
    "",
    "## Method and limits",
    "",
    ...result.methodology.map((line) => `- ${line}`),
    "",
    "## Incomplete or failed trials",
    "",
    ...failed.map(
      (trial) =>
        `- ${trial.kind} / ${trial.suite} / run ${trial.round + 1}: ${trial.error || trial.status}`,
    ),
    "",
    "## Excluded or interrupted attempts",
    "",
    ...attempts.map(
      (trial) =>
        `- ${trial.label}: ${trial.error || trial.status}${trial.rawFile ? ` (raw data: ${trial.rawFile})` : ""}`,
    ),
    "",
  ].join("\n");
  await Promise.all([
    writeFile(join(output, "results.json"), JSON.stringify(result, null, 2) + "\n"),
    writeFile(
      join(output, "report.html"),
      html.replace('<details class="notes">', excludedHtml + '<details class="notes">'),
    ),
    writeFile(join(output, "report.md"), markdown),
  ]);
}

export async function attachBrowserBenchReport(result, output, localOutput) {
  let local;
  try {
    local = JSON.parse(await readFile(join(localOutput, "results.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (
    !local.artifacts ||
    Object.keys(result.artifacts).some((key) => result.artifacts[key] !== local.artifacts[key])
  )
    return false;
  local.browserBench = {
    recordedAt: result.recordedAt,
    completedAt: result.completedAt,
    reportHref: relative(localOutput, join(output, "report.html")),
    resultsHref: relative(localOutput, join(output, "results.json")),
    summary: result.summary,
  };
  await writeReport(local, localOutput);
  return true;
}
