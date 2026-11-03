import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { until } from "./cdp.mjs";
import { resources } from "./driver.mjs";

const active = (state) => state.tabs.find((tab) => tab.id === state.activeId);

async function click(shell, selector) {
  await shell.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) throw new Error('Control unavailable: '+${JSON.stringify(selector)});
    element.click();
  })()`);
}

async function navigate(app, url) {
  await app.shell.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Search or enter address"]');
    input.value = ${JSON.stringify(url)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.closest('form').requestSubmit();
  })()`);
  const page = await app.page(url);
  await until(() => page.evaluate("window.fixtureReady === true"), "fixture ready");
  await until(async () => {
    const tab = active(await app.state());
    return tab.url === url && !tab.loading;
  }, "address and load state");
  return page;
}

async function reset(app) {
  const oldTargets = new Set(
    (await app.targets())
      .filter((target) => target.type === "page" && target.id !== app.shellTargetId)
      .map((target) => target.id),
  );
  await app.api("newTab");
  const state = await app.state();
  for (const tab of state.tabs) if (tab.id !== state.activeId) await app.api("closeTab", tab.id);
  // CEF closes targets asynchronously. Reusing a fixture URL before teardown
  // completes can attach CDP to the previous test's closing document.
  await until(
    async () => (await app.targets()).every((target) => !oldTargets.has(target.id)),
    "previous feature targets released",
  );
  await app.api("setTabLayout", "top");
}

export async function features(app, origin) {
  const checks = [];
  const check = async (name, run) => {
    try {
      await reset(app);
      const detail = await run();
      checks.push({ name, status: "pass", detail });
    } catch (error) {
      checks.push({ name, status: "fail", detail: error.message });
    }
    const result = checks.at(-1);
    console.log(
      `  ${result.status}: ${name}${result.status === "fail" ? ` — ${result.detail}` : ""}`,
    );
  };
  await check("New-tab screen and close-last-tab", async () => {
    await app.api("closeTab", (await app.state()).activeId);
    const state = await app.state();
    assert.equal(state.tabs.length, 1);
    assert.equal(active(state).url, "");
    assert.equal(
      await app.shell.evaluate("document.querySelector('h1').textContent"),
      "Where to next?",
    );
  });
  await check("Address bar, HTTP page and title", async () => {
    await navigate(app, `${origin}/first`);
    await until(async () => active(await app.state()).title === "Fixture page", "page title");
  });
  await check("Remote page has no Node, Bun or BrowserApi", async () => {
    const page = await navigate(app, `${origin}/first`);
    const isolation = await page.evaluate(
      "({require:typeof require,Bun:typeof Bun,browser:typeof window.browser})",
    );
    assert.ok(
      Object.values(isolation).every((value) => value === "undefined"),
      JSON.stringify(isolation),
    );
  });
  await check("Remote page cannot invoke native view commands", async () => {
    const page = await navigate(app, `${origin}/first`);
    await page.evaluate(`(() => { const bridge=window.__electrobunInternalBridge;
      if (bridge) bridge.postMessage(JSON.stringify([JSON.stringify({type:'message',id:'webviewTagUpdateSrc',payload:{id:window.__electrobunWebviewId,url:${JSON.stringify(`${origin}/bridge-attack`)}}})]));
    })()`);
    await delay(300);
    assert.equal(await page.evaluate("location.href"), `${origin}/first`);
  });
  await check("Links, back and forward", async () => {
    const page = await navigate(app, `${origin}/first`);
    await click(page, "#next");
    await until(
      async () => active(await app.state()).url === `${origin}/second`,
      "link navigation",
    );
    await until(async () => active(await app.state()).canGoBack, "back enabled");
    await click(app.shell, 'button[aria-label="Back"]');
    await until(async () => active(await app.state()).url === `${origin}/first`, "back navigation");
    await until(async () => active(await app.state()).canGoForward, "forward enabled");
    await click(app.shell, 'button[aria-label="Forward"]');
    await until(
      async () => active(await app.state()).url === `${origin}/second`,
      "forward navigation",
    );
  });
  await check("Reload replaces page document", async () => {
    const page = await navigate(app, `${origin}/first`);
    const before = await page.evaluate("window.fixtureToken");
    await click(app.shell, 'button[aria-label="Reload"]');
    await until(async () => {
      const token = await page.evaluate("window.fixtureReady && window.fixtureToken");
      return token && token !== before;
    }, "new document after reload");
  });
  await check("Tabs preserve separate page state", async () => {
    const first = await navigate(app, `${origin}/first`);
    const id = (await app.state()).activeId;
    await first.evaluate("window.testMarker = 'preserved'");
    await click(app.shell, 'button[aria-label="New tab"]');
    await navigate(app, `${origin}/second`);
    assert.equal((await app.state()).tabs.length, 2);
    await app.api("selectTab", id);
    assert.equal(await first.evaluate("window.testMarker"), "preserved");
    assert.equal(active(await app.state()).url, `${origin}/first`);
  });
  for (const position of ["left", "right", "top"]) {
    await check(`${position} tabs preserve document and native viewport`, async () => {
      const page = await navigate(app, `${origin}/first`);
      const marker = await page.evaluate("window.fixtureToken");
      await app.shell.evaluate(
        `(() => {const select=document.querySelector('select[aria-label="Tab layout"]');select.value=${JSON.stringify(position)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await until(async () => (await app.state()).tabLayout === position, "layout state");
      await until(async () => {
        const bounds = await app.shell.evaluate(
          "(()=>{const r=document.querySelector('main').getBoundingClientRect();return {width:r.width,height:r.height}})()",
        );
        const viewport = await page.evaluate("({width:innerWidth,height:innerHeight})");
        return bounds.width === viewport.width && bounds.height === viewport.height;
      }, "native viewport follows layout");
      assert.equal(await page.evaluate("window.fixtureToken"), marker);
    });
  }
  await check("Popup link opens a controlled new tab", async () => {
    const page = await navigate(app, `${origin}/first`);
    await click(page, "#popup");
    await until(async () => {
      const state = await app.state();
      return state.tabs.length === 2 && active(state).url === `${origin}/second`;
    }, "popup tab");
  });
  await check("Iframe history does not change the address bar", async () => {
    const page = await navigate(app, `${origin}/first`);
    await page.evaluate(
      "new Promise(resolve=>{const f=document.createElement('iframe');f.src='/frame';f.onload=()=>{f.contentWindow.history.pushState({},'', '/frame?changed');resolve()};document.body.append(f)})",
    );
    await delay(250);
    assert.equal(active(await app.state()).url, `${origin}/first`);
  });
  await check("SPA pushState updates the address bar", async () => {
    const page = await navigate(app, `${origin}/first`);
    await page.evaluate("history.pushState({}, '', '/spa?changed')");
    await until(
      async () => active(await app.state()).url === `${origin}/spa?changed`,
      "SPA address",
    );
  });
  await check("HTTP redirects update URL", async () => {
    await app.api("navigate", `${origin}/redirect`);
    await until(
      async () => active(await app.state()).url === `${origin}/second`,
      "redirect address",
    );
  });
  await check("Invalid schemes are rejected", async () => {
    for (const input of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,unsafe"]) {
      assert.ok((await app.api("navigate", input)).error, `Accepted ${input}`);
      assert.equal(active(await app.state()).url, "");
    }
  });
  await check("Page cannot navigate to file URLs", async () => {
    const page = await navigate(app, `${origin}/first`);
    await page.evaluate("location.href = 'file:///etc/passwd'").catch(() => {});
    await delay(250);
    assert.equal(await page.evaluate("location.protocol"), "http:");
  });
  await check("Stop cancels a slow navigation", async () => {
    await app.api("navigate", `${origin}/slow`);
    await until(async () => active(await app.state()).loading, "loading started");
    // Wait for the document to exist before stop; then observe actual Chromium loading state.
    const page = await app.page(`${origin}/slow`);
    await click(app.shell, 'button[aria-label="Stop loading"]');
    await until(async () => !active(await app.state()).loading, "loading stopped");
    await until(
      () => page.evaluate("document.readyState !== 'loading'"),
      "network navigation aborted",
    );
  });
  await check("Failed navigation has a recoverable error screen", async () => {
    await app.api("navigate", "http://127.0.0.1:1/unreachable");
    await until(async () => !!active(await app.state()).error, "error screen", 5000);
    assert.equal(
      await app.shell.evaluate("document.querySelector('h1').textContent"),
      "This page couldn’t load.",
    );
    await navigate(app, `${origin}/first`);
  });
  await check("Local storage and cookies shared across tabs", async () => {
    const page = await navigate(app, `${origin}/first`);
    const fresh = await page.evaluate("localStorage.getItem('benchmark')");
    assert.equal(fresh, null, "Benchmark partition was not fresh");
    await page.evaluate(
      "localStorage.setItem('benchmark','stored');document.cookie='benchmark=stored;SameSite=Lax'",
    );
    await app.api("newTab");
    const second = await navigate(app, `${origin}/second`);
    const stored = await second.evaluate(
      "({storage:localStorage.getItem('benchmark'),cookie:document.cookie})",
    );
    assert.equal(stored.storage, "stored", "Local storage not shared: " + JSON.stringify(stored));
    assert.ok(
      stored.cookie.includes("benchmark=stored"),
      "Cookie not shared: " + JSON.stringify(stored),
    );
  });
  await check("Web Worker and WebAssembly", async () => {
    const page = await navigate(app, `${origin}/first`);
    assert.equal(
      await page.evaluate(
        "new Promise((resolve,reject)=>{const w=new Worker('/worker.js');w.onmessage=e=>{resolve(e.data);w.terminate()};w.onerror=reject;w.postMessage(21)})",
      ),
      42,
    );
    assert.equal(
      await page.evaluate("WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0]))"),
      true,
    );
  });
  await check("Canvas 2D and WebGL2", async () => {
    const page = await navigate(app, `${origin}/first`);
    assert.equal(
      await page.evaluate(
        "!!document.createElement('canvas').getContext('2d') && !!document.createElement('canvas').getContext('webgl2')",
      ),
      true,
    );
  });
  await check("Editable page controls receive input", async () => {
    const page = await navigate(app, `${origin}/first`);
    await page.evaluate("document.querySelector('#editable').focus()");
    await page.send("Input.insertText", { text: "Chromium input works" });
    assert.equal(
      await page.evaluate("document.querySelector('#editable').value"),
      "Chromium input works",
    );
  });
  checks.push(
    {
      name: "Native menu shortcuts while web page is focused",
      status: "manual",
      detail: "Cmd/Ctrl+L/T/W/R and native clipboard roles need an OS-level manual check.",
    },
    {
      name: "DRM, Chrome extensions, downloads and session restore",
      status: "not-tested",
      detail: "Outside this prototype benchmark; no compatibility claim.",
    },
  );
  const renderers = execFileSync("ps", ["-axo", "pgid=,args="], { encoding: "utf8" })
    .split("\n")
    .filter(
      (line) => Number(line.trim().split(/\s+/)[0]) === app.pid && line.includes("--type=renderer"),
    );
  const sandboxed =
    renderers.length > 0 && renderers.every((line) => !line.includes("--no-sandbox"));
  checks.push({
    name: "Chromium renderer OS sandbox",
    status: sandboxed ? "pass" : "unsupported",
    detail: sandboxed
      ? "Renderer processes have no --no-sandbox flag. Separate from application RPC isolation."
      : "Electrobun 2.0.5 macOS CEF launches renderer processes with --no-sandbox. Its sandbox attribute disables RPC; it is not the Chromium OS sandbox.",
  });
  return checks;
}

async function sampleResources(app, durationMs) {
  const samples = [];
  const start = resources(app.pid);
  const started = performance.now();
  while (performance.now() - started < durationMs) {
    samples.push(resources(app.pid));
    await delay(200);
  }
  const end = resources(app.pid);
  return {
    rssMiB: samples.reduce((sum, sample) => sum + sample.rssMiB, 0) / samples.length,
    peakRssMiB: Math.max(...samples.map((sample) => sample.rssMiB)),
    cpuPercent:
      (100 * (end.cpuSeconds - start.cpuSeconds)) / ((performance.now() - started) / 1000),
    processes: end.processes,
  };
}

export async function performanceSuite(app, origin) {
  const metrics = { startupMs: app.startupMs };
  const started = performance.now();
  const page = await navigate(app, `${origin}/performance`);
  metrics.navigationMs = performance.now() - started;
  metrics.page = await page.evaluate(
    "(()=>{const n=performance.getEntriesByType('navigation')[0];return {domContentLoadedMs:n.domContentLoadedEventEnd,loadMs:n.loadEventEnd,firstContentfulPaintMs:performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null}})()",
  );
  await delay(500);
  metrics.oneTab = await sampleResources(app, 2000);
  // Warm up the page workload once. Measure in-page time so CDP round-trips are excluded.
  const workload = `(() => { const start=performance.now(); let sum=0; for(let j=0;j<10;j++) {const a=Array.from({length:50000},(_,i)=>(i*16807+j)%2147483647);a.sort((a,b)=>b-a);sum+=a[0]} return {ms:performance.now()-start,checksum:sum}; })()`;
  await page.evaluate(workload);
  metrics.scriptSamples = [];
  for (let i = 0; i < 5; i++) metrics.scriptSamples.push(await page.evaluate(workload));
  metrics.domSamples = [];
  for (let i = 0; i < 5; i++)
    metrics.domSamples.push(
      await page.evaluate(
        "(()=>{const grid=document.querySelector('#grid');grid.replaceChildren();const start=performance.now();const f=document.createDocumentFragment();for(let j=0;j<3000;j++){const e=document.createElement('div');e.className='card';e.textContent='DOM row '+j;f.append(e)}grid.append(f);const height=grid.offsetHeight;return {ms:performance.now()-start,height}})()",
      ),
    );
  const ids = [(await app.state()).activeId];
  for (let i = 1; i < 10; i++) {
    await app.api("newTab");
    await navigate(app, `${origin}/performance?tab=${i}`);
    ids.push((await app.state()).activeId);
  }
  await delay(500);
  metrics.tenTabs = await sampleResources(app, 2000);
  metrics.tabSwitchMs = [];
  for (const id of ids.slice(0, 5)) {
    const start = performance.now();
    await app.api("selectTab", id);
    await until(async () => (await app.state()).activeId === id, "selected tab");
    const url = active(await app.state()).url;
    const selected = await app.page(url);
    await selected.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    metrics.tabSwitchMs.push(performance.now() - start);
  }
  // Explicitly close the nine other tabs and observe the remaining native targets.
  for (const id of ids.slice(1)) await app.api("closeTab", id);
  await until(
    async () =>
      (await app.targets()).filter((target) => target.url.startsWith(origin)).length === 1,
    "closed page targets released",
  );
  await delay(500);
  metrics.afterClose = await sampleResources(app, 1000);
  return metrics;
}
