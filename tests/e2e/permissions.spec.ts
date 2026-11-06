import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("camera capture and microphone consent use the site permission dialog", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-permissions-"));
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<title>Permission fixture</title><button onclick="capture()">Use microphone and camera</button>
      <output></output><script>
      async function capture() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({audio: false, video: true});
          document.querySelector('output').textContent = stream.getTracks().map(t => t.kind).sort().join(',');
          stream.getTracks().forEach(t => t.stop());
        } catch (error) { document.querySelector('output').textContent = error.name; }
      }
      </script>`);
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
  try {
    const chrome = await app.firstWindow();
    // Automate only the native answer; Chromium still uses the real session handlers.
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
    const run = (code: string) =>
      app.evaluate(
        ({ webContents }, { url, code }) =>
          webContents
            .getAllWebContents()
            .find((c) => c.getURL().startsWith(url))!
            .executeJavaScript(code, true),
        { url: origin, code },
      );
    await run("document.querySelector('button').click()");
    await expect
      .poll(() => run("document.querySelector('output').textContent"), { timeout: 20000 })
      .toBe("NotAllowedError");
    await app.evaluate(() => {
      (globalThis as any).permissionAnswer = 1;
    });
    await run(
      "document.querySelector('output').textContent = ''; document.querySelector('button').click()",
    );
    await expect
      .poll(() => run("document.querySelector('output').textContent"), { timeout: 20000 })
      .toBe("video");
    const prompts = await app.evaluate(() => (globalThis as any).permissionPrompts);
    expect(prompts).toHaveLength(2);
    expect(JSON.stringify(prompts[0])).toContain(origin);
    expect(JSON.stringify(prompts[0])).not.toContain("your microphone");
    expect(JSON.stringify(prompts[0])).toContain("camera");
    expect(await run("navigator.permissions.query({name:'microphone'}).then(p => p.state)")).toBe(
      "denied",
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
    expect(await app.evaluate(() => (globalThis as any).permissionPrompts.length)).toBe(2);
    // Verify microphone consent separately. Audio capture can hang in macOS CI's
    // fake audio service, so only camera capture is asserted above.
    await run(
      "navigator.mediaDevices.getUserMedia({audio:true}).then(s => s.getTracks().forEach(t => t.stop())).catch(() => {}) ; void 0",
    );
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).permissionPrompts.length))
      .toBe(3);
    await expect
      .poll(() => run("navigator.permissions.query({name:'microphone'}).then(p => p.state)"))
      .toBe("granted");
    const micPrompt = await app.evaluate(() => (globalThis as any).permissionPrompts[2]);
    expect(micPrompt.message).toContain("microphone");
    expect(micPrompt.message).not.toContain("and camera");
  } finally {
    await app.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
