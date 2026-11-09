import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("extension worker starts and can create, group, debug, and close tabs within its space", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-extension-apis-"));
  const folder = join(root, "extension");
  await mkdir(folder);
  await writeFile(
    join(folder, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Browser API fixture",
      version: "1.0",
      background: { service_worker: "background.js" },
      permissions: ["storage", "tabs", "tabGroups", "debugger", "webNavigation"],
      host_permissions: ["<all_urls>"],
      options_page: "options.html",
      action: { default_title: "Run fixture action" },
    }),
  );
  await writeFile(
    join(folder, "background.js"),
    `
    chrome.windows.onRemoved.addListener(() => {});
    chrome.action.onClicked.addListener(() => chrome.storage.local.set({actionRan:true}));
    chrome.tabs.onAttached.addListener(() => {});
    chrome.tabGroups.onRemoved.addListener(() => {});
    chrome.debugger.onEvent.addListener(() => {});
    chrome.webNavigation.onCreatedNavigationTarget.addListener(() => {});
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (message !== 'probe') return;
      (async () => {
        await chrome.storage.session.set({test: 42});
        const {test} = await chrome.storage.session.get('test');
        const tab = await chrome.tabs.create({url: 'about:blank', active: false});
        const groupId = await chrome.tabs.group({tabIds: [tab.id]});
        await chrome.tabGroups.update(groupId, {title: 'Agent test', color: 'blue'});
        await chrome.debugger.attach({tabId: tab.id}, '1.3');
        await chrome.debugger.sendCommand({tabId: tab.id}, 'Page.enable');
        const metrics = await chrome.debugger.sendCommand({tabId: tab.id}, 'Page.getLayoutMetrics');
        if (metrics.cssVisualViewport.clientWidth < 100 || metrics.cssVisualViewport.clientHeight < 100) throw new Error('Background tab has no usable viewport');
        const result = await chrome.debugger.sendCommand({tabId: tab.id}, 'Runtime.evaluate', {expression: '6 * 7', returnByValue: true});
        await chrome.debugger.detach({tabId: tab.id});
        const group = await chrome.tabGroups.get(groupId);
        const members = await chrome.tabs.query({groupId});
        await chrome.tabs.remove(tab.id);
        reply({test, answer: result.result.value, group: group.title, members: members.length});
      })().catch(error => reply({error: error.message}));
      return true;
    });
  `,
  );
  await writeFile(
    join(folder, "options.html"),
    '<h1>Checking</h1><script src="options.js"></script>',
  );
  await writeFile(
    join(folder, "options.js"),
    `
    chrome.runtime.sendMessage('probe').then(result => document.querySelector('h1').textContent = JSON.stringify(result)).catch(error => document.querySelector('h1').textContent = error.message);
  `,
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(entry[0]),
    ),
  );
  const app = await electron.launch({
    args: [".", `--user-data-dir=${join(root, "profile")}`],
    env,
  });
  try {
    const chrome = await app.firstWindow();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, folder);
    const spaceId = await chrome.evaluate(
      async () => (await window.browser!.getState()).activeSpaceId,
    );
    await chrome.evaluate((id) => window.browser!.loadExtension(id), spaceId);
    const id = await chrome.evaluate(
      async (spaceId) => (await window.browser!.getExtensions(spaceId))[0].id,
      spaceId,
    );
    const opened = app.waitForEvent("window");
    await chrome.evaluate(
      ({ spaceId, id }) => window.browser!.openExtensionPage(spaceId, id, "options"),
      { spaceId, id },
    );
    const options = await opened;
    await expect(options.getByRole("heading")).toHaveText(
      '{"test":42,"answer":42,"group":"Agent test","members":1}',
      { timeout: 10_000 },
    );
    const state = await chrome.evaluate(() => window.browser!.getState());
    await app.evaluate(({ Menu }) => {
      Menu.buildFromTemplate = (template) => {
        (globalThis as any).extensionMenu = template;
        return { popup() {} } as any;
      };
    });
    await chrome.evaluate(() => window.browser!.showExtensionsMenu());
    const actionFound = await app.evaluate(() => {
      const item = (globalThis as any).extensionMenu[0].submenu.find(
        (item: any) => item.label === "Run action on current tab",
      );
      item?.click();
      return !!item;
    });
    expect(actionFound).toBe(true);
    await expect
      .poll(() =>
        options.evaluate(
          async () => (await (window as any).chrome.storage.local.get("actionRan")).actionRan,
        ),
      )
      .toBe(true);
    expect(state.tabs.some((tab) => tab.url === "https://example.com/")).toBe(false);
    // Debugger access must never reach trusted browser controls or other spaces.
    const chromeContentsId = await app.evaluate(
      ({ webContents }) =>
        webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().endsWith("/dist/index.html"))!.id,
    );
    const denied = (target: number) =>
      options.evaluate(async (tabId) => {
        try {
          await (window as any).chrome.debugger.attach({ tabId }, "1.3");
          return "allowed";
        } catch (error: any) {
          return error.message;
        }
      }, target);
    expect(await denied(chromeContentsId)).toContain("not found in this space");
    await chrome.evaluate(async () => {
      await window.browser!.createSpace();
      await window.browser!.navigate("https://example.com/");
    });
    const foreignId = await app.evaluate(
      ({ webContents }) =>
        webContents
          .getAllWebContents()
          .find((contents) => contents.session.getStoragePath()?.includes("space-"))!.id,
    );
    expect(await denied(foreignId)).toContain("not found in this space");
    await chrome.evaluate(async () => {
      const state = await window.browser!.getState();
      await window.browser!.addRoute("example.com", state.activeSpaceId);
    });
    const routedId = await options.evaluate(
      async () =>
        (await (window as any).chrome.tabs.create({ url: "https://example.com/", active: false }))
          .id,
    );
    expect(
      await app.evaluate(
        ({ webContents, session }, id) =>
          webContents.fromId(id)!.session === session.fromPartition("persist:browsing"),
        routedId,
      ),
    ).toBe(true);
    await options.evaluate(async (id) => (window as any).chrome.tabs.remove(id), routedId);
    const restricted = await options.evaluate(async () => {
      const api = (window as any).chrome;
      const tab = await api.tabs.create({ url: "about:blank", active: false });
      await api.debugger.attach({ tabId: tab.id }, "1.3");
      const messages = [];
      for (const [command, params] of [
        ["Browser.close", {}],
        ["Target.getTargets", {}],
        ["Page.navigate", { url: "file:///etc/passwd" }],
      ]) {
        try {
          await api.debugger.sendCommand({ tabId: tab.id }, command, params);
          messages.push("allowed");
        } catch (error: any) {
          messages.push(error.message);
        }
      }
      await api.debugger.detach({ tabId: tab.id });
      await api.tabs.remove(tab.id);
      return messages;
    });
    expect(restricted[0]).toContain("not allowed");
    expect(restricted[1]).toContain("not allowed");
    expect(restricted[2]).toContain("Only web pages");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
