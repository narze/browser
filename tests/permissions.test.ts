import { describe, expect, it, vi } from "vite-plus/test";
import { EventEmitter } from "node:events";
import { installMediaPermissions } from "../electron/permissions.cjs";

function fixture(prompt = vi.fn(async () => true)) {
  let request: Function;
  let check: Function;
  installMediaPermissions(
    {
      setPermissionRequestHandler: (handler: Function) => {
        request = handler;
      },
      setPermissionCheckHandler: (handler: Function) => {
        check = handler;
      },
    },
    { prompt },
  );
  const contents = Object.assign(new EventEmitter(), {
    getURL: (): string => "https://meet.google.com/meeting",
    isDestroyed: () => false,
  });
  return {
    contents,
    prompt,
    request: (types = ["audio", "video"], url = contents.getURL(), permission = "media") =>
      new Promise((resolve) =>
        request(contents, permission, resolve, { requestingUrl: url, mediaTypes: types }),
      ),
    check: (type: string, url = contents.getURL(), permission = "media") =>
      check(contents, permission, url, { requestingUrl: url, mediaType: type }),
  };
}

describe("site camera and microphone consent", () => {
  it("requires consent and keeps device, origin and profile grants separate", async () => {
    const site = fixture();
    expect(site.check("audio")).toBe(false);
    expect(await site.request(["audio"])).toBe(true);
    expect(site.check("audio")).toBe(true);
    expect(site.check("video")).toBe(false);
    expect(site.check("unknown")).toBe(false);
    expect(site.check("audio", "https://other.example")).toBe(false);
    expect(site.check("audio", undefined, "notifications")).toBe(false);
    expect(fixture().check("audio")).toBe(false);
    expect(await site.request(["audio"])).toBe(true);
    expect(site.prompt).toHaveBeenCalledTimes(1);
    expect(await site.request(["video"])).toBe(true);
    expect(site.check("video")).toBe(true);
    expect(site.prompt).toHaveBeenCalledTimes(2);
  });

  it("allows retry after denial or a failed prompt", async () => {
    const prompt = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("closed"))
      .mockResolvedValue(true);
    const site = fixture(prompt);
    expect(await site.request()).toBe(false);
    expect(site.check("audio")).toBe(false);
    expect(await site.request()).toBe(false);
    expect(await site.request()).toBe(true);
  });

  it("denies other permissions, cross-origin frames, unsafe origins and invalid device requests", async () => {
    const site = fixture();
    for (const permission of ["notifications", "display-capture", "geolocation"]) {
      expect(await site.request(undefined, undefined, permission)).toBe(false);
    }
    expect(await site.request(["audio"], "https://other.example/frame")).toBe(false);
    expect(await site.request([])).toBe(false);
    expect(await site.request(["screen"])).toBe(false);
    site.contents.getURL = () => "http://insecure.example";
    expect(await site.request()).toBe(false);
    site.contents.getURL = () => "file:///tmp/page.html";
    expect(await site.request()).toBe(false);
    expect(site.prompt).not.toHaveBeenCalled();
  });

  it.each(["navigate", "destroy"])(
    "discards consent when the requesting page goes away: %s",
    async (action) => {
      let answer!: (allowed: boolean) => void;
      const site = fixture(
        vi.fn(
          () =>
            new Promise<boolean>((resolve) => {
              answer = resolve;
            }),
        ),
      );
      const result = site.request();
      if (action === "navigate")
        site.contents.emit("did-start-navigation", {}, "https://other.example", false, true);
      else site.contents.emit("destroyed");
      answer(true);
      expect(await result).toBe(false);
      expect(site.check("audio")).toBe(false);
      expect(site.contents.listenerCount("did-start-navigation")).toBe(0);
      expect(site.contents.listenerCount("destroyed")).toBe(0);
    },
  );
});
