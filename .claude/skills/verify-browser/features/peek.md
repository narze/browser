# Peek

A user opens a link in a card above the current page instead of in a new tab. Alt+click opens any link this way. In a pinned tab or a favorite, a plain click on a link to another site also opens a peek, so the tab stays on its page. The page behind stays live and dimmed. Escape or a click outside the card closes the peek, and **Open as tab** keeps the page, without a reload, as a new tab.

## Sub-features

- `peek-alt-click` opens a link in a peek with Alt+click, without a new tab.
- `peek-pinned` opens links to another site from a pinned tab or favorite in a peek. Links on the same site navigate the tab.
- `peek-close` closes the peek with Escape (in the peeked page or the frame), a click outside the card, or **Close peek**.
- `peek-expand` moves the peeked page into a new, selected tab with **Open as tab**. The page does not reload.
- `peek-leave` closes the peek when the user selects another tab, opens a new tab, the settings, the archive, the palette, or another space.

## How to get to it (user POV)

- Alt+click a link on a web page.
- In a pinned tab or a favorite, click a link to another site.

## Driving it with verify.mjs

Preconditions:

- Baseline run is healthy and `O` holds the fixture origin.
- Load `$O/links` in the first tab and wait until it is not loading. The `Elsewhere` link goes to `localhost` instead of `127.0.0.1`, which is another site.
- Evidence directory: `peek/`.

- **Alt+click.** Native input is needed (see Gotchas). Run `node $V eval --js "..."` with an `app.evaluate` body that finds the `/links` webContents, moves the pointer to (1, 1), sends `keyDown` `Alt`, moves the pointer onto `a[href*=elsewhere]`, waits for `update-target-url` with that link, sends `mouseDown` and `mouseUp` (left button), then `keyUp` `Alt`. `wait --until "state.peek && state.peek.title === 'Fixture /elsewhere' && !state.peek.loading"` passes and `state.tabs.length === 1`.
- **See the frame.** `node $V snapshot --target peek --out peek/open.aria.txt` shows `region "Peek"` with the title, the host, and the buttons `Open as tab` and `Close peek`. `node $V screenshot --out peek/open.png`.
- **Close.** `node $V press --target peek --key Escape --css body`, or `node $V click --target peek --css .peek-backdrop`. `wait --until "!state.peek"` passes.
- **Open as tab.** Peek again, set a marker in the peeked page through `eval` (`executeJavaScript("window.marker = 99")`), then `node $V click --target peek --role button --name "Open as tab"`. `wait --until "!state.peek && state.tabs.length === 2"` passes, the new tab is selected, and the marker reads back as 99.

## Gotchas

- Electron's mouse events carry no modifier keys, so the app tracks Alt from key events. Hold Alt with native `keyDown`/`keyUp` through `sendInputEvent`; `click --modifiers` from Playwright goes to the chrome view, not the page.
- The app peeks only the link that the page reports under the pointer (`update-target-url`). Move the pointer off the link first, or the page sends no new report.
- `screenshot` composites the page views but not their rounded corners or the dim of the live page behind the frame. Use an OS capture when those pixels matter.
