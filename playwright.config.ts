import { defineConfig } from "@playwright/test";

// Run the app in the background so local test runs do not take focus.
// Set BROWSER_BACKGROUND=0 to show the app as usual, for example to watch a test.
process.env.BROWSER_BACKGROUND ??= "1";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 90_000,
});
