import { defineConfig } from "vite-plus";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: "src/mainview",
  plugins: [svelte({ configFile: fileURLToPath(new URL("./svelte.config.js", import.meta.url)) })],
  resolve: {
    alias: {
      "electrobun/view": fileURLToPath(
        new URL("./.hutch/devkit/api/browser/index.ts", import.meta.url),
      ),
    },
  },
  base: "./",
  build: { outDir: "../../dist", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
