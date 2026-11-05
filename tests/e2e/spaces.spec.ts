import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("spaces keep separate tabs and logins, and routes open links in their space", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-spaces-"));
  // /login?as=<name> sets a cookie; every page shows the cookie in its title.
  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://localhost");
    const login = url.pathname === "/login" ? url.searchParams.get("as") : null;
    if (login) response.setHeader("Set-Cookie", `user=${login}; Path=/; Max-Age=3600`);
    const user = login ?? /user=(\w+)/.exec(request.headers.cookie ?? "")?.[1] ?? "nobody";
    response.setHeader("Content-Type", "text/html");
    response.end(
      `<title>${url.pathname} as ${user}</title><a href="/opened" target="_blank">Open</a>`,
    );
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
  const launch = () => electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
  let app = await launch();
  try {
    let chrome = await app.firstWindow();
    const state = () => chrome.evaluate(() => window.browser!.getState());
    const address = () => chrome.getByRole("textbox", { name: "Search or enter address" });
    const spaces = () => chrome.getByRole("navigation", { name: "Spaces" });
    const primary = process.platform === "darwin" ? "meta" : "control";
    // Native key events reach before-input-event like a real keypress; Playwright's do not.
    const press = (path: string, keyCode: string, modifiers: string[]) =>
      app.evaluate(
        ({ webContents }, { url, keyCode, modifiers }) => {
          const contents = webContents.getAllWebContents().find((c) => c.getURL() === url)!;
          contents.focus();
          for (const type of ["keyDown", "keyUp"] as const)
            contents.sendInputEvent({ type, keyCode, modifiers: modifiers as never });
        },
        { url: origin + path, keyCode, modifiers },
      );
    const go = async (path: string) => {
      await address().fill(origin + path);
      await address().press("Enter");
    };
    await chrome.evaluate(() => window.browser!.setTabLayout("left"));

    // B1: the first space holds the existing tabs; a new space starts empty and named by you.
    await go("/login?as=personal");
    await expect(chrome.getByRole("tab", { name: "/login as personal" })).toBeVisible();
    await expect(spaces().getByRole("button", { name: "Personal" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await spaces().getByRole("button", { name: "New space" }).click();
    const spaceName = chrome.getByRole("textbox", { name: "Space name" });
    await expect(spaceName).toBeFocused();
    await spaceName.fill("Work");
    await spaceName.press("Enter");
    await expect(spaces().getByRole("button", { name: "Work" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(chrome.getByRole("tab")).toHaveCount(1);
    await expect(chrome.getByRole("tab", { name: "/login as personal" })).toBeHidden();
    await expect(address()).toBeFocused();

    // B3: the Work space has its own cookies.
    await go("/whoami");
    await expect(chrome.getByRole("tab", { name: "/whoami as nobody" })).toBeVisible();
    await go("/login?as=work");
    await expect(chrome.getByRole("tab", { name: "/login as work" })).toBeVisible();
    await spaces().getByRole("button", { name: "Personal" }).click();
    await expect(chrome.getByRole("tab", { name: "/login as personal" })).toBeVisible();
    await expect(chrome.getByRole("tab")).toHaveCount(1);
    await go("/whoami");
    await expect(chrome.getByRole("tab", { name: "/whoami as personal" })).toBeVisible();

    // B1: Cmd/Ctrl+Alt+Right goes to the next space.
    await press("/whoami", "Right", [primary, "alt"]);
    await expect(chrome.getByRole("tab", { name: "/login as work" })).toBeVisible();
    await press("/login?as=work", "Left", [primary, "alt"]);
    await expect(chrome.getByRole("tab", { name: "/whoami as personal" })).toBeVisible();

    // B4: a route opens new tabs for the site in its space, with that space's login.
    await chrome.getByRole("button", { name: "Settings" }).click();
    await chrome.getByRole("textbox", { name: "Site" }).fill("127.0.0.1");
    await chrome.getByRole("combobox", { name: "Space for this site" }).selectOption("Work");
    await chrome.getByRole("button", { name: "Add route" }).click();
    await expect(chrome.getByRole("list", { name: "Link routes" })).toContainText("127.0.0.1");
    await chrome.getByRole("textbox", { name: "Site" }).fill("not a site");
    await chrome.getByRole("button", { name: "Add route" }).click();
    await expect(chrome.getByRole("alert")).toHaveText("Enter a site, for example github.com.");
    await chrome.getByRole("button", { name: "Back to browsing" }).click();
    await app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().endsWith("/whoami"))!
        .executeJavaScript('document.querySelector("a").click()', true),
    );
    await expect(chrome.getByRole("tab", { name: "/opened as work" })).toBeVisible();
    await expect(spaces().getByRole("button", { name: "Work" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    // Reorder counts only the tabs of the active space.
    const workTabs = async () => (await state()).sections.today.flat();
    const [first, second] = await workTabs();
    await chrome.getByRole("tab", { name: "/opened as work" }).focus();
    await chrome.keyboard.press("Alt+Shift+ArrowUp");
    await expect.poll(workTabs).toEqual([second, first]);

    // B3: a tab moved to another space reloads with that space's login.
    await chrome.getByRole("button", { name: "Command palette", exact: true }).click();
    await expect
      .poll(() =>
        app
          .context()
          .pages()
          .some((page) => page.url().endsWith("#palette")),
      )
      .toBe(true);
    const palette = app
      .context()
      .pages()
      .find((page) => page.url().endsWith("#palette"))!;
    const paletteInput = palette.getByRole("combobox", { name: "Search or enter a command" });
    await paletteInput.fill("> move tab to personal");
    await paletteInput.press("Enter");
    await expect(chrome.getByRole("tab", { name: "/opened as work" })).toBeHidden();
    await spaces().getByRole("button", { name: "Personal" }).click();
    await expect(chrome.getByRole("tab", { name: "/opened as personal" })).toBeVisible();

    // Spaces, their pinned tabs, routes, and logins survive a restart.
    await spaces().getByRole("button", { name: "Work" }).click();
    await chrome.getByRole("tab", { name: "/login as work" }).click();
    await press("/login?as=work", "D", [primary]);
    await expect.poll(async () => (await state()).sections.pinned.flat().length).toBe(1);
    await app.close();
    app = await launch();
    chrome = await app.firstWindow();
    const restored = await state();
    expect(restored.spaces.map((space) => space.name)).toEqual(["Personal", "Work"]);
    expect(restored.routes.map((route) => route.host)).toEqual(["127.0.0.1"]);
    await expect(spaces().getByRole("button", { name: "Work" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(chrome.getByRole("tab", { name: "/login as work" })).toBeVisible();
    await go("/whoami");
    await expect(chrome.getByRole("tab", { name: "/whoami as work" })).toBeVisible();

    // Deleting a space asks first, then erases its logins.
    const work = restored.spaces[1];
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 0;
    });
    await chrome.evaluate((id) => window.browser!.deleteSpace(id), work.id);
    await expect(spaces().getByRole("button", { name: "Work" })).toHaveCount(0);
    await expect(spaces().getByRole("button", { name: "Personal" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect((await state()).routes).toEqual([]);
    await expect
      .poll(() =>
        app.evaluate(
          async ({ session }, name) =>
            (await session.fromPartition(`persist:${name}`).cookies.get({})).length,
          work.profile,
        ),
      )
      .toBe(0);
  } finally {
    await app.close().catch(() => {});
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
