# Settings

A full-window Settings screen lets the user choose a theme (System, Light, Dark), tab placement, search engine (DuckDuckGo, Google, Bing), and whether shortcuts show on the new-tab page. Changes save automatically, apply immediately (including to web pages' `prefers-color-scheme`), and survive a restart. Opening Settings hides the current page without reloading it.

## Sub-features

- `settings-open` opens from the toolbar `Settings` button, Cmd/Ctrl+, (View > Settings…), or the palette's `Open settings`.
- `settings-theme` applies a theme to the chrome, palette, and web pages.
- `settings-layout` moves tabs to the top, left, or right.
- `settings-search-engine` changes which engine non-address input searches.
- `settings-shortcuts` shows or hides the new-tab page quick links.
- `settings-persist` keeps choices across an app restart.
- `settings-close` returns to the same live page with `Back to browsing`.

## How to get to it (user POV)

- Choose `Settings` in the toolbar.
- Press Cmd/Ctrl+, (View > Settings…).
- Command palette: `> settings`.

## Driving it with verify.mjs

Preconditions:

- Baseline run is healthy and `O` holds the fixture origin.
- Load `$O/kept` in the first tab and wait until it is not loading.
- Mark the page: `node $V eval --js "return (await target('page:/kept')).evaluate(() => (window.keptMarker = 42))"`.
- Evidence directory: `settings/`.

- **Open.** Run `node $V click --role button --name Settings`, then `node $V wait --role heading --name Settings`. `state.settingsOpen` is `true`, and `node $V screenshot --out settings/open.png` shows the settings screen with no page drawn over it.
- **Theme.** Run `node $V select --label Theme --value dark`. `wait --until "state.settings.theme === 'dark' && state.resolvedTheme === 'dark'"` passes. `node $V eval --js "return chrome.locator('html').getAttribute('data-theme')"` prints `dark`.
- **Search engine.** Run `node $V select --css "#search-engine" --value google`. `wait --until "state.settings.searchEngine === 'google'"` passes.
- **Shortcuts toggle.** Run `node $V click --css "#show-shortcuts"`. `wait --until "state.settings.showShortcuts === false"` passes.
- **Layout.** Run `node $V click --css "input[name=settings-layout][value=left]"`. `wait --until "state.settings.tabLayout === 'left'"` passes.
- **Back to the same page.** Run `node $V click --role button --name "Back to browsing"`, then `wait --until "!state.settingsOpen"`. `node $V eval --js "return (await target('page:/kept')).evaluate(() => window.keptMarker)"` prints `42` (no reload). The page is dark: `node $V eval --js "return (await target('page:/kept')).evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)"` prints `true`.
- **Search uses the new engine.** Type `kittens` into the address field and press Enter. `wait --until "state.tabs[0].url.startsWith('https://www.google.com/search?q=kittens')"` passes.
- **Persist.** Run `cp .verify/runs/<run>/profile/settings.json .verify/evidence/<run>/settings/settings.json`, then `node $V relaunch`, then `wait --until "state.settings.theme === 'dark' && state.settings.searchEngine === 'google' && state.settings.tabLayout === 'left' && state.settings.showShortcuts === false"`. Run `node $V snapshot --out settings/after-restart.aria.txt`. The new-tab page has no `GitHub`/`Wikipedia` quick links, and `tablist "Browser tabs"` is vertical.

## Gotchas

- The theme select has `aria-labelledby` pointing at its label, so `--label Theme` works. The search-engine select and shortcut checkbox do not have a clean accessible name, so use their ids (`#search-engine`, `#show-shortcuts`).
- `resolvedTheme` for `system` depends on the host OS appearance. Assert explicit `light` or `dark` for deterministic proof.
- Tabs are not restored after `relaunch`, only settings. One empty tab comes back.
- Opening Settings hides page views. A screenshot showing no page is expected, not a bug.
