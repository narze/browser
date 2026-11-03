import { writeFile } from "node:fs/promises";
import { join } from "node:path";

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
const rows = [
  ["Startup", "ms", (m) => m.startupMs],
  ["Local navigation", "ms", (m) => m.navigationMs],
  ["Idle memory · 1 tab", "MiB", (m) => m.oneTab.rssMiB],
  ["Idle memory · 10 tabs", "MiB", (m) => m.tenTabs.rssMiB],
  ["Memory after closing 9 tabs", "MiB", (m) => m.afterClose.rssMiB],
  ["Idle CPU · 1 tab", "% of a core", (m) => m.oneTab.cpuPercent],
  ["Idle CPU · 10 tabs", "% of a core", (m) => m.tenTabs.cpuPercent],
  ["Script workload", "ms", (m) => median(m.scriptSamples.map((s) => s.ms))],
  ["3,000 DOM rows + layout", "ms", (m) => median(m.domSamples.map((s) => s.ms))],
  ["Tab-switch proxy", "ms", (m) => median(m.tabSwitchMs)],
];

export async function writeReport(result, output) {
  const summaries = rows.map(([label, unit, get]) => ({
    label,
    unit,
    values: Object.fromEntries(
      ["electron", "electrobun"].map((kind) => {
        const values = result.trials.filter((t) => t.kind === kind).map((t) => get(t.metrics));
        return [
          kind,
          {
            median: median(values),
            min: values.length ? Math.min(...values) : null,
            max: values.length ? Math.max(...values) : null,
            n: values.length,
          },
        ];
      }),
    ),
  }));
  result.summary = summaries;
  await writeFile(join(output, "results.json"), JSON.stringify(result, null, 2) + "\n");
  const format = (n) => (n === null ? "—" : n.toFixed(1));
  const chart = summaries
    .map(({ label, unit, values }) => {
      const max = Math.max(values.electron.median || 0, values.electrobun.median || 0, 0.01);
      return `<section class="metric"><h3>${escape(label)} <small>${escape(unit)}</small></h3>${["electron", "electrobun"].map((kind) => `<div class="bar-row"><span>${kind === "electron" ? "Electron" : "Electrobun"}</span><div class="track"><div class="bar ${kind}" style="width:${(100 * (values[kind].median || 0)) / max}%"></div></div><strong>${format(values[kind].median)}</strong></div>`).join("")}<p class="range">min–max: ${format(values.electron.min)}–${format(values.electron.max)} / ${format(values.electrobun.min)}–${format(values.electrobun.max)}</p></section>`;
    })
    .join("");
  const featureNames = [
    ...new Set(
      Object.values(result.features)
        .flat()
        .map((c) => c.name),
    ),
  ];
  const featureRows = featureNames
    .map(
      (name) =>
        `<tr><td>${escape(name)}</td>${["electron", "electrobun"]
          .map((kind) => {
            const c = result.features[kind]?.find((c) => c.name === name);
            return `<td title="${escape(c?.detail || "")}"><span class="${c?.status || ""}">${escape(c?.status || "not run")}</span>${c?.status === "fail" ? `<small class="failure">${escape(c.detail)}</small>` : ""}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  const external = result.browserBench;
  const browserBench = external
    ? `<h2>BrowserBench · official HTTPS suites</h2><p class="sizes">Median of complete full-suite runs. Higher scores are better. <a href="${escape(external.reportHref)}">Full BrowserBench report and method</a></p><table><thead><tr><th>Suite</th><th>Electron</th><th>Electrobun + CEF</th><th>Comparison</th></tr></thead><tbody>${external.summary.map((suite) => `<tr><td>${escape(suite.name)}</td><td>${format(suite.apps.electron.median)} (n=${suite.apps.electron.n})</td><td>${format(suite.apps.electrobun.median)} (n=${suite.apps.electrobun.n})</td><td>${suite.comparable ? `${suite.cefDifferencePercent >= 0 ? "+" : ""}${suite.cefDifferencePercent.toFixed(2)}% CEF` : escape(suite.reasons.join("; "))}</td></tr>`).join("")}</tbody></table>`
    : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Electron / Electrobun CEF benchmark</title><style>
  :root{font-family:var(--font-sans,system-ui);color:var(--foreground,#263448);--a:var(--chart-1,#5279c6);--b:var(--chart-2,#299683)}
  *{box-sizing:border-box}body{margin:0}h1{font-size:23px;margin:0 0 12px}h2{font-size:18px;margin:26px 0 12px}p,li{line-height:1.55}.muted,.range,small{color:var(--muted-foreground,#778294)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.metric{background:var(--card,#f1f4f8);border-radius:var(--radius,10px);padding:16px}.metric h3{font-size:13px;margin:0 0 14px}.metric h3 small{font-weight:400;float:right}.bar-row{display:grid;grid-template-columns:75px 1fr 50px;gap:8px;align-items:center;font-size:11px;margin-top:8px}.track{height:13px;background:var(--secondary,#e0e6ef);border-radius:3px;overflow:hidden}.bar{height:13px;min-width:1px}.electron{background:var(--a)}.electrobun{background:var(--b)}strong{text-align:right;font-variant-numeric:tabular-nums}.range{font-size:10px;margin:10px 0 0}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;padding:10px 5px;border-bottom:1px solid var(--border,#dce1e9);vertical-align:top}td:first-child{width:55%}.pass{color:var(--success,#23866e)}.fail{color:var(--destructive,#ba4545)}.manual,.not-tested{color:var(--muted-foreground,#778294)}.failure{display:block;max-width:200px;overflow-wrap:anywhere;font-size:10px}.note{background:var(--card,#f1f4f8);padding:16px;border-radius:var(--radius,10px)}ul{padding-left:20px;font-size:12px}.sizes{font-size:13px}@media(max-width:540px){.grid{grid-template-columns:1fr}.bar-row{grid-template-columns:75px 1fr 45px}}
  </style></head><body><h1>Electron / Electrobun + CEF</h1><p class="muted">${escape(result.machine.cpu)} · ${escape(result.machine.arch)} · ${result.machine.memoryGiB} GiB · ${escape(result.recordedAt)}<br>Median of ${result.runs} requested runs per app; ${result.warmups} excluded warmup(s). Lower values are better.</p><div class="note">${escape(result.versions.electron || "Electron")} / ${escape(result.versions.electrobun || "CEF")}<br>Two browser prototypes with the same Svelte interface and local fixture. Warm OS caches; Electron uses a fresh profile and Electrobun a fresh partition. Startup and tab-switch measurements include automation observation.</div><h2>Performance</h2><div class="grid">${chart}</div><p class="sizes">Uncompressed development runtime + app files: Electron ${(result.distributionBytes.electron / 1024 ** 2).toFixed(1)} MiB · Electrobun + CEF ${(result.distributionBytes.electrobun / 1024 ** 2).toFixed(1)} MiB. Installer sizes were not measured.</p><h2>Feature checks</h2><table><thead><tr><th>Behavior</th><th>Electron</th><th>Electrobun + CEF</th></tr></thead><tbody>${featureRows}</tbody></table><h2>Method and limits</h2><ul>${result.methodology.map((s) => `<li>${escape(s)}</li>`).join("")}</ul>${result.failures.length ? `<h2>Failed runs</h2><pre>${escape(JSON.stringify(result.failures, null, 2))}</pre>` : ""}</body></html>`;
  await writeFile(
    join(output, "report.html"),
    html.replace("<h2>Feature checks</h2>", browserBench + "<h2>Feature checks</h2>"),
  );
  const markdown = [
    `# Electron / Electrobun + CEF benchmark`,
    `Recorded ${result.recordedAt} on ${result.machine.cpu}, ${result.machine.arch}, ${result.machine.memoryGiB} GiB.`,
    `Chromium: ${result.versions.electron} / ${result.versions.electrobun}.`,
    `Median of ${result.runs} requested measured runs, ${result.warmups} excluded warmup(s).`,
    "| Metric | Electron | Electrobun + CEF |",
    "|---|---:|---:|",
    ...summaries.map(
      (s) =>
        `| ${s.label} (${s.unit}) | ${format(s.values.electron.median)} | ${format(s.values.electrobun.median)} |`,
    ),
    "",
    "## Features",
    "| Behavior | Electron | Electrobun + CEF |",
    "|---|---|---|",
    ...featureNames.map(
      (name) =>
        `| ${name} | ${["electron", "electrobun"].map((kind) => result.features[kind]?.find((c) => c.name === name)?.status || "not run").join(" | ")} |`,
    ),
    ...(external
      ? [
          "",
          "## BrowserBench · official HTTPS suites",
          "",
          "Higher scores are better. See the linked BrowserBench report for every full-pass score and comparability limits.",
          "",
          `Report: ${external.reportHref}`,
          "",
          "| Suite | Electron | Electrobun + CEF | Comparison |",
          "|---|---:|---:|---|",
          ...external.summary.map(
            (suite) =>
              `| ${suite.name} | ${format(suite.apps.electron.median)} (n=${suite.apps.electron.n}) | ${format(suite.apps.electrobun.median)} (n=${suite.apps.electrobun.n}) | ${suite.comparable ? `${suite.cefDifferencePercent.toFixed(2)}% CEF` : suite.reasons.join("; ")} |`,
          ),
        ]
      : []),
    "",
    "## Method and limits",
    ...result.methodology.map((s) => `- ${s}`),
    "",
    "See results.json for every sample, status and failure detail.",
  ].join("\n");
  await writeFile(join(output, "report.md"), markdown + "\n");
}
