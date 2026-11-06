import { describe, expect, it, vi } from "vite-plus/test";
import { EventEmitter } from "node:events";
import { installSitePermissions } from "../electron/permissions.cjs";

function fixture(prompt = vi.fn(async () => true)) {
  let request: Function;
  let check: Function;
  installSitePermissions(
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
        request(
          contents,
          permission,
          resolve,
          permission === "media"
            ? { requestingUrl: url, mediaTypes: types }
            : { requestingUrl: url },
        ),
      ),
    check: (type: string, url = contents.getURL(), permission = "media") =>
      check(
        contents,
        permission,
        url,
        permission === "media" ? { requestingUrl: url, mediaType: type } : { requestingUrl: url },
      ),
    ask: (permission: string, url = contents.getURL()) =>
      new Promise((resolve) => request(contents, permission, resolve, { requestingUrl: url })),
    has: (permission: string, url = contents.getURL()) =>
      check(contents, permission, url, { requestingUrl: url }),
  };
}

describe("site permission consent", () => {
  it("requires consent and keeps device, origin and profile grants separate", async () => {
    const site = fixture();
    expect(site.check("audio")).toBe(false);
    expect(await site.request(["audio"])).toBe(true);
    expect(site.check("audio")).toBe(true);
    expect(site.check("video")).toBe(false);
    expect(site.check("unknown")).toBe(false);
    expect(site.check("audio", "https://other.example")).toBe(false);
    expect(site.check("audio", undefined, "midi")).toBe(false);
    expect(fixture().check("audio")).toBe(false);
    expect(await site.request(["audio"])).toBe(true);
    expect(site.prompt).toHaveBeenCalledTimes(1);
    expect(await site.request(["video"])).toBe(true);
    expect(site.check("video")).toBe(true);
    expect(site.prompt).toHaveBeenCalledTimes(2);
  });

  it.each(["geolocation", "notifications", "clipboard-read"])(
    "asks before a site gets %s, and keeps the grant to that site and permission",
    async (permission) => {
      const site = fixture();
      expect(site.has(permission)).toBe(false);
      expect(await site.ask(permission)).toBe(true);
      expect(site.prompt).toHaveBeenCalledWith(site.contents, "https://meet.google.com", [
        permission,
      ]);
      expect(site.has(permission)).toBe(true);
      expect(site.has(permission, "https://other.example")).toBe(false);
      expect(site.check("audio")).toBe(false);
      expect(await site.ask(permission)).toBe(true);
      expect(site.prompt).toHaveBeenCalledTimes(1);
      expect(await site.ask(permission, "https://other.example/frame")).toBe(false);
    },
  );

  it("allows clipboard writes without a dialog, as Chrome does", async () => {
    const site = fixture();
    expect(site.has("clipboard-sanitized-write")).toBe(true);
    expect(await site.ask("clipboard-sanitized-write")).toBe(true);
    expect(site.prompt).not.toHaveBeenCalled();
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
    for (const permission of ["midi", "display-capture", "fullscreen", "hid"]) {
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
