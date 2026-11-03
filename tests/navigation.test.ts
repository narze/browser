import { describe, expect, it } from "vite-plus/test";
import { resolveAddress } from "../electron/navigation.cjs";

describe("address bar", () => {
  it("adds HTTPS to bare domains and preserves paths", () => {
    expect(resolveAddress(" example.com/docs?q=test ")).toBe("https://example.com/docs?q=test");
  });
  it("uses HTTP for local development addresses", () => {
    expect(resolveAddress("localhost:3000/path")).toBe("http://localhost:3000/path");
    expect(resolveAddress("127.0.0.1:8080")).toBe("http://127.0.0.1:8080/");
    expect(resolveAddress("[::1]:3000")).toBe("http://[::1]:3000/");
  });
  it("searches for plain text", () => {
    expect(resolveAddress("svelte electron browser")).toBe(
      "https://duckduckgo.com/?q=svelte%20electron%20browser",
    );
  });
  it("preserves valid HTTP and HTTPS URLs", () => {
    expect(resolveAddress("http://example.com/a")).toBe("http://example.com/a");
    expect(resolveAddress("https://example.com")).toBe("https://example.com/");
  });
  it("rejects privileged and executable URL schemes", () => {
    for (const address of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,hello",
      "ftp://example.com",
    ]) {
      expect(() => resolveAddress(address)).toThrow("Only HTTP and HTTPS");
    }
  });
  it("returns a new tab for blank input", () => {
    expect(resolveAddress("  ")).toBe("");
  });
});
