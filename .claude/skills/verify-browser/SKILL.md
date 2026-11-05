---
name: verify-browser
description: Launch and drive the real Electron browser prototype in this repo (tabs, address bar, command palette, split view, settings) through Playwright, and capture screenshots, ARIA snapshots, and an action log as proof. Use when you must show that a browser change works in the running app, reproduce a UI bug, or check behavior that unit tests cannot reach.
---

# Verify the Electron browser

The product surface is a desktop app: Electron main process (`electron/main.cjs`) plus a Svelte "chrome" (the local browser controls) loaded from `dist/`. Web pages are separate native `WebContentsView`s stacked over the chrome. The command palette is another transparent local view. There is no server or CLI to drive.

Drive the app with `scripts/verify.mjs`. It starts one isolated app per **run** in a detached host process, and each CLI call performs one user action against it. Run every command from the repo root:

```sh
V=.claude/skills/verify-browser/scripts/verify.mjs
node $V help
```

Read `features/README.md` for the feature map, then use the matching feature file as the recipe.

## Launch

```sh
node $V launch --run my-check     # omit --run for a timestamped id
```

- Runs `pnpm build` first, because the app loads `dist/index.html` and `dist/preload.cjs`, and a stale `dist/` would verify old code. Pass `--no-build` only if you just built and changed nothing since.
- Starts Electron with `--user-data-dir=.verify/runs/<run>/profile`, an empty profile. Settings start at defaults (theme `system`, tabs `top`, DuckDuckGo, shortcuts shown) and one empty tab is open.
- Also starts a local fixture web server on a random loopback port, the `fixtureOrigin`. Any path returns `<title>Fixture /<path></title>`. `/links` has a same-tab link `Next` and a popup link `Popup`. `/slow` responds after 5 s.
- **Ready** means: the window's chrome has `window.browser`, the `Browser tabs` tablist has rendered, and the session reports at least one tab. `launch` blocks until then (90 s limit), then prints JSON with `run`, `fixtureOrigin`, `profile`, `evidence`, and the pids it owns. If launch fails, read `.verify/runs/<run>/host.log`.
- Separate runs are isolated: each gets its own profile, fixture port, and control port, so several can run at once. Pass `--run <id>` (or set `VERIFY_RUN`) when more than one is live. With exactly one live run, commands find it automatically.
- Never drive the user's own `pnpm dev`/`pnpm start` window. It uses the real default profile, and this tool cannot attach to it.

## Doctor

```sh
node $V doctor     # read-only; exit 0 = healthy, 2 = not worth driving
```

Checks that the host and Electron pids are alive, that the control port answers, and that the chrome is ready. It reports the tab count, the current settings, the Electron version, `builtFrom` against `checkoutRev`, and `distStale`, which is true when `src/`, `shared/`, or `electron/` changed after the last build. Run it first whenever something looks off. If it reports stale or a revision mismatch, `cleanup`, then `launch` again (launch rebuilds).

## Drive

Commands act on a **target**: `chrome` (default, the browser controls), `palette` (the command palette view, only while open), `page:<url substring>` (a web page in a tab), or `active` (the active tab's page).

Locators use stable handles from the app's ARIA markup: `--role R --name N` (exact name by default, `--loose` for substring), `--label L`, `--text T`, `--css S`, plus `--nth N` if needed.

| Need                                                    | Command                                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| See what is on screen                                   | `node $V snapshot [--target T] [--out f.aria.txt]`                                                         |
| Click / fill / choose                                   | `click`, `fill --value V`, `select --value V` with a locator                                               |
| Key on a focused field                                  | `press --key Enter --role textbox --name "Search or enter address"`                                        |
| App keyboard shortcut (Cmd+K/L, Ctrl+Tab, Cmd+1–9, Esc) | `node $V shortcut --key K --modifiers meta [--target T]`                                                   |
| Menu-only shortcut (Cmd+T, Cmd+W, Cmd+,)                | `node $V menu --path "File>New tab"` / `"File>Close tab"` / `"View>Settings…"`                             |
| Wait for UI                                             | `node $V wait --role tab --name "Fixture /a" [--state hidden]`                                             |
| Wait for browser state                                  | `node $V wait --until "state.tabs.length === 2 && !state.tabs[1].loading"`                                 |
| Full session state                                      | `node $V state` (tabs, activeId, split, palette, settingsOpen, settings, tabSlots)                         |
| Restart with the same profile                           | `node $V relaunch` (for persistence checks)                                                                |
| Escape hatch                                            | `node $V eval --js "return (await target('active')).title()"` (gets `app, chrome, pages, target, fixture`) |

Rules that save time:

- **Shortcuts:** use `shortcut`, not `press`. The app handles shortcuts in Electron's `before-input-event`, which Playwright's `press` does not reach. By default the key goes to the focused webContents, like a real keypress. Pass `--target chrome` when focus is ambiguous, for example right after `menu`.
- **Menu shortcuts:** Cmd+T, Cmd+W, Cmd+, and Cmd+R are native menu accelerators. Synthetic keys cannot fire them, so `menu` clicks the same menu item instead. Report that you verified the menu handler, not the OS key binding.
- **Wait on state, not sleep:** page loads are asynchronous. After a navigation, wait with `--until "...!loading"` before asserting or screenshotting.
- **Palette:** the `palette` target only exists after the palette has opened once. Wait for `combobox "Search or enter a command"` on `--target palette` before driving it.

## Evidence

Everything goes to `.verify/evidence/<run>/` (gitignored). That directory survives `cleanup`.

- `actions.jsonl` is written automatically: one line per command with arguments, result, and errors. It is the action log for your proof.
- `node $V screenshot --out <feature>/<step>.png` captures the whole window with the visible page, split, and palette views composited in place. Playwright's own page screenshot shows only the chrome, with an empty page area.
- `node $V snapshot --target T --out <feature>/<step>.aria.txt` saves the accessible tree with its target and URL.
- `node $V note --text "..."` adds your own observation to the log.

Proof standards:

- Exercise the real user path: buttons, address fields, palette, shortcuts, menus. Do not call `window.browser.*` setters through `eval` to cause a change. `eval` and `state` are for **observing**.
- Capture the action and the resulting state: a snapshot or screenshot before and after, plus the `wait --until` that proved the state change.
- Verify side effects as well as pixels. Settings land in `.verify/runs/<run>/profile/settings.json`, so copy it into evidence before cleanup (`cp .verify/runs/<run>/profile/settings.json .verify/evidence/<run>/`) and check it survives `relaunch`. Check that page state survives (no reload) by setting a marker in the page with `eval` and reading it back.
- Search queries resolve to real engines (`https://duckduckgo.com/?q=…`). Assert the tab URL in `state`. Whether that page loads depends on the network and is not part of the proof.
- The only stand-in is the fixture server, which replaces remote websites. Everything else is the production app.

## Live view for a human

When the user wants to watch or use the app themselves (T3 sidebar, phone, another machine), use the `live-browser` skill. `node $V live [--port 6090]` is the low-level hook it calls on a launched run. The viewer is a viewing aid, not proof.

## Cleanup

```sh
node $V cleanup              # current run (or --run <id>)
node $V cleanup --all        # every run under .verify/runs, live or stale
```

Asks the host to close Electron and its servers. If it doesn't respond, `cleanup` sends SIGKILL only to the host and Electron pids recorded in that run's `session.json`, never to processes matched by name. Then it deletes `.verify/runs/<run>/` (profile, session, log). It never touches `.verify/evidence/`. If a failed attempt stranded a run, `cleanup --all` clears it. `runs` lists live ones.

## Helpers

- `node $V live` loads the viewer from `.claude/skills/live-browser/scripts/live.mjs`.
- `scripts/verify.mjs` is the entire harness; `node $V help` prints usage. It needs the repo's `node_modules` (`pnpm install`) and imports `@playwright/test` from there.
- Shell example for the fixture origin: `O=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".verify/runs/<run>/session.json")).fixtureOrigin)')`.
- Tested on macOS (shortcut modifier `meta`). On Linux or Windows, use `--modifiers control` where the app says Cmd/Ctrl. The macOS app menu adds a leading app-name menu, but `File` and `View` paths are the same.
