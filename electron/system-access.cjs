// macOS keeps its own consent for the app, apart from a site's consent.
// Chrome asks macOS after the user allows a site. Electron's Chromium asks only
// for camera and microphone capture, and a location request waits forever while
// macOS has not decided, or after macOS refuses. So ask here, after the user
// allows the site, and refuse the site when macOS refuses.
// A null systemPreferences or locationPermissions skips that kind of access.
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function askSystemAccess(types, { systemPreferences, locationPermissions, sleep = pause }) {
  for (const type of types) {
    if ((type === "audio" || type === "video") && systemPreferences) {
      const device = type === "audio" ? "microphone" : "camera";
      if (!(await systemPreferences.askForMediaAccess(device))) return false;
    }
    if (type === "geolocation" && locationPermissions) {
      let status = locationPermissions.getAuthStatus("location");
      // Asking a denied app again would open System Settings by itself.
      if (status === "not determined") {
        locationPermissions.askForLocationAccess("when-in-use");
        // macOS gives no answer event to this module, so read the status until
        // the user answers. After two minutes, let Chromium wait instead.
        for (let waited = 0; status === "not determined" && waited < 120_000; waited += 500) {
          await sleep(500);
          status = locationPermissions.getAuthStatus("location");
        }
      }
      if (status === "denied" || status === "restricted") return false;
    }
  }
  return true;
}

module.exports = { askSystemAccess };
