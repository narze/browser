// Renders build/icon.svg to build/icon.png with Chromium, so the macOS app icon uses the
// same system font as assets/icon.svg in the app. Run: pnpm exec electron scripts/render-icon.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.dock?.hide();
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const svg = fs.readFileSync(path.join(__dirname, "../build/icon.svg"), "utf8");
  await window.loadURL(
    `data:text/html,${encodeURIComponent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`)}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(path.join(__dirname, "../build/icon.png"), image.toPNG());
  app.quit();
});
