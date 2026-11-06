import { describe, expect, it } from "vite-plus/test";
import { reportMediaPrompt } from "../electron/site-preload.cjs";

// A stand-in for the page's Permissions API, where Electron reports "denied" until a grant.
function page(states: Record<string, string>, secure = true) {
  class PermissionStatus {
    constructor(readonly name: string) {}
    get state() {
      return states[this.name];
    }
  }
  class Permissions {
    async query(descriptor: { name: string }) {
      if (!(this instanceof Permissions)) throw new TypeError("Illegal invocation");
      return new PermissionStatus(descriptor.name);
    }
  }
  const scope = { Permissions, PermissionStatus, isSecureContext: secure };
  // The preload runs the patch as page code, from its source text.
  new Function("globalThis", `(${reportMediaPrompt.toString()})()`)(scope);
  return { permissions: new Permissions(), Permissions };
}

describe("camera and microphone permission state in pages", () => {
  it("reports prompt, not denied, before the site asks", async () => {
    const states = { camera: "denied", microphone: "denied", notifications: "denied" };
    const { permissions } = page(states);
    const camera = await permissions.query({ name: "camera" });
    expect(camera.state).toBe("prompt");
    expect((await permissions.query({ name: "microphone" })).state).toBe("prompt");
    expect((await permissions.query({ name: "notifications" })).state).toBe("denied");
    states.camera = "granted";
    expect(camera.state).toBe("granted");
  });

  it("keeps the native behavior for insecure pages and wrong receivers", async () => {
    const { permissions } = page({ camera: "denied" }, false);
    expect((await permissions.query({ name: "camera" })).state).toBe("denied");
    const { Permissions } = page({ camera: "denied" });
    await expect(Permissions.prototype.query.call({}, { name: "camera" })).rejects.toThrow(
      TypeError,
    );
  });
});
