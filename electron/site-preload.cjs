// Runs in the top frame of every website, before the page's own scripts.
// Sandboxed preloads cannot require local modules, so this file stands alone.

// Electron's permission check is only granted or denied, so a site sees "denied"
// for the camera and microphone before it ever asks. Chrome reports "prompt",
// and sites such as Google Meet only call getUserMedia in that state.
// This browser asks again on each request until the site is allowed, so
// "prompt" is the true state. Electron runs this function from its source text
// in the page's world: it must not use anything outside its own body.
function reportMediaPrompt() {
  const { Permissions, PermissionStatus } = globalThis;
  if (!globalThis.isSecureContext || !Permissions || !PermissionStatus) return;
  const query = Permissions.prototype.query;
  const state = Object.getOwnPropertyDescriptor(PermissionStatus.prototype, "state").get;
  const devices = ["camera", "microphone"];
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
}

if (typeof process !== "undefined" && process.type === "renderer") {
  require("electron").contextBridge.executeInMainWorld({ func: reportMediaPrompt });
}

module.exports = { reportMediaPrompt };
