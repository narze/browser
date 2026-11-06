import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Opens a local page in the real app. Only the native dialog's answer is automated;
// Chromium still uses the real session handlers.
async function openFixture(html: string) {
  const profile = await mkdtemp(join(tmpdir(), "browser-permissions-"));
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(entry[0]),
    ),
  );
  const app = await electron.launch({
    args: ["--use-fake-device-for-media-stream", ".", `--user-data-dir=${profile}`],
    env,
  });
  const close = async () => {
    await app.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  };
  try {
    const chrome = await app.firstWindow();
    await app.evaluate(({ dialog }) => {
      (globalThis as any).permissionPrompts = [];
      (globalThis as any).permissionAnswer = 0;
      dialog.showMessageBox = (async (...args: any[]) => {
        (globalThis as any).permissionPrompts.push(args.at(-1));
        return { response: (globalThis as any).permissionAnswer, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    });
    const address = chrome.getByRole("textbox", { name: "Search or enter address" });
    await address.fill(origin);
    await address.press("Enter");
    const contents = () =>
      app.evaluate(
        ({ webContents }, url) =>
          webContents.getAllWebContents().find((c) => c.getURL().startsWith(url))?.id,
        origin,
      );
    await expect.poll(contents).toBeTruthy();
  } catch (error) {
    await close();
    throw error;
  }
  const run = (code: string) =>
    app.evaluate(
      ({ webContents }, { url, code }) =>
        webContents
          .getAllWebContents()
          .find((c) => c.getURL().startsWith(url))!
          .executeJavaScript(code, true),
      { url: origin, code },
    );
  const answer = (response: number) =>
    app.evaluate((_electron, response) => {
      (globalThis as any).permissionAnswer = response;
    }, response);
  const prompts = () => app.evaluate(() => (globalThis as any).permissionPrompts);
  return { app, origin, run, answer, prompts, close };
}

test("camera capture and microphone consent use the site permission dialog", async () => {
  const {
    origin,
    run,
    answer,
    prompts: allPrompts,
    close,
  } = await openFixture(
    `<title>Permission fixture</title><button onclick="capture()">Use microphone and camera</button>
      <output></output><script>
      async function capture() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({audio: false, video: true});
          document.querySelector('output').textContent = stream.getTracks().map(t => t.kind).sort().join(',');
          stream.getTracks().forEach(t => t.stop());
        } catch (error) { document.querySelector('output').textContent = error.name; }
      }
      </script>`,
  );
  try {
    // Electron never answers clicks on <usermedia> or <geolocation>. Without them,
    // sites such as Google Meet fall back to a button that calls getUserMedia.
    expect(await run("[typeof HTMLUserMediaElement, typeof HTMLGeolocationElement].join()")).toBe(
      "undefined,undefined",
    );
    // Sites such as Google Meet only call getUserMedia when the state is "prompt".
    expect(await run("navigator.permissions.query({name:'camera'}).then(p => p.state)")).toBe(
      "prompt",
    );
    await run("document.querySelector('button').click()");
    await expect
      .poll(() => run("document.querySelector('output').textContent"), { timeout: 20000 })
      .toBe("NotAllowedError");
    await answer(1);
    await run(
      "document.querySelector('output').textContent = ''; document.querySelector('button').click()",
    );
    await expect
      .poll(() => run("document.querySelector('output').textContent"), { timeout: 20000 })
      .toBe("video");
    const prompts = await allPrompts();
    expect(prompts).toHaveLength(2);
    expect(JSON.stringify(prompts[0])).toContain(origin);
    expect(JSON.stringify(prompts[0])).not.toContain("your microphone");
    expect(JSON.stringify(prompts[0])).toContain("camera");
    expect(await run("navigator.permissions.query({name:'microphone'}).then(p => p.state)")).toBe(
      "prompt",
    );
    expect(await run("navigator.permissions.query({name:'camera'}).then(p => p.state)")).toBe(
      "granted",
    );
    await run(
      "document.querySelector('output').textContent = ''; document.querySelector('button').click()",
    );
    await expect
      .poll(() => run("document.querySelector('output').textContent"), { timeout: 20000 })
      .toBe("video");
    expect(await allPrompts()).toHaveLength(2);
    // Verify microphone consent separately. Audio capture can hang in macOS CI's
    // fake audio service, so only camera capture is asserted above.
    await run(
      "navigator.mediaDevices.getUserMedia({audio:true}).then(s => s.getTracks().forEach(t => t.stop())).catch(() => {}) ; void 0",
    );
    await expect.poll(async () => (await allPrompts()).length).toBe(3);
    await expect
      .poll(() => run("navigator.permissions.query({name:'microphone'}).then(p => p.state)"))
      .toBe("granted");
    const micPrompt = (await allPrompts())[2];
    expect(micPrompt.message).toContain("microphone");
    expect(micPrompt.message).not.toContain("and camera");
  } finally {
    await close();
  }
});

test("location, notifications, and clipboard use the site permission dialog", async () => {
  const { app, origin, run, answer, prompts, close } = await openFixture(
    "<title>Permission fixture</title>",
  );
  const state = (name: string) =>
    run(`navigator.permissions.query({name: '${name}'}).then(p => p.state)`);
  const locate = () =>
    run(`new Promise(resolve => navigator.geolocation.getCurrentPosition(
      p => resolve(p.coords.latitude + ',' + p.coords.longitude),
      e => resolve('error ' + e.code)))`);
  try {
    // A fixed position stands in for the system location service.
    await app.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find((c) => c.getURL().startsWith(url))!;
      page.debugger.attach();
      await page.debugger.sendCommand("Emulation.setGeolocationOverride", {
        latitude: 13.7563,
        longitude: 100.5018,
        accuracy: 10,
      });
    }, origin);
    for (const name of ["geolocation", "notifications", "clipboard-read"])
      expect(await state(name)).toBe("prompt");
    expect(await run("Notification.permission")).toBe("default");
    // Chrome allows clipboard writes without a dialog.
    expect(await state("clipboard-write")).toBe("granted");

    expect(await locate()).toBe("error 1");
    await answer(1);
    expect(await locate()).toBe("13.7563,100.5018");
    expect(await state("geolocation")).toBe("granted");
    expect(await run("Notification.requestPermission()")).toBe("granted");
    expect(await run("Notification.permission")).toBe("granted");
    expect(await state("clipboard-read")).toBe("prompt");

    const messages = (await prompts()).map((prompt: { message: string }) => prompt.message);
    expect(messages).toEqual([
      `Allow ${origin} to know your location?`,
      `Allow ${origin} to know your location?`,
      `Allow ${origin} to show notifications?`,
    ]);
    // A grant lasts for the session: no new dialog.
    expect(await locate()).toBe("13.7563,100.5018");
    expect(await prompts()).toHaveLength(3);
  } finally {
    await close();
  }
});
