# Split view

A user shows two to four tabs together in columns, rows, or a grid. The split shares one tab slot with a segment per page. Each pane has a focus button, a tab chooser, a remove button, and (when empty) its own search box. Draggable, keyboard-adjustable dividers resize the panes. A tab dragged onto the page splits at the edge under the pointer. Leaving split view keeps the focused page visible.

## Sub-features

- `split-enter` opens split view from the toolbar `Split tabs` button (or palette `> split`), creating a second tab if only one is open.
- `split-pane-search` loads a page in an empty pane from `Search right pane`/`Search left pane`.
- `split-slot` shows one `Split tabs` group in the tab strip with two tab segments.
- `split-focus` moves address-bar control between panes (`Focus left pane`/`Focus right pane`, or clicking a segment).
- `split-choose` replaces a pane's tab via `Left pane tab`/`Right pane tab`.
- `split-resize` resizes with the `Resize split panes` separator by drag or Left/Right/Home/End.
- `split-exit` leaves with `Exit split view`. Closing either tab expands the other.
- `split-more-panes` adds panes up to four with `Add split pane` in the `Split layout` toolbar group.
- `split-layout` switches between `Columns`, `Rows`, and `Grid` (three or four panes) in the same group.
- `split-remove-pane` takes a tab out with `Remove <name> pane from split`. The tab stays open.
- `split-drag-tab` drops a tab on a page edge to split with it.

## How to get to it (user POV)

- Choose `Split tabs` in the toolbar. The same button reads `Exit split view` while split.
- Command palette: `> split`, `> Add split pane`, `> Arrange panes in rows` (and columns, a grid).
- Drag a tab from the tab strip onto the page.

## Driving it with verify.mjs

Preconditions:

- Baseline run is healthy and `O` holds the fixture origin.
- Load `$O/a` in the first tab and wait until it is not loading.
- Evidence directory: `split/`.

- **Enter split.** Run `node $V click --role button --name "Split tabs"`, then `node $V wait --role group --name "Split tabs"`. `state.split.tabIds` has two ids, `state.tabs.length` is 2, and `node $V wait --role textbox --name "Search right pane"` passes.
- **Fill the right pane.** Run `node $V fill --role textbox --name "Search right pane" --value "$O/b"` and `node $V press --role textbox --name "Search right pane" --key Enter`, then `wait --until "state.tabs.some(t => t.title === 'Fixture /b' && !t.loading)"`. Run `node $V screenshot --out split/two-panes.png`. Both pages are visible side by side under the pane toolbars.
- **Two visible native views.** `node $V eval --js "return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).map(v => v.getBounds()))"` returns two rectangles, with the left one ending before the right one starts.
- **Focus panes.** Run `node $V click --role button --name "Focus left pane"`. `node $V value --role textbox --name "Search or enter address"` prints `$O/a`. Run `node $V click --role button --name "Focus right pane"`. It prints `$O/b`.
- **Keyboard resize.** Run `node $V press --key End --role separator --name "Resize split panes"`. `wait --until "state.split.columns[0] === 0.75"` passes, and the left view's width grows in the bounds check above.
- **More panes.** Run `node $V click --role button --name "Add split pane"`, then `node $V wait --role region --name "Middle pane"`. Fill it with `Search right pane` (the new pane is the rightmost). Run `node $V click --role button --name "Grid"` and `node $V wait --role region --name "Bottom right pane"`. `state.split.layout` is `grid`, and `node $V screenshot --out split/grid.png` shows one tall left pane and two stacked right panes.
- **Grid resize.** With four panes, the separators are `Resize columns 1 and 2` and `Resize rows 1 and 2`. Press `ArrowDown` on the rows separator. `state.split.rows[0]` grows above 0.5.
- **Remove a pane.** Run `node $V click --role button --name "Remove top left pane from split"`. `state.split.tabIds` loses that id, and the tab is still in `state.tabs`.
- **Exit.** Run `node $V click --role button --name "Exit split view"`, then `wait --until "state.split === null"`. The focused page stays visible and both tabs remain in the strip as separate slots.

## Gotchas

- The `Split tabs` name belongs to both the toolbar button and the tab-strip group. Use `--role button` or `--role group` to pick one.
- Pane names follow the layout and pane count (`Left`, `Middle`, `Right`, `Top left`, and so on), so every pane label changes when you add a pane or change the layout. Use `snapshot` to read the current names.
- The divider names change too: with one divider it is `Resize split panes`, with more it is `Resize columns i and i+1` or `Resize rows i and i+1`.
- A tab drag needs real drag events. Playwright mouse drags in the chrome work (see `tests/e2e/drag-split.spec.ts`). `cua-driver drag` posts to a background pid, and Chromium ignores it. For an OS-level drag, the window must be in front and the events must come from the HID event tap.
- While a tab drag is held, `state.tabDragging` is true, the native pages hide, and the chrome shows still images of them. A composited screenshot taken mid-drag shows the drop zone above those images.
- Split state is per app session and is not restored by `relaunch`.
- Pane tab choosers list tabs by title, and `select --value` takes the tab id. Read ids from `state` first.
