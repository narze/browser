// Runs in the top frame of every website, before the page's own scripts.
// Sandboxed preloads cannot require local modules, so this file stands alone.

// Electron's permission check is only granted or denied, so a site sees "denied"
// for the camera, microphone, location, notifications and clipboard reads before
// it ever asks. Chrome reports "prompt" (Notification.permission: "default"), and
// sites such as Google Meet only ask in that state. This browser asks again on
// each request until the site is allowed, so "prompt" is the true state.
// Electron runs this function from its source text in the page's world: it must
// not use anything outside its own body.
function reportPermissionPrompt() {
  const { Permissions, PermissionStatus, Notification } = globalThis;
  if (!globalThis.isSecureContext || !Permissions || !PermissionStatus) return;
  const query = Permissions.prototype.query;
  const state = Object.getOwnPropertyDescriptor(PermissionStatus.prototype, "state").get;
  const devices = ["camera", "microphone", "geolocation", "notifications", "clipboard-read"];
  Object.defineProperty(Permissions.prototype, "query", {
    configurable: true,
    writable: true,
    value: {
      async query(descriptor) {
        const status = await query.call(this, descriptor);
        if (devices.includes(descriptor?.name))
          Object.defineProperty(status, "state", {
            configurable: true,
            get() {
              const value = state.call(this);
              return value === "denied" ? "prompt" : value;
            },
          });
        return status;
      },
    }.query,
  });
  const permission = Notification && Object.getOwnPropertyDescriptor(Notification, "permission");
  if (permission?.get)
    Object.defineProperty(Notification, "permission", {
      configurable: true,
      enumerable: permission.enumerable,
      get() {
        const value = permission.get.call(this);
        return value === "denied" ? "default" : value;
      },
    });
}

if (typeof process !== "undefined" && process.type === "renderer") {
  require("electron").contextBridge.executeInMainWorld({ func: reportPermissionPrompt });
}

module.exports = { reportPermissionPrompt };
