import { describe, expect, it } from "vite-plus/test";
import { isWebUrl, isTabId, canOpenPopup } from "../electron/policy.cjs";

describe("browser process boundary", () => {
  it("accepts only parsed HTTP(S) URLs", () => {
    expect(isWebUrl("HTTPS://example.com")).toBe(true);
    for (const value of [
      "javascript:alert(1)",
      "file:///tmp/test",
      "about:blank",
      "https://",
      "example.com",
      null,
    ]) {
      expect(isWebUrl(value)).toBe(false);
    }
  });
  it("requires positive safe integer tab IDs", () => {
    expect(isTabId(1)).toBe(true);
    for (const id of ["1", null, {}, -1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isTabId(id)).toBe(false);
    }
  });
  it("limits popup bursts per source tab", () => {
    expect(canOpenPopup(-Infinity, 0)).toBe(true);
    expect(canOpenPopup(1000, 1100)).toBe(false);
    expect(canOpenPopup(1000, 1750)).toBe(true);
  });
});
