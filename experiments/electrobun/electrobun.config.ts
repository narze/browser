import type { ElectrobunConfig } from "electrobun";

export default {
  app: { name: "BrowserCEF", identifier: "dev.narze.browser-cef", version: "0.1.0" },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/bun/index.ts" },
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
    },
    mac: { bundleCEF: true, defaultRenderer: "cef" },
    win: { bundleCEF: true, defaultRenderer: "cef" },
    linux: { bundleCEF: true, defaultRenderer: "cef" },
    watchIgnore: ["dist/**", "build/**", "artifacts/**"],
  },
} satisfies ElectrobunConfig;
