---
name: live-browser
description: Stream the real Electron browser prototype in this repo to the user as a live, clickable view they can use from the T3 Code preview sidebar, a phone, or another machine on their tailnet. Use when the user asks to see, try, use, or demo the running app live or remotely, or asks to start or stop the live viewer.
---

# Live browser viewer

This gives the user a live, clickable view of the real Electron app from wherever they are. They can use the T3 Code preview sidebar, a phone, or any device on their Tailscale tailnet. It streams **only the app window**, not the Mac's screen, so it needs no Screen Sharing or VNC.

The app itself runs as a `verify-browser` run, with a fresh, throwaway profile built from the current checkout. This skill adds the viewer on top. Run every command from the repo root:

```sh
L=.claude/skills/live-browser/scripts/live-browser.mjs
node $L help
```

## Start

```sh
node $L start                        # app + viewer on http://localhost:6090/
node $L start --tailnet              # also https://<this-mac>.<tailnet>.ts.net:6090/ (tailnet only)
node $L start --open https://example.com --tailnet
```

- `start` runs `pnpm build` and launches the app, or reuses run `live` if it is already up. Then it starts the viewer and prints JSON with `local`, `tailnet` (when requested), and `fixtureOrigin`. The fixture origin is a local test site the app can load (`<origin>/<anything>`, `/links`).
- Pass `--no-build` only if `dist/` is current. Pass `--port` if 6090 is taken. Pass `--run <id>` for a second, independent instance.
- **T3 Code sidebar:** open the `local` URL with the preview tool, for example `preview_open` with `http://localhost:6090/`. If the user's T3 client is on another machine, use an `environment-port` target for port 6090. T3 forwards it as `localhost`, which browsers treat as a secure origin.
- **Phone or another machine:** give the user the `tailnet` URL. It is HTTPS with a valid Tailscale certificate, reachable only from their tailnet (not Funnel). `--tailnet` refuses to replace a `tailscale serve` entry on that port that points somewhere else.

## Status and stop

```sh
node $L status                       # running?, URLs, fixture origin
node $L stop                         # remove our tailnet entry, close the app, delete the run's scratch profile
```

`stop` only removes the `tailscale serve` entry if it still points at this viewer. Evidence under `.verify/evidence/<run>/` is kept. Always stop when the user is done. While the viewer runs, macOS `caffeinate` keeps the display awake, and it ends with the run.

## What the user can do in the viewer

- **Mouse and touch:** click, drag, and scroll anywhere. Input is routed to the view under the pointer (page, palette, or browser controls). On touch screens, tap clicks, double-tap selects a word, swipe scrolls, and long-press then move drags (for example, the split divider).
- **Keyboard:** click the window first (blue outline), then type. On phones, `⌨` opens the on-screen keyboard plus a key row: Esc, Tab, arrows, Enter, Backspace, Select all, Copy, Cut, Paste, ⌘K, ⌘L, Ctrl+Tab.
- **Copy and paste:** Cmd/Ctrl+C, X, V, and A (or the key-row buttons) run the app's own edit commands. Copied text goes to the user's device clipboard. If the browser denies clipboard access, a box shows the text instead. This uses, and overwrites, the Mac's clipboard.
- **Dropdowns:** `<select>` menus open as native macOS menus that the stream cannot show. The viewer intercepts them and shows the options with the device's own picker, or an in-page list, then applies the choice with real `input`/`change` events.
- **Fit:** resizes the real window to the viewer's shape, so a phone sees the app about twice as large. It is bounded by the app's 640 px minimum width and the Mac's screen. Turning it off restores 1280×850.
- **HD:** sends Retina frames. They are sharper and about 4× larger. Normal and HD viewers can watch at the same time.

## Gotchas

- **`DNS_PROBE_FINISHED_NXDOMAIN` on the tailnet URL:** the device is not resolving MagicDNS names. Usually the browser's "Secure DNS" (DNS over HTTPS) bypasses Tailscale. Turn it off, or run `tailscale set --accept-dns=true` on that device.
- **The viewer must be a secure origin** (`https://…ts.net` or `localhost`). A plain `http://<ip>` origin blocks the clipboard API.
- **Browser shortcuts:** the user's own browser keeps Cmd+L, Cmd+T, and Cmd+W. Point them to the app's buttons, the palette (⌘K key), or the key row.
- **Key focus:** keys go to the focused view, else the open palette, else the last tapped view. If typing lands in the wrong place, tap the target field first.
- **Restarts:** edits to `scripts/live.html` apply on page reload. Edits to `scripts/live.mjs` need `stop` then `start`, which resets the app to one empty tab.
- **Not proof:** for evidence that a change works, use `verify-browser` (drive, snapshot, screenshot). `Fit` changes the real window size, so turn it off before taking evidence.

## Files

- `scripts/live-browser.mjs`: start, status, and stop, including Tailscale.
- `scripts/live.mjs`: the viewer server (frames, input routing, dropdowns, clipboard, resize), loaded by `verify.mjs live`.
- `scripts/live.html`: the viewer page, read on every request.
