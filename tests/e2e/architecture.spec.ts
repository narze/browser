import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("shortcuts follow split segments and native bounds follow chrome geometry", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-architecture-"));
  const server = createServer((req, res) => res.end(`<title>Page ${req.url}</title>`));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined && !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(key),
    ),
  ) as Record<string, string>;
  const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
  try {
    const chrome = await app.firstWindow();
    const address = chrome.getByRole("textbox", { name: "Search or enter address" });
    for (const page of ["a", "b", "c"]) {
      if (page !== "a") await chrome.getByRole("button", { name: "New tab", exact: true }).click();
      await address.fill(`${origin}/${page}`);
      await address.press("Enter");
      await expect(chrome.getByRole("tab", { name: `Page /${page}` })).toBeVisible();
    }
    await chrome.getByRole("button", { name: "Split tabs", exact: true }).click();
    await expect(chrome.getByRole("tab")).toHaveText(["Page /c", "Page /a", "Page /b"]);
    await address.click();
    const modifier = process.platform === "darwin" ? "meta" : "control";
    // Native key events reach before-input-event like a real keypress; Playwright's do not.
    const press = (keyCode: string, modifiers: string[]) =>
      app.evaluate(
        ({ BrowserWindow }, { keyCode, modifiers }) => {
          const contents = BrowserWindow.getAllWindows()[0].webContents;
          for (const type of ["keyDown", "keyUp"] as const)
            contents.sendInputEvent({ type, keyCode, modifiers: modifiers as never });
        },
        { keyCode, modifiers },
      );
    await press("1", [modifier]);
    await expect(address).toHaveValue(`${origin}/c`);
    await app.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((c) => c.getURL().endsWith("/a"))!;
      page.focus();
      for (const type of ["keyDown", "keyUp"] as const)
        page.sendInputEvent({
          type,
          keyCode: "1",
          modifiers: [process.platform === "darwin" ? "meta" : "control"],
        });
    });
    await expect(address).toHaveValue(`${origin}/c`);
    await address.click();
    await press("Tab", ["control"]);
    await expect(address).toHaveValue(`${origin}/a`);
    await address.click();
    await press("Tab", ["control", "shift"]);
    await expect(address).toHaveValue(`${origin}/c`);
    for (const page of ["a", "b", "c", "a", "b", "c"]) {
      await address.click();
      await press("Tab", ["control"]);
      await expect(address).toHaveValue(`${origin}/${page}`);
    }
    let from = "c";
    for (const page of ["a", "b", "c"]) {
      await app.evaluate(({ webContents }, current) => {
        const contents = webContents
          .getAllWebContents()
          .find((c) => c.getURL().endsWith(`/${current}`))!;
        contents.focus();
        for (const type of ["keyDown", "keyUp"] as const)
          contents.sendInputEvent({ type, keyCode: "Tab", modifiers: ["control"] });
      }, from);
      await expect(address).toHaveValue(`${origin}/${page}`);
      from = page;
    }
    for (const page of ["a", "b", "c"]) {
      await app.evaluate(({ Menu }) => {
        const view = Menu.getApplicationMenu()!.items.find((item) => item.label === "Tab")!;
        view.submenu!.items.find((item) => item.label === "Next tab")!.click();
      });
      await expect(address).toHaveValue(`${origin}/${page}`);
    }
    await chrome.getByRole("tab", { name: "Page /c" }).click();
    await expect(chrome.getByRole("tab")).toHaveText(["Page /c", "Page /a", "Page /b"]);
    for (const page of ["a", "b", "c", "a", "b", "c"]) {
      await chrome.locator('[role="tab"][aria-selected="true"]').focus();
      await chrome.keyboard.press("ArrowRight");
      await expect(address).toHaveValue(`${origin}/${page}`);
    }
    await address.click();
    await press("9", [modifier]);
    await expect(address).toHaveValue(`${origin}/b`);
    // CSS is the owner of chrome dimensions. Native views must follow DOM rectangles.
    await chrome.addStyleTag({
      content: `.browser {
      --chrome-height: 124px;
      --sidebar-width: 246px;
      --pane-toolbar-height: 42px;
      --split-divider-width: 14px;
    }`,
    });
    const expectedBounds = () =>
      chrome.locator(".pane-content").evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.round(bounds.right) - Math.round(bounds.x),
            height: Math.round(bounds.bottom) - Math.round(bounds.y),
          };
        }),
      );
    const nativeBounds = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]
          .contentView.children.filter((view) => view.getVisible())
          .map((view) => view.getBounds())
          .sort((a, b) => a.x - b.x),
      );
    for (const position of ["left", "right", "top"]) {
      await chrome.getByRole("combobox", { name: "Tab layout" }).selectOption(position);
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(940, 680),
      );
      await expect.poll(nativeBounds).toEqual(await expectedBounds());
    }
    const divider = chrome.getByRole("separator", { name: "Resize split panes" });
    await divider.focus();
    await chrome.keyboard.press("ArrowRight");
    await expect.poll(nativeBounds).toEqual(await expectedBounds());
    const dividerBounds = (await divider.boundingBox())!;
    await chrome.mouse.move(dividerBounds.x + dividerBounds.width / 2, dividerBounds.y + 100);
    await chrome.mouse.down();
    await chrome.mouse.move(940 * 0.65 + 7, dividerBounds.y + 100, { steps: 6 });
    await chrome.mouse.up();
    await expect
      .poll(async () => (await chrome.evaluate(() => window.browser!.getState())).split?.ratio)
      .toBeCloseTo(0.66, 1);
    await expect.poll(nativeBounds).toEqual(await expectedBounds());
    await chrome.getByRole("button", { name: "Exit split view" }).click();
    await expect.poll(nativeBounds).toEqual([await chrome.locator("main").boundingBox()]);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});
