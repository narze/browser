# Split view

A user shows two tabs side by side. The pair shares one tab slot with a segment per page. Each pane has a focus button, a tab chooser, and (when empty) its own search box. A draggable, keyboard-adjustable divider resizes the panes, and leaving split view keeps the focused page visible.

## Sub-features

- `split-enter` opens split view from the toolbar `Split tabs` button (or palette `> split`), creating a second tab if only one is open.
- `split-pane-search` loads a page in an empty pane from `Search right pane`/`Search left pane`.
- `split-slot` shows one `Split tabs` group in the tab strip with two tab segments.
- `split-focus` moves address-bar control between panes (`Focus left pane`/`Focus right pane`, or clicking a segment).
- `split-choose` replaces a pane's tab via `Left pane tab`/`Right pane tab`.
- `split-resize` resizes with the `Resize split panes` separator by drag or Left/Right/Home/End.
- `split-exit` leaves with `Exit split view`. Closing either tab expands the other.

## How to get to it (user POV)

- Choose `Split tabs` in the toolbar. The same button reads `Exit split view` while split.
- Command palette: `> split`.

## Driving it with verify.mjs

Preconditions:

- Baseline run is healthy and `O` holds the fixture origin.
- Load `$O/a` in the first tab and wait until it is not loading.
- Evidence directory: `split/`.

- **Enter split.** Run `node $V click --role button --name "Split tabs"`, then `node $V wait --role group --name "Split tabs"`. `state.split.tabIds` has two ids, `state.tabs.length` is 2, and `node $V wait --role textbox --name "Search right pane"` passes.
- **Fill the right pane.** Run `node $V fill --role textbox --name "Search right pane" --value "$O/b"` and `node $V press --role textbox --name "Search right pane" --key Enter`, then `wait --until "state.tabs.some(t => t.title === 'Fixture /b' && !t.loading)"`. Run `node $V screenshot --out split/two-panes.png`. Both pages are visible side by side under the pane toolbars.
- **Two visible native views.** `node $V eval --js "return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible()).map(v => v.getBounds()))"` returns two rectangles, with the left one ending before the right one starts.
- **Focus panes.** Run `node $V click --role button --name "Focus left pane"`. `node $V value --role textbox --name "Search or enter address"` prints `$O/a`. Run `node $V click --role button --name "Focus right pane"`. It prints `$O/b`.
- **Keyboard resize.** Run `node $V press --key End --role separator --name "Resize split panes"`. `wait --until "state.split.ratio === 0.75"` passes, and the left view's width grows in the bounds check above.
- **Exit.** Run `node $V click --role button --name "Exit split view"`, then `wait --until "state.split === null"`. The focused page stays visible and both tabs remain in the strip as separate slots.

## Gotchas

- The `Split tabs` name belongs to both the toolbar button and the tab-strip group. Use `--role button` or `--role group` to pick one.
- While dragging the divider, pages are replaced by "Resizing pane…" placeholders. Screenshot after the drag ends.
- Split state is per app session and is not restored by `relaunch`.
- Pane tab choosers list tabs by title, and `select --value` takes the tab id. Read ids from `state` first.
