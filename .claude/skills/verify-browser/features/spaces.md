# Spaces and link routing

A user keeps separate sets of tabs in spaces, such as Work and Personal. Each space has its own favorites, pinned tabs, folders, Today tabs, and profile (cookies, logins, and site data in the Electron partition `persist:<profile>`). Routes open new tabs for a site in a chosen space. Spaces and routes survive a restart.

## Sub-features

- `space-create` adds a space with the `New space` button and names it in the `Space name` field. The new space opens on a blank tab.
- `space-switch` switches spaces with the dots in the `Spaces` navigation, Cmd/Ctrl+Alt+Right/Left, or the palette (`> switch to`). Each space keeps its active tab and split.
- `space-profile` keeps cookies separate per space. The first space uses the original `browsing` profile.
- `space-move` moves a tab to another space (context menu `Move to space` or `> move tab to`). The page reloads in the new profile.
- `space-route` adds and removes routes in Settings > Link routing. Popups and new tabs for a routed site open in its space.
- `space-delete` deletes a space after a native confirmation. Its Today tabs go to the Archive and its profile data is erased.

## How to get to it (user POV)

- The `Spaces` navigation sits before the tabs in the top layout and at the bottom of the sidebar in the left and right layouts. Double-click or F2 renames; right-click opens the color and delete menu.
- Spaces menu: Next space, Previous space, New space.
- Command palette: `> new space`, `> switch to <name>`, `> move tab to <name>`.
- Settings > Link routing: `Site` field, `Space for this site` select, `Add route`.

## Driving it with verify.mjs

Preconditions:

- `node $V launch --run spaces-<n>`, then load `$O/a` in the first tab.
- Evidence directory: `spaces/`.

- Create: `click --role button --name "New space"`, then `fill --role textbox --name "Space name" --value Work` and `press --key Enter` on it. Expect `state.spaces.length === 2` and one tab in `state.tabSlots`.
- Switch: `click --role button --name Personal` (inside `navigation "Spaces"`). Expect `state.activeSpaceId === state.spaces[0].id`.
- Shortcut: `shortcut --key Right --modifiers meta,alt`. Expect the next space to be active.
- Route: open Settings, fill `Site` with `127.0.0.1`, select the space, click `Add route`. Then click a `target="_blank"` link (`$O/links`, `Popup`) in another space. Expect the new tab in the routed space.
- Profiles: compare `eval --js "return (await app.evaluate(async ({ session }, p) => (await session.fromPartition('persist:' + p).cookies.get({})).length, '<profile>'))"` for each space profile.

## Gotchas

- The space menu and the delete confirmation are native. Use the palette or `eval` to observe, and stub `dialog.showMessageBoxSync` only in tests.
- `state.tabs` holds the tabs of all spaces; `state.sections`, `state.tabSlots`, and `state.folders` hold only the active space.
- Routes apply only to new tabs and popups. A typed address stays in the current tab.
