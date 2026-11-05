import { describe, expect, it } from "vite-plus/test";
import { isWebUrl, isTabId, canOpenPopup, sameSite } from "../electron/policy.cjs";

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
  it("compares sites by their registrable domain", () => {
    expect(sameSite("https://mail.example.com/a", "https://accounts.example.com/b")).toBe(true);
    expect(sameSite("https://www.example.com/", "http://example.com/x")).toBe(true);
    expect(sameSite("https://news.bbc.co.uk/", "https://www.bbc.co.uk/")).toBe(true);
    expect(sameSite("https://example.com/", "https://other.org/")).toBe(false);
    expect(sameSite("https://first.co.uk/", "https://other.co.uk/")).toBe(false);
    expect(sameSite("https://alice.github.io/", "https://bob.github.io/")).toBe(false);
    expect(sameSite("http://127.0.0.1:8000/", "http://127.0.0.1:9000/")).toBe(true);
    expect(sameSite("http://127.0.0.1/", "http://localhost/")).toBe(false);
    expect(sameSite("https://example.com/", "not a url")).toBe(false);
  });
  it("limits popup bursts per source tab", () => {
    expect(canOpenPopup(-Infinity, 0)).toBe(true);
    expect(canOpenPopup(1000, 1100)).toBe(false);
    expect(canOpenPopup(1000, 1750)).toBe(true);
  });
});
