import { describe, expect, it } from "vite-plus/test";
import { reportPermissionPrompt } from "../electron/site-preload.cjs";

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
  class Notification {
    static get permission() {
      return states.notifications;
    }
  }
  const scope = { Permissions, PermissionStatus, Notification, isSecureContext: secure };
  // The preload runs the patch as page code, from its source text.
  new Function("globalThis", `(${reportPermissionPrompt.toString()})()`)(scope);
  return { permissions: new Permissions(), Permissions, Notification };
}

describe("site permission state in pages", () => {
  it("reports prompt, not denied, before the site asks", async () => {
    const states: Record<string, string> = {
      camera: "denied",
      microphone: "denied",
      midi: "denied",
    };
    const { permissions } = page(states);
    const camera = await permissions.query({ name: "camera" });
    expect(camera.state).toBe("prompt");
    expect((await permissions.query({ name: "microphone" })).state).toBe("prompt");
    expect((await permissions.query({ name: "midi" })).state).toBe("denied");
    states.camera = "granted";
    expect(camera.state).toBe("granted");
  });

  it.each(["geolocation", "notifications", "clipboard-read"])(
    "reports prompt for %s before the site asks",
    async (name) => {
      const states: Record<string, string> = { [name]: "denied" };
      const { permissions } = page(states);
      const status = await permissions.query({ name });
      expect(status.state).toBe("prompt");
      states[name] = "granted";
      expect(status.state).toBe("granted");
    },
  );

  it("reports default, not denied, for Notification.permission before the site asks", () => {
    const states: Record<string, string> = { notifications: "denied" };
    const { Notification } = page(states);
    expect(Notification.permission).toBe("default");
    states.notifications = "granted";
    expect(Notification.permission).toBe("granted");
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
