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

function installMediaPermissions(browsing, { prompt }) {
  const grants = new Map();
  // Restrict requests to the top-level site's origin, including same-origin frames.
  const originFor = (contents, url) => {
    if (!contents || contents.isDestroyed()) return null;
    const origin = secureOrigin(url);
    return origin && origin === secureOrigin(contents.getURL()) ? origin : null;
  };
  browsing.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    if (permission !== "media") return false;
    const origin = originFor(contents, details.requestingUrl ?? requestingOrigin);
    return !!origin && !!grants.get(origin)?.has(details.mediaType);
  });
  browsing.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = originFor(contents, details.requestingUrl);
    const types = details.mediaTypes;
    if (
      permission !== "media" ||
      !origin ||
      !types?.length ||
      !types.every((type) => type === "audio" || type === "video")
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
          const devices = grants.get(origin) ?? new Set();
          types.forEach((type) => devices.add(type));
          grants.set(origin, devices);
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

module.exports = { installMediaPermissions };
