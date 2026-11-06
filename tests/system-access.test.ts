import { describe, expect, it, vi } from "vite-plus/test";
import { askSystemAccess } from "../electron/system-access.cjs";

// Each location status read returns the next value; the last value repeats.
function system(media = true, ...location: string[]) {
  const statuses = location.length ? location : ["not determined"];
  return {
    systemPreferences: { askForMediaAccess: vi.fn(async () => media) },
    locationPermissions: {
      getAuthStatus: vi.fn(() => (statuses.length > 1 ? statuses.shift()! : statuses[0])),
      askForLocationAccess: vi.fn(),
    },
    sleep: vi.fn(async () => {}),
  };
}

describe("macOS access for allowed site permissions", () => {
  it("asks macOS for each allowed device, and fails when macOS refuses", async () => {
    const allowed = system();
    expect(await askSystemAccess(["audio", "video"], allowed)).toBe(true);
    expect(allowed.systemPreferences.askForMediaAccess.mock.calls).toEqual([
      ["microphone"],
      ["camera"],
    ]);
    expect(await askSystemAccess(["video"], system(false))).toBe(false);
  });

  it("asks macOS for location while undecided, and waits for its answer", async () => {
    const allowed = system(true, "not determined", "not determined", "authorized");
    expect(await askSystemAccess(["geolocation"], allowed)).toBe(true);
    expect(allowed.locationPermissions.askForLocationAccess).toHaveBeenCalledWith("when-in-use");
    expect(allowed.sleep).toHaveBeenCalledTimes(2);
    // Chromium never hears a macOS refusal, so the site would wait forever.
    expect(await askSystemAccess(["geolocation"], system(true, "not determined", "denied"))).toBe(
      false,
    );
  });

  it("stops waiting for an unanswered macOS prompt after two minutes", async () => {
    const waiting = system();
    expect(await askSystemAccess(["geolocation"], waiting)).toBe(true);
    expect(waiting.sleep).toHaveBeenCalledTimes(240);
    expect(waiting.sleep).toHaveBeenCalledWith(500);
  });

  it("does not ask again once macOS has decided", async () => {
    // Asking a denied app again would open System Settings by itself.
    for (const [status, allowed] of [
      ["authorized", true],
      ["denied", false],
      ["restricted", false],
    ] as const) {
      const decided = system(true, status);
      expect(await askSystemAccess(["geolocation"], decided)).toBe(allowed);
      expect(decided.locationPermissions.askForLocationAccess).not.toHaveBeenCalled();
    }
  });

  it("skips what it cannot ask, and permissions macOS does not gate", async () => {
    expect(
      await askSystemAccess(["video", "geolocation", "notifications", "clipboard-read"], {
        systemPreferences: null,
        locationPermissions: null,
      }),
    ).toBe(true);
    const access = system();
    expect(await askSystemAccess(["notifications", "clipboard-read"], access)).toBe(true);
    expect(access.systemPreferences.askForMediaAccess).not.toHaveBeenCalled();
    expect(access.locationPermissions.getAuthStatus).not.toHaveBeenCalled();
  });
});
