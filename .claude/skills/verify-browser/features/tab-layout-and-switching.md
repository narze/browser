# Tab layout and switching

Tabs sit across the top or in a left or right rail. The user switches tabs by clicking, with Ctrl+Tab / Ctrl+Shift+Tab cycling, with Cmd/Ctrl+1–8 by position and Cmd/Ctrl+9 for the last tab, and with arrow keys inside the tab strip. Changing placement resizes pages without reloading them.

## Sub-features

- `layout-select` chooses Top, Left, or Right from the tab placement radios on the Settings screen.
- `layout-no-reload` keeps page state when placement changes.
- `switch-click` selects a tab by clicking it.
- `switch-cycle` moves through tabs in visual order with Ctrl+Tab / Ctrl+Shift+Tab.
- `switch-number` selects by position with Cmd/Ctrl+1–9.
- `switch-arrows` moves selection with Left/Right (top strip) or Up/Down (vertical rail).

## How to get to it (user POV)

- The tab placement radios on the Settings screen, or palette `> tabs on the left`.
- Click a tab, or use the shortcuts above.

## Driving it with verify.mjs

Preconditions:

- Baseline run is healthy and `O` holds the fixture origin.
- Three tabs: load `$O/one` in the first, then `New tab` + `$O/two`, then `New tab` + `$O/three`, waiting for each to finish loading.
- Mark a page: `node $V eval --js "return (await target('page:/two')).evaluate(() => (window.layoutMarker = 'kept'))"`.
- Evidence directory: `layout/`.

- **Click a tab.** Run `node $V click --role tab --name "Fixture /two"`. `wait --until "state.tabs.find(t => t.id === state.activeId).title === 'Fixture /two'"` passes.
- **Cycle.** Run `node $V shortcut --key Tab --modifiers control --target chrome`. The active tab becomes `Fixture /three`. Run `node $V shortcut --key Tab --modifiers control,shift --target chrome` twice. The active tab becomes `Fixture /one`.
- **By number.** Run `node $V shortcut --key 2 --modifiers meta --target chrome`. Active is `Fixture /two`. Run `node $V shortcut --key 9 --modifiers meta --target chrome`. Active is `Fixture /three`.
- **Left rail.** Run `node $V eval --js "return chrome.evaluate(() => window.browser.setTabLayout('left'))"`. `wait --until "state.settings.tabLayout === 'left'"` passes, and `node $V eval --js "return chrome.getByRole('tablist').getAttribute('aria-orientation')"` prints `vertical`. Run `node $V screenshot --out layout/left.png`. The rail is on the left and the page fills the rest.
- **Arrow keys in the rail.** Run `node $V press --key ArrowUp --role tab --name "Fixture /three"`. The active tab becomes `Fixture /two`.
- **No reload.** `node $V eval --js "return (await target('page:/two')).evaluate(() => window.layoutMarker)"` prints `kept`.
- **Right, then top.** Repeat with `right` (screenshot `layout/right.png`) and `top`. `aria-orientation` returns to `horizontal`, and the marker still reads `kept`.

## Gotchas

- Shortcuts must go through `shortcut`. Playwright `press` with Control+Tab does not reach Electron's handler.
- In a vertical rail the arrow keys are Up/Down. In the top strip they are Left/Right. Inside a split slot, Left/Right move between the two segments.
- Tab placement is a persisted setting. A run that changed it is no longer a baseline run.
- Cmd/Ctrl+9 selects the last tab, not the ninth.
