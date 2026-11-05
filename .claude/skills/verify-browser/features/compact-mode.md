# Compact mode

A user hides the toolbar and tabs so the page uses the whole window. Moving the pointer to the top edge, or to the tab sidebar's edge in a side layout, shows them again, and the page moves below them. Moving the pointer back onto the page hides them. On macOS the window buttons hide with them.

## Sub-features

- `compact-toggle` turns compact mode on and off with Cmd/Ctrl+Shift+S, View > Compact mode, the palette, or Settings > Appearance.
- `compact-full-page` gives the page the whole window while the chrome is hidden.
- `compact-edge-reveal` shows the chrome when the pointer reaches the top edge, or the sidebar's side edge in a left or right layout.
- `compact-hide` hides the chrome when the pointer moves back onto the page.
- `compact-focus` keeps the chrome visible while a chrome control has focus (for example the address field after Cmd/Ctrl+L) and while a tab is dragged.

## How to get to it (user POV)

- Press Cmd/Ctrl+Shift+S.
- View menu: `Compact mode`.
- Command palette: `> Turn on compact mode` / `> Turn off compact mode`.
- Settings > Appearance: the `Compact mode` checkbox.

## Driving it with verify.mjs

Preconditions:

- Baseline run is healthy and `O` holds the fixture origin.
- Load `$O/a` in the first tab and wait until it is not loading.
- Evidence directory: `compact/`.

- **Turn on.** Run `node $V shortcut --key S --modifiers meta,shift --target active`. `wait --until "state.settings.compactMode"` passes, and `node $V wait --role tab --name "Fixture /a" --state hidden` passes.
- **Full page.** `node $V eval --js "return app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return [w.getContentSize(), w.contentView.children.filter(v => v.getVisible()).map(v => v.getBounds())]; })"` shows one view at x 0, y 0 with the full content size. `node $V screenshot --out compact/hidden.png`.
- **Reveal from the edge.** Native pointer moves are needed: `node $V eval --js "await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(c => c.getURL().includes('/a')).sendInputEvent({ type: 'mouseMove', x: 400, y: 0 })); return 'ok'"`. The tab becomes visible and the page view moves down by the chrome height. `node $V screenshot --out compact/revealed.png`.
- **Hide again.** Send `mouseMove` to `x: 400, y: 300` the same way. The tab hides and the page returns to y 0.

## Gotchas

- `hover` and Playwright mouse moves go to the chrome view, not the page view, so they do not reach the edge detector. Use `sendInputEvent` on the page's webContents.
- In the left or right layout, only that side's edge and the top edge reveal the chrome.
- The setting persists across `relaunch`. Start a new run to get the default (off).
