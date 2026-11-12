# Command palette

A centered palette floats above the browser, including live pages and split view. The user can search open tabs, enter an address or search, or type `>` to run browser commands. It closes with Escape or a click outside, and follows the selected theme.

## Sub-features

- `palette-open` opens from the toolbar button, Cmd/Ctrl+K (commands), or Cmd/Ctrl+L (address, current URL preselected), including while a web page has focus.
- `palette-tab-switch` finds an open tab by title or URL and switches to it.
- `palette-navigate` loads an address in the current tab with Enter, or in a new tab with Cmd/Ctrl+Enter or Shift+Enter.
- `palette-commands` filters commands with `>` (new tab, settings, split, close tab, reload, back/forward, themes, tab placement).
- `palette-reject` refuses non-HTTP(S) input with an alert.
- `palette-dismiss` closes with Escape and returns focus.

## How to get to it (user POV)

- Choose the `Command palette` button in the toolbar.
- Press Cmd/Ctrl+K anywhere in the browser, including inside a web page.
- Press Cmd/Ctrl+L for the address palette.
- View > Command palette, or View > Open address palette.

## Driving it with verify.mjs

Preconditions:

- Baseline run is healthy and `O` holds the fixture origin.
- Load `$O/one` in the first tab (address field, Enter, `wait --until "state.tabs[0].title === 'Fixture /one' && !state.tabs[0].loading"`), then open a second tab with `node $V click --role button --name "New tab"`.
- Evidence directory: `palette/`.

- **Open from the toolbar.** Run `node $V click --role button --name "Command palette"`, then `node $V wait --role combobox --name "Search or enter a command" --target palette`. The palette's input is visible. `node $V state` shows `palette.mode` `commands`.
- **Switch tab by search.** Run `node $V fill --role combobox --name "Search or enter a command" --value "Fixture /one" --target palette`. Run `node $V snapshot --target palette --out palette/tab-search.aria.txt`. `node $V wait --role option --name "Switch tab" --loose --target palette` passes. The first option is `Fixture /one Search with DuckDuckGo Open` (search for the typed text), so the tab result is second. Select it with `node $V press --key ArrowDown --target palette --role combobox --name "Search or enter a command"` and `node $V press --key Enter --target palette --role combobox --name "Search or enter a command"`. `wait --until "state.palette === null && state.tabs.find(t => t.id === state.activeId).title === 'Fixture /one'"` passes.
- **Address palette from inside a page.** Run `node $V shortcut --key L --modifiers meta --target "page:/one"`, then `node $V wait --until "state.palette && state.palette.mode === 'navigate'"`. `node $V value --role combobox --name "Search or enter a command" --target palette` prints `$O/one`. Run `node $V screenshot --out palette/over-page.png`. The palette draws over the live page.
- **Navigate in the current tab.** Run `node $V fill --role combobox --name "Search or enter a command" --value "$O/updated" --target palette`, `node $V press --key Enter --target palette --role combobox --name "Search or enter a command"`, then `node $V wait --until "state.tabs.some(t => t.title === 'Fixture /updated') && state.tabs.length === 2"`. The active tab now shows `Fixture /updated`, and no tab was added.
- **Open in a new tab.** Open with `node $V shortcut --key K --modifiers meta --target chrome`, fill `$O/three`, and press `Shift+Enter` on the combobox. `wait --until "state.tabs.length === 3"` passes and the new tab is `Fixture /three`.
- **Run a command.** Open the palette, fill `> dark`, and press Enter. `wait --until "state.settings.theme === 'dark'"` passes. `node $V eval --js "return chrome.locator('html').getAttribute('data-theme')"` prints `dark`.
- **Reject unsafe input.** Open the palette, fill `javascript:alert(1)`, and press Enter. `node $V wait --role alert --target palette` passes, the alert text contains `Only HTTP and HTTPS`, and the palette stays open.
- **Dismiss.** Press Escape on the combobox (`node $V press --key Escape --target palette --role combobox --name "Search or enter a command"`). `wait --until "state.palette === null"` passes.

## Gotchas

- `--target palette` fails until the palette has been opened once in this run. Always `wait` on its combobox first.
- Option names concatenate title, detail, and hint (for example `Fixture /one http://… Switch tab`). The typed text also appears in the search option and in command details like `Close current tab Fixture /one ⌘W`, so a `--loose` name of just the page title matches several options and fails strict matching. Match on something unique such as `Switch tab`, or add `--nth`.
- Playwright `press Meta+K` does not open the palette. Use `shortcut`.
- Right after `menu` or a toolbar click, focus may sit in the chrome or the palette. Pass `--target` to `shortcut` explicitly.
- `> dark` changes a persisted setting. Do not reuse this run for a recipe that expects default settings.
