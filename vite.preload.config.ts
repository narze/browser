import { defineConfig } from "vite-plus";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    minify: false,
    lib: { entry: "electron/preload.ts", formats: ["cjs"], fileName: () => "preload.cjs" },
    rolldownOptions: { external: ["electron"] },
  },
});
