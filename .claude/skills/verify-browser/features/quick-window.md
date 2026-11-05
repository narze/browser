# Quick window

A user opens a small, separate window for a fast lookup, without leaving the tabs in the main window. Links that other apps open in the browser also show there. **Open in browser** moves the page, without a reload, into the main window as a selected tab, and the quick window closes.

## Sub-features

- `quick-open` opens an empty quick window with the address field focused, from Cmd/Ctrl+Alt+N, File > New quick window, or the palette.
- `quick-lookup` loads an address or a search in the quick window, not in a tab.
- `quick-external` shows links from other apps (launch arguments, a second launch, `open-url`) in the quick window. A second launch hands its link to the running app and quits.
- `quick-move` moves the page into the main window as a tab with **Open in browser**. The button is off while the window is empty.
- `quick-close` closes the quick window and its page with Cmd/Ctrl+W in that window or the window's close button. It also closes with the main window.

## How to get to it (user POV)

- Press Cmd/Ctrl+Alt+N.
- File menu: `New quick window`.
- Command palette: `> New quick window`.
- Open a link from another app while the browser is the default browser.

## Driving it with verify.mjs

Preconditions:

- Baseline run is healthy and `O` holds the fixture origin.
- Evidence directory: `quick/`.

- **Open.** `node $V shortcut --key N --modifiers meta,alt --target active`. `node $V wait --target quick --role textbox --name "Search or enter address"` passes and the field has focus. `node $V screenshot --window quick --out quick/empty.png` shows "Quick window" and a disabled `Open in browser`.
- **Look up.** `node $V fill --target quick --role textbox --name "Search or enter address" --value "$O/lookup"`, then `press --target quick --key Enter` on the same field. `wait --until "state.mini && state.mini.title === 'Fixture /lookup' && !state.mini.loading"` passes, and `state.tabs` does not change. `node $V screenshot --window quick --out quick/lookup.png`.
- **Move to a tab.** `node $V click --target quick --role button --name "Open in browser"`. `wait --until "!state.mini && state.tabs.some(t => t.title === 'Fixture /lookup' && t.id === state.activeId)"` passes, and only one window is left.
- **Close.** Open it again and send Cmd+W with `shortcut --key W --modifiers meta --target page:/lookup` (or to the quick chrome). `wait --until "!state.mini"` passes.

## Gotchas

- The quick window is a second `BrowserWindow`. `screenshot` without `--window quick` captures the main window only.
- The `page:` target excludes the quick window's chrome (`#mini`) but includes its web page.
- A second launch with a link needs the same `--user-data-dir`. The single-instance lock is per profile, so another profile starts a separate app.
