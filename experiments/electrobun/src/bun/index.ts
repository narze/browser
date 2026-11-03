import { BrowserWindow, BrowserView, ApplicationMenu } from "electrobun/main";
import type { BrowserRPC } from "../../shared/rpc";

let tabRemovalUntil = 0;
const rpc = BrowserView.defineRPC<BrowserRPC>({
  handlers: {
    requests: {
      config: () => ({
        platform: process.platform,
        // A unique partition isolates each benchmark run without touching user data.
        partition: `persist:${process.env.BROWSER_BENCH_PARTITION || "browsing"}`,
      }),
      guardTabRemoval: () => {
        tabRemovalUntil = performance.now() + 500;
      },
    },
    messages: {},
  },
});

let url = "views://mainview/index.html";
if (process.env.BROWSER_HMR === "1") {
  try {
    const hmrUrl = new URL(process.env.BROWSER_HMR_URL || "http://127.0.0.1:5173/").href;
    const response = await fetch(hmrUrl, { signal: AbortSignal.timeout(1000) });
    if (response.ok) url = hmrUrl;
  } catch {
    /* Packaged assets also work without Vite. */
  }
}
const win = new BrowserWindow({
  title: "Browser · Electrobun + CEF",
  url,
  rpc,
  renderer: "cef",
  frame: { width: 1280, height: 850 },
  titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
  navigationRules: JSON.stringify(["^*", url]),
});
win.on("will-close", (event) => {
  // Electrobun 2.0.5's macOS CEF CloseBrowser(false) also requests closing the
  // host NSWindow. Cancel that callback while explicitly removing child tabs.
  // The bound keeps a missing native callback from disabling window close.
  if (process.platform === "darwin" && performance.now() < tabRemovalUntil) {
    (event as { response: { allow: boolean } }).response = { allow: false };
  }
});

const item = (label: string, action: string, accelerator: string) => ({
  label,
  action,
  accelerator,
});
ApplicationMenu.setApplicationMenu([
  { label: "Browser", submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }] },
  {
    label: "File",
    submenu: [
      item("New tab", "newTab", "CommandOrControl+T"),
      item("Close tab", "closeTab", "CommandOrControl+W"),
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
  {
    label: "View",
    submenu: [
      item("Focus address", "focusAddress", "CommandOrControl+L"),
      item("Reload", "reload", "CommandOrControl+R"),
      item("Back", "back", "Alt+Left"),
      item("Forward", "forward", "Alt+Right"),
      item("Next tab", "nextTab", "CommandOrControl+Shift+]"),
      item("Previous tab", "previousTab", "CommandOrControl+Shift+["),
      item("Developer tools", "devTools", "CommandOrControl+Alt+I"),
    ],
  },
]);
ApplicationMenu.on("application-menu-clicked", (event) => {
  const action = (event as { data?: { action?: string } }).data?.action;
  if (action) rpc.send.command({ action });
});

// Child views are released by Electrobun when the window closes.
void win;
