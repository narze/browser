# Electron references for this browser prototype

Research date: 2026-11-04. Inspected shallow source clones, pinned below; upstream behavior was not executed. Local observations refer to the working tree at research time, which other contributors are editing. Recommendations are engineering judgments, not upstream guarantees.

## Applied in this prototype

- Added `shared/browser.d.ts` and a checked JSDoc type for the preload API, shared with the Svelte interface.
- Added runtime tab-ID validation, parsed HTTP(S) URL policy, and a per-source-tab popup burst limit. The limit is a small prototype policy, not Yalqen's user-activation blocker.
- Added the main-frame check for in-page navigation. The Electron regression test first reproduced an iframe replacing the address bar, then passed with the check.
- Kept isolated website views, sender/frame authorization, asynchronous bridge calls, subscription disposal, and explicit tab destruction.
- Unified development and built-app launch in `scripts/start.mjs`; both clear `ELECTRON_RUN_AS_NODE`. Documented main/preload restart requirements and popup/closing limitations in the README.

The notes below describe the source review snapshot before these changes. The app uses the patterns as design references; it does not copy either application's runtime implementation.

| Repository       | Inspected commit                           | License                            |
| ---------------- | ------------------------------------------ | ---------------------------------- |
| pingdotgg/t3code | `3d369d55968b09861bf61ba8ebb2eeb6f02973ba` | [MIT, T3 Tools Inc.][t-license]    |
| YSamed/yalqen    | `6372df8b08e69144a336254e539f0ea736433fa0` | [MIT, Yaşar Samed Erol][y-license] |

Retain the applicable MIT notice when copying substantial source. Yalqen is the closer reference for Svelte browser tabs; T3 Code supplies useful IPC and popup examples. Keep this app’s Electron + Svelte + Vite/Vite+ shape; neither reference requires adopting its monorepo, backend, agent integration, or service framework.

## Already present: preserve these decisions

- **Separate chrome and websites.** Local `electron/main.cjs` gives only the trusted chrome and palette views the bundled `dist/preload.cjs`; remote `WebContentsView`s have `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`. Yalqen applies the same flags and blocks chrome navigation/popups ([window source][y-window]). Its remote tabs also have a page preload ([tab creation][y-create]); this prototype does not need that extra capability.
- **Narrow bridge and subscriptions.** Local `electron/preload.ts` uses `shared/commands.js` to expose named operations, strips Electron event objects, and returns unsubscribe functions; `src/App.svelte` calls them on unmount. Both [Yalqen’s typed bridge][y-preload] and [T3’s bridge][t-preload] demonstrate this pattern. Keep raw `ipcRenderer`, arbitrary channel names, and filesystem access out of the renderer API.
- **Authorize in main.** Local `installIpc()` checks both chrome `webContents` identity and main-frame identity. [T3’s permission helper][t-sender] has the same pair of checks. Keep them on every browser control; renderer types alone do not authorize callers.
- **Explicit ownership.** Local close-tab detaches the view and closes its contents; window teardown closes remaining tab contents. [Yalqen’s destroyView][y-destroy] likewise removes listeners, detaches, checks destruction, and closes. Hiding or detaching a tab must not be mistaken for destroying it.
- **Useful prototype scope.** Local navigation admits HTTP(S), handles main-frame load failures/crashes, denies website permission requests/checks, and shares cookies through `persist:browsing`. `scripts/dev.mjs` waits for Vite before Electron, clears `ELECTRON_RUN_AS_NODE`, and closes Vite on exit/signals. Keep these simple boundaries.

## Worth adopting now

| Small change                           | Evidence and concrete application                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Check the in-page frame                | [Yalqen checks `isMainFrame`][y-navigation]. Local `navigated` is shared by `did-navigate` and `did-navigate-in-page` and ignores the latter’s frame flag. Add a separate in-page adapter so iframe history cannot overwrite the address bar. Test with an iframe calling `history.pushState`.                                                                                                                                                            |
| Make the small IPC contract checkable  | [Yalqen centralizes channel constants/action/API types][y-types]; [T3 decodes unknown payloads before handlers][t-decode]. Local `src/env.d.ts` describes the API but does not check the CJS main/preload implementations. Use a small shared declaration plus checked JSDoc or TypeScript at that boundary. Keep per-method calls; validate finite integer tab IDs and address strings in main with simple guards. No Effect/schema framework is needed. |
| Bound popup creation                   | [Yalqen consumes recent user activation and records blocked popups][y-popups][y-window-requests]. Local `setWindowOpenHandler` creates a new tab for every HTTP(S) request. Add a small activation/rate policy before creating tabs, keep deny as the native-window default, and centralize URL parsing for address input, page navigation, redirects, and popups. Test script-driven popup floods and mixed-case/disallowed schemes.                     |
| Keep destruction safe as features grow | [Yalqen tracks listener disposers][y-listeners] and checks the captured view is still current after a crash ([source][y-navigation]). Local teardown already closes contents. If adding async tab work, guard against a closed/replaced view before publishing or calling Electron; detach listeners/timers in one disposal function. Do not build a tab framework now.                                                                                   |

## Browser-specific behavior to document or test

- **Popup-to-new-tab is deliberately limited.** Yalqen adopts Chromium’s popup contents to preserve `window.opener` ([source][y-create]); T3 distinguishes real windows, tab links, POST requests, and denied protocols ([implementation][t-popup], [tests][t-popup-tests]). Local `newTab(url)` reconstructs a GET navigation: it does not preserve the original opener or POST body. Ordinary `_blank` links are sufficient for this prototype; do not claim full OAuth/payment popup support. Preserve sandbox/isolation and reapply navigation policies if real popups are added later.
- **Closing discards page unload vetoes.** Local `close({ waitForBeforeUnload: false })` makes closing predictable but can discard edits. Yalqen handles `will-prevent-unload` and tracks interaction ([source][y-window-requests]). Defer a confirm-close flow until form editing is in scope.
- **Hidden tabs remain live; persistence means disk cookies.** Local inactive views are hidden, not suspended, and every tab uses the same persistent partition. Yalqen separates tab records from lazily created views ([source][y-create]). Keep eager creation for a few prototype tabs; defer discard/restore, private profiles, and session recovery. Do not label this app private/incognito.

## Dev/build and testing

- Local `scripts/dev.mjs` already has a single idempotent cleanup path. Verify closing Electron/Ctrl-C releases port 5173; renderer HMR does not restart main/preload, so document restart after CJS changes. If shutdown hangs appear, await child exit with a bounded fallback before exiting the launcher.
- Current CJS preload only requires Electron and needs no bundler. If it acquires shared runtime imports, follow [Yalqen’s self-contained CJS preload build][y-build]: bundle each preload, externalize Electron, clean only its output directory. Keep renderer relative assets (`vite.config.ts`, `base: "./"`) and test the built `loadFile` path. Do not add backend startup orchestration.
- Local `tests/navigation.test.ts` checks address resolution; `tests/e2e/browser.spec.ts` launches real Electron with a temporary profile/local HTTP fixture and checks history, tabs, popup links, remote isolation, and last-tab replacement. Retain this split. [T3’s popup tests][t-popup-tests] and [Yalqen’s activation tests][y-popup-tests] show small policy tests; [Yalqen also runs Electron runtime tests with timeouts][y-runtime]. Next useful cases: iframe navigation, blocked redirects/popups, crash/reload, destroyed contents after close, denied permissions, and resize/tab focus. Test sender/frame rejection at the IPC boundary; use real Electron for isolation claims.

## Do not copy / defer

- **Do not weaken context isolation for a picker.** T3’s preview preferences explicitly use `contextIsolation=false` with sandboxing ([source][t-preferences]); its popup code restores isolation because those popups bypass guest hardening ([source][t-popup-flags]). That is specialized preview machinery, not a baseline for arbitrary websites.
- **Do not generalize synchronous preload IPC.** [T3 uses `sendSync` for migration/branding bootstrap][t-preload]; keep this prototype’s async invokes. Avoid growing its broad desktop bridge, remote-page automation, auth, or agent/backend surface here.
- **Do not replace frame validation with a typed cast.** [Yalqen’s general UI sender helper checks contents identity; its agent helper additionally checks the main frame][y-sender]. Preserve the stronger existing local rule for every privileged call, and validate runtime arguments independently.
- **Defer release infrastructure:** packaging, signing/notarization, updater trust, Electron fuses, permission prompts scoped to origins, downloads, external-protocol consent, certificate UX, and update cadence need explicit product work before distribution. [Yalqen’s package configuration][y-package] illustrates that additional scope. Keep certificate verification enabled; an HTTPS URL alone is not a full browser security indicator. These production concerns do not justify a larger prototype architecture.

[t-license]: https://github.com/pingdotgg/t3code/blob/3d369d55968b09861bf61ba8ebb2eeb6f02973ba/LICENSE#L1-L21
[y-license]: https://github.com/YSamed/yalqen/blob/6372df8b08e69144a336254e539f0ea736433fa0/LICENSE#L1-L21
[y-window]: https://github.com/YSamed/yalqen/blob/6372df8b08e69144a336254e539f0ea736433fa0/apps/browser/src/main/window/window.ts#L251-L264
[y-create]: https://github.com/YSamed/yalqen/blob/6372df8b08e69144a336254e539f0ea736433fa0/apps/browser/src/main/tabs/tabs.ts#L1395-L1457
[y-preload]: https://github.com/YSamed/yalqen/blob/6372df8b08e69144a336254e539f0ea736433fa0/apps/browser/src/preload/preload.ts#L17-L27
[t-preload]: https://github.com/pingdotgg/t3code/blob/3d369d55968b09861bf61ba8ebb2eeb6f02973ba/apps/desktop/src/preload.ts#L34-L107
[t-sender]: https://github.com/pingdotgg/t3code/blob/3d369d55968b09861bf61ba8ebb2eeb6f02973ba/apps/desktop/src/permissions/MacPermissionHelper.ts#L134-L145
[y-destroy]: https://github.com/YSamed/yalqen/blob/6372df8b08e69144a336254e539f0ea736433fa0/apps/browser/src/main/tabs/tabs.ts#L1848-L1868
[y-navigation]: https://github.com/YSamed/yalqen/blob/6372df8b08e69144a336254e539f0ea736433fa0/apps/browser/src/main/tabs/tabs.ts#L1783-L1792
[y-types]: https://github.com/YSamed/yalqen/blob/6372df8b08e69144a336254e539f0ea736433fa0/apps/browser/src/shared/types.ts#L375-L507
[t-decode]: https://github.com/pingdotgg/t3code/blob/3d369d55968b09861bf61ba8ebb2eeb6f02973ba/apps/desktop/src/ipc/DesktopIpc.ts#L213-L223
[y-popups]: https://github.com/YSamed/yalqen/blob/6372df8b08e69144a336254e539f0ea736433fa0/apps/browser/src/main/tabs/popups.ts#L4-L23
[y-window-requests]: https://github.com/YSamed/yalqen/blob/6372df8b08e69144a336254e539f0ea736433fa0/apps/browser/src/main/tabs/tabs.ts#L1566-L1613
[y-listeners]: https://github.com/YSamed/yalqen/blob/6372df8b08e69144a336254e539f0ea736433fa0/apps/browser/src/main/tabs/tabs.ts#L1499-L1515
[t-popup]: https://github.com/pingdotgg/t3code/blob/3d369d55968b09861bf61ba8ebb2eeb6f02973ba/apps/desktop/src/preview/Manager.ts#L451-L465
[t-popup-tests]: https://github.com/pingdotgg/t3code/blob/3d369d55968b09861bf61ba8ebb2eeb6f02973ba/apps/desktop/src/preview/Manager.test.ts#L72-L139
[y-build]: https://github.com/YSamed/yalqen/blob/6372df8b08e69144a336254e539f0ea736433fa0/apps/browser/scripts/build-preload.mjs#L6-L32
[y-popup-tests]: https://github.com/YSamed/yalqen/blob/6372df8b08e69144a336254e539f0ea736433fa0/apps/browser/test/main/tabs/popups.test.mjs#L11-L39
[y-runtime]: https://github.com/YSamed/yalqen/blob/6372df8b08e69144a336254e539f0ea736433fa0/apps/browser/scripts/test-runtime.mjs#L40-L52
[t-preferences]: https://github.com/pingdotgg/t3code/blob/3d369d55968b09861bf61ba8ebb2eeb6f02973ba/apps/desktop/src/preview/WebviewPreferences.ts#L1-L3
[t-popup-flags]: https://github.com/pingdotgg/t3code/blob/3d369d55968b09861bf61ba8ebb2eeb6f02973ba/apps/desktop/src/preview/Manager.ts#L438-L445
[y-sender]: https://github.com/YSamed/yalqen/blob/6372df8b08e69144a336254e539f0ea736433fa0/apps/browser/src/main/main.ts#L773-L780
[y-package]: https://github.com/YSamed/yalqen/blob/6372df8b08e69144a336254e539f0ea736433fa0/apps/browser/package.json#L70-L164
