import { defineConfig } from "vite-plus";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  base: "./",
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  test: { include: ["tests/**/*.test.ts"] },
});
