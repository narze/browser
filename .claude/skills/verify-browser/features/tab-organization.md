# Tab organization

A user sorts tabs into Favorites (an icon grid), Pinned tabs, folders of pinned tabs, and Today. Tabs can be dragged, moved with the keyboard, and renamed. Pinned and favorite tabs keep a home page and sleep instead of closing. Unused Today tabs move to the Archive, and unused background tabs sleep. Favorites, pinned tabs, folders, and the archive survive a restart.

## Sub-features

- `org-drag` reorders tabs and moves them between sections by drag and drop. Favorites and Pinned drop zones appear only during a drag when they are empty.
- `org-keys` moves the focused tab with Alt+Shift+Up/Down (Left/Right in the top layout).
- `org-pin` pins or favorites a tab and shows `Back to pinned page: <title>` after it navigates away. Closing it sleeps it.
- `org-folder` creates, renames, collapses, and deletes folders in the pinned section.
- `org-rename` renames a tab or folder by double-click, F2, or the context menu. Escape cancels. An empty name restores the page title.
- `org-sleep` unloads idle background tabs and wakes them with their history.
- `org-archive` archives idle or closed Today tabs and restores or removes them from the Archive screen.
- `org-persist` restores favorites, pinned tabs, folders, and the archive from `tabs.json`, with tabs asleep.

## How to get to it (user POV)

- Drag tabs in the tab strip or rail. Right-click a tab or folder for a native context menu.
- Command palette: `> pin`, `> favorite`, `> rename`, `> new folder`, `> back to pinned page`, `> open archive`.
- Toolbar `Archive` button, View > Archive, or Cmd/Ctrl+Shift+A.
- Settings > Tabs: `Archive tabs after` and `Put tabs to sleep after`.

## Driving it with verify.mjs

Preconditions:

- Launch with `BROWSER_TEST_HOOKS=1 node $V launch --run org-<n>` to expose the clock hook for sleep and archive. `verify.mjs` passes the environment to Electron.
- Select the left layout (`eval --js "return chrome.evaluate(() => window.browser.setTabLayout('left'))"`) so drag targets are large.
- Load `$O/a` to `$O/e` in five tabs and wait until none is loading.
- Evidence directory: `org/`.

- **Drag.** Use the mouse helper (down, small move, then move to the target found after the drag starts, then up). Native HTML5 drag needs real pointer moves; Playwright `dragTo` times out when the target appears only during the drag. `state.sections.today.flat()` shows the new order.
- **Pin and reset.** Drag a tab onto `group "Pinned tabs"`, follow a link in its page, then click `button "Back to pinned page: …"`. Click `button "Close tab: …"`; the tab stays with title `<label> (asleep)` and `state.tabs[i].asleep` is true.
- **Folder.** Palette `> new folder`, Enter. `textbox "Folder name"` is focused. Type a name and Enter, then drag a tab onto the folder header button. `group "Folder: <name>"` holds the tab. Click the header to collapse; `aria-expanded` is `false`.
- **Rename.** Double-click a tab. `textbox "Tab name"` is focused. Enter a name and press Enter.
- **Sleep and archive.** `eval --js "return app.evaluate((_e, ms) => globalThis.browserTest.advanceClock(ms), 7200000)"` sleeps idle background tabs. Advancing 13 hours archives idle Today tabs; `state.archive` lists them. Click `button "Archive"` (exact), then `button "Restore <title>"`.
- **Persist.** Read `<profile>/tabs.json`, then `relaunch`. Sections and folders return, non-Today tabs are asleep, and favicons load from `favicon://icon/…`.

## Gotchas

- `button "Archive"` needs an exact match because archive entries also have buttons with names that contain the title.
- The test clock hook exists only with `BROWSER_TEST_HOOKS=1`; without it, the timers run once a minute on real time.
- Context menus are native and cannot be driven through the DOM. Use the palette or drag instead, and say so in the report.
- Today tabs do not persist, and a blank tab cannot be pinned.
