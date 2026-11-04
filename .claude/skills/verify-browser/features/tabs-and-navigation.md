# Tabs and navigation

A user opens tabs, loads pages from the address bar or the new-tab search box, moves through history, follows links that open new tabs, sees a retryable error page when a page cannot load, and closes tabs. Each tab keeps its own page and history.

## Sub-features

- `nav-address` loads an HTTP(S) address typed in the toolbar address field.
- `nav-newtab-search` loads an address or runs a search from the new-tab page's `Search the web` box.
- `nav-search-engine` turns non-address input into a search URL on the selected engine.
- `nav-history` goes back and forward with the toolbar buttons.
- `nav-reload` reloads the page, and the button becomes `Stop loading` while a page loads.
- `nav-home` returns the current tab to the new-tab page.
- `tab-new` opens a new empty tab from the `New tab` button or Cmd/Ctrl+T.
- `tab-popup` turns a `target=_blank` link into a new selected tab.
- `tab-isolation` keeps the browser API out of web pages.
- `nav-error` shows "This page couldn’t load." with `Try again`.
- `tab-close` closes tabs from the tab close button or Cmd/Ctrl+W. Closing the last tab leaves one empty tab.

## How to get to it (user POV)

- Type into the toolbar `Search or enter address` field and press Enter.
- Type into `Search the web` on the new-tab page and press Enter or choose `Go`.
- Choose toolbar `Back`, `Forward`, `Reload`/`Stop loading`, or `Home`.
- Choose `New tab` in the tab strip, or press Cmd/Ctrl+T (File > New tab).
- Click a link inside a page, including one that opens a new window.
- Choose `Close tab: <title>`, or press Cmd/Ctrl+W (File > Close tab).

## Driving it with verify.mjs

Preconditions:

- Baseline run is healthy and `O` holds the fixture origin.
- Evidence directory: `nav/`.

- **Load an address.** Type the fixture URL into the address field and submit. Run `node $V fill --role textbox --name "Search or enter address" --value "$O/links"`, then `node $V press --role textbox --name "Search or enter address" --key Enter`, then `node $V wait --until "state.tabs[0].title === 'Fixture /links' && !state.tabs[0].loading"`. The tab `Fixture /links` is selected and `node $V value --role textbox --name "Search or enter address"` prints `$O/links`.
- **Capture the loaded page.** Run `node $V snapshot --target active --out nav/links.aria.txt` and `node $V screenshot --out nav/links.png`. The snapshot shows heading `Fixture /links` with links `Next` and `Popup`. The screenshot shows the page under the toolbar.
- **Follow a link, then go back and forward.** Run `node $V click --role link --name Next --target "page:/links"`, then `node $V wait --role tab --name "Fixture /next"`. Run `node $V click --role button --name Back`, then `node $V wait --role tab --name "Fixture /links"`. Run `node $V click --role button --name Forward`, then `node $V wait --role tab --name "Fixture /next"`. Each wait passes and the address field follows the page.
- **Page isolation.** Run `node $V eval --js "return (await target('active')).evaluate(() => typeof window.browser === 'undefined' && typeof require === 'undefined')"`. Prints `true`.
- **Popup link opens a tab.** Run `node $V click --role button --name Back`, wait for `Fixture /links`, then `node $V click --role link --name Popup --target "page:/links"` and `node $V wait --until "state.tabs.length === 2 && state.tabs.find(t => t.id === state.activeId).url.endsWith('/popup-target')"`. A second selected tab `Fixture /popup-target` appears.
- **New tab and new-tab search.** Run `node $V click --role button --name "New tab"`, then `node $V wait --role heading --name "Where to next?"`. Run `node $V fill --role textbox --name "Search the web" --value "electron tabs"` and `node $V press --role textbox --name "Search the web" --key Enter`, then `node $V wait --until "state.tabs.at(-1).url.startsWith('https://duckduckgo.com/?q=electron')"`. The third tab's URL is a DuckDuckGo search.
- **Home.** Run `node $V click --role button --name Home`, then `node $V wait --role heading --name "Where to next?"`. The active tab shows the new-tab page again.
- **Menu new tab.** Run `node $V menu --path "File>New tab"`, then `node $V wait --until "state.tabs.length === 4"`. A fourth empty tab is selected. Report this as "menu handler verified, OS key binding not exercised".
- **Error page.** In the empty tab, run `node $V fill --role textbox --name "Search or enter address" --value "http://127.0.0.1:9/"` and press Enter as above, then `node $V wait --role heading --name "This page couldn’t load."`. Run `node $V screenshot --out nav/error.png`. A `Try again` button is visible.
- **Close tabs.** Run `node $V click --role button --name "Close tab: Fixture /popup-target"`, then `node $V wait --until "state.tabs.length === 3"`. Run `node $V menu --path "File>Close tab"` three times, then `node $V wait --until "state.tabs.length === 1 && !state.tabs[0].url"`. One empty tab remains with "Where to next?".
- **Proof.** Run `node $V state > .verify/evidence/<run>/nav/final-state.json` and `node $V screenshot --out nav/final.png`.

## Gotchas

- Playwright's `press Meta+T` does nothing. Use `menu --path "File>New tab"` or the `New tab` button.
- After `New tab`, the new tab's title is `New tab` too, so `--name "New tab"` on role `tab` matches it. Use role `button` to click the button.
- A search URL tab may never finish loading without network access, or may show an error page. Assert on `url`, not `title`.
- `http://127.0.0.1:9/` fails with Chromium's `ERR_UNSAFE_PORT` before any connection, so the error-page step does not depend on what is listening locally.
- Tab titles fall back to the URL while loading. Wait on `!loading` before asserting titles.
- Back/Forward are disabled until there is history, so a click on a disabled button times out instead of failing loudly.
