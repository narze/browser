import type { BrowserApi } from "../shared/browser";

declare global {
  interface Window {
    browser?: BrowserApi;
  }
}
