// Grants live only for this app session and this space's browsing profile.
// A site's microphone grant never grants its camera, or another site's devices.
function secureOrigin(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      return url.origin;
  } catch {}
  return null;
}

// Permissions a site gets only after the user allows it in a dialog. Media is
// asked for per device: "audio" and "video".
const asked = new Set(["geolocation", "notifications", "clipboard-read"]);
const devices = new Set(["audio", "video"]);
// Chrome allows clipboard writes without a dialog. Blink still requires the page
// to have focus and a recent user action.
const alwaysAllowed = new Set(["clipboard-sanitized-write"]);

function installSitePermissions(browsing, { prompt }) {
  const grants = new Map();
  // Restrict requests to the top-level site's origin, including same-origin frames.
  const originFor = (contents, url) => {
    if (!contents || contents.isDestroyed()) return null;
    const origin = secureOrigin(url);
    return origin && origin === secureOrigin(contents.getURL()) ? origin : null;
  };
  browsing.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    if (alwaysAllowed.has(permission)) return true;
    const kind = permission === "media" ? details.mediaType : permission;
    if (!(permission === "media" ? devices.has(kind) : asked.has(kind))) return false;
    const origin = originFor(contents, details.requestingUrl ?? requestingOrigin);
    return !!origin && !!grants.get(origin)?.has(kind);
  });
  browsing.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (alwaysAllowed.has(permission)) {
      callback(true);
      return;
    }
    const origin = originFor(contents, details.requestingUrl);
    const types =
      permission === "media"
        ? details.mediaTypes
        : asked.has(permission)
          ? [permission]
          : undefined;
    if (
      !origin ||
      !types?.length ||
      (permission === "media" && !types.every((type) => devices.has(type)))
    ) {
      callback(false);
      return;
    }
    if (types.every((type) => grants.get(origin)?.has(type))) {
      callback(true);
      return;
    }
    // Navigation or closing the page while a prompt is open invalidates its answer.
    let valid = true;
    const invalidate = () => {
      valid = false;
    };
    const navigate = (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) invalidate();
    };
    contents.on("did-start-navigation", navigate);
    contents.once("destroyed", invalidate);
    void (async () => {
      let allowed = false;
      try {
        allowed = await prompt(contents, origin, types);
        allowed = allowed && valid && originFor(contents, details.requestingUrl) === origin;
        if (allowed) {
          const kinds = grants.get(origin) ?? new Set();
          types.forEach((type) => kinds.add(type));
          grants.set(origin, kinds);
        }
      } catch {
        allowed = false;
      } finally {
        contents.removeListener("did-start-navigation", navigate);
        contents.removeListener("destroyed", invalidate);
      }
      callback(allowed);
    })();
  });
}

module.exports = { installSitePermissions };
