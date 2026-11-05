import { describe, expect, it } from "vite-plus/test";
import { readLimited } from "../electron/read-limited.cjs";

describe("readLimited", () => {
  it("returns the whole body when it fits", async () => {
    const bytes = await readLimited(new Response("icon"), 10);
    expect(bytes?.toString()).toBe("icon");
  });
  it("stops reading and cancels the stream once the limit is passed", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    });
    expect(await readLimited(new Response(body), 10)).toBeNull();
    expect(pulls).toBeLessThan(5);
    expect(cancelled).toBe(true);
  });
  it("rejects a body whose declared length is too large without reading it", async () => {
    const response = new Response("x".repeat(20), { headers: { "content-length": "20" } });
    expect(await readLimited(response, 10)).toBeNull();
  });
});
