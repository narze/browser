import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/packaged",
  workers: 1,
  timeout: 90_000,
});
