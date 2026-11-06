<img src="assets/icon.svg" width="64" height="64" alt="">

# Browser prototype

A small tabbed desktop browser built with Electron, Svelte 5, TypeScript, and Vite+.

```sh
pnpm install
pnpm dev
```

`pnpm dev` builds the sandboxed preload, starts Vite+, and opens Electron. Changes to Svelte update live. Restart the command after changing Electron main, preload, or shared browser definitions.

Features:

- Create, switch, and close tabs, including links that open a new tab.
- Use the **Tabs** selector in the title bar to place tabs at the top, left, or right. Vertical tabs support Up/Down arrow navigation.
- Open **Settings** from the toolbar or Cmd/Ctrl+, to choose a theme (System, Light, or Dark), tab placement, a search engine (DuckDuckGo, Google, or Bing), and whether new-tab shortcuts appear. Preferences save automatically in the app's local profile and survive a restart.
- The theme follows your system by default and applies to all browser controls. Websites that support system appearance can follow the selected theme too.
- Open the centered **Command palette** from the toolbar or Cmd/Ctrl+K. Search open tabs, enter an address or search, or type `>` to filter browser commands. Cmd/Ctrl+L opens it with the current address selected. Use Up/Down and Enter to choose a result, Shift+Enter to open an address/search in a new tab, and Escape or click outside to cancel. The palette stays above live pages, including split view, and follows the selected theme. Suggestions come from open tabs and local commands.
- Enter an HTTP(S) address or search with your selected engine from either search field.
- Go back, forward, reload, stop, or return to the new-tab page.
- Each tab has a separate `WebContentsView`. Background pages keep their state.
- Show navigation errors with a retry action.
- Click **Split tabs** in the toolbar to show two tabs side by side. The pair shares one tab slot, with a clickable segment for each page in left-to-right pane order. In a vertical tab rail, Left/Right arrow keys switch between the segments. Choose tabs from each pane's dropdown, click a page to control it with the address bar, and drag the divider to resize (or focus it and use Left/Right arrow keys). With one tab open, splitting creates a new tab for the second pane. Selecting a third tab replaces the focused pane. **Exit split view** keeps the focused page visible; closing either split tab expands the remaining page. Each space remembers its split, and splits come back after a restart.
- Split into **up to four panes**. While split, the toolbar shows **Columns**, **Rows**, and **Grid** (three or four panes) and **Add split pane**. Each divider resizes the two panes next to it. A pane's **x** button takes its tab out of the split and keeps the tab open.
- **Drag a tab onto the page** to split with it. The half of the page under the pointer shows where the tab goes. Columns take a tab at the left or right of a pane, rows at the top or bottom. In a three-pane grid, the tall left pane takes a tab in its top or bottom half. Elsewhere in a grid, and with four panes, the tab replaces the pane under the pointer, or swaps places with it when it is already in the split.
- **Compact mode** (Cmd/Ctrl+Shift+S, the View menu, the palette, or Settings) hides the toolbar and tabs so the page uses the whole window. Move the pointer to the top edge (or to the side of the tab sidebar) to show them again. They hide when the pointer moves back onto the page.
- **Peek** at a link without leaving the page: Alt+click it. The link opens in a card above the current page, which stays visible behind it. In a pinned tab or a favorite, a click on a link to another site also opens a peek, so the tab stays on its page. Press Escape or click outside the card to close it, or click **Open as tab** to keep the page, as it is, in a new tab.
- Open a **quick window** (Cmd/Ctrl+Alt+N, the File menu, or the palette) for a fast lookup in a small, separate window. Links that other apps open in the browser also show there. Click **Open in browser** to move the page, as it is, into the main window as a tab. Cmd/Ctrl+W closes the quick window.

- Organize tabs like Arc and Zen. Drag a tab (or use the tab's context menu or the palette) into **Favorites** (an icon grid), **Pinned tabs**, or **Today**. Drag to reorder, or focus a tab and press Alt+Shift+Up/Down. A pinned or favorite tab remembers its home page: after it navigates away, a **Back to pinned page** button returns it, and closing it only puts it to sleep.
- Group pinned tabs in **folders**. Create one from the palette (`> New folder`) or a tab's context menu, drag tabs into it, and click its header to collapse it. Folders **nest** to any depth: use a folder's context menu (**New folder inside**), the palette (`> New folder inside …` for the current tab's folder), or drag a folder onto the middle of another folder. Drag onto the top or bottom edge of a folder to put it before or after. Alt+Shift+Up/Down also moves tabs across folder edges and moves folders out of their parent. A collapsed folder hides everything in it except the tabs on screen. Deleting a folder moves its subfolders and tabs up one level. **Move to space** in a folder's menu moves it with everything in it.
- Rename a tab or folder with a double-click, F2, or the context menu. An empty name restores the page title.
- Today tabs that stay unused move to the **Archive** (after 12 hours by default). Closed Today tabs go there too. Open it from the toolbar or Cmd/Ctrl+Shift+A to filter, restore, or remove entries. Cmd/Ctrl+Shift+T reopens the last closed tab in its space, with its back/forward history. Press it again to go further back.
- Unused background tabs **sleep** (after 1 hour by default) to free memory and keep their back/forward history when they wake. Tabs that play audio stay awake. Set both timers in Settings under **Tabs**.
- Use **Spaces** for separate sets of tabs, such as Work and Personal. Each space has its own favorites, pinned tabs, folders, and Today tabs, and its own **profile**: cookies, logins, and site data. Switch with the space dots (before the tabs, or at the bottom of the sidebar), Cmd/Ctrl+Alt+Left/Right, or the palette. Click **+** to add a space, double-click a dot or press F2 to rename it, and right-click for its color or to delete it. Deleting a space archives its Today tabs and erases its site data. Move a tab to another space from its context menu or the palette; it reloads with that space's logins.
- **Link routing** opens new tabs for a site in a specific space, for example github.com in Work. Add routes in Settings under **Link routing**. A route also covers subdomains, and the most specific route wins. Typed addresses stay in the current tab.
- Change any browser **keyboard shortcut** in Settings under **Keyboard shortcuts**. Search by name or keys, click a shortcut and press new keys, press Delete to remove it, and reset one or all. A shortcut that another action uses is rejected. Browser shortcuts take priority over websites, except Back and Forward, which leave Alt+Left/Right to text fields. The menus, toolbar tips, and palette show the current keys. The definitions live in `shared/shortcuts.js`.
- Cmd/Ctrl+Shift+C copies the page address and shows **Copied** in the address bar.
- A tab that plays sound shows a **mute** button. In side tabs, a **media card** above the space dots shows a playing or paused tab that is not on screen, with Play/Pause and Mute. When you leave a tab with a playing video, the video moves to **picture in picture**. Turn this off in Settings under Tabs.
- **Session restore**: spaces, all tabs, folders, the archive, and the shown tab and split of each space save to `tabs.json` in the app profile. After a restart they come back asleep, and the shown pages load. Pinned tabs keep their home page. Blank tabs and back/forward history are not saved. Site icons are cached in the profile.

Default shortcuts (all customizable):

| Shortcut                  | Action                              |
| ------------------------- | ----------------------------------- |
| Cmd/Ctrl+T                | New tab                             |
| Cmd/Ctrl+Alt+N            | New quick window                    |
| Cmd/Ctrl+W                | Close tab                           |
| Cmd/Ctrl+Shift+T          | Reopen closed tab                   |
| Cmd/Ctrl+L                | Open address palette                |
| Cmd/Ctrl+K                | Open command palette                |
| Cmd/Ctrl+R                | Reload                              |
| Cmd/Ctrl+Shift+C          | Copy page address                   |
| Cmd/Ctrl+D                | Pin or unpin tab                    |
| Cmd/Ctrl+Shift+D          | Add to or remove from favorites     |
| Ctrl+Shift+=              | Split view                          |
| Cmd/Ctrl+S                | Show or hide tab sidebar            |
| Cmd/Ctrl+Shift+S          | Compact mode                        |
| Cmd/Ctrl+,                | Settings                            |
| Cmd/Ctrl+Shift+A          | Archive                             |
| Alt+Left / Alt+Right      | Back / forward                      |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab                 |
| Cmd/Ctrl+Shift+] / [      | Next / previous tab                 |
| Cmd/Ctrl+1 to 8 / 9       | Select tab by position / last tab   |
| Cmd/Ctrl+Alt+Right / Left | Next / previous space               |
| Cmd/Ctrl+Alt+I            | Developer tools for the active page |

Fixed keys: Alt+Shift+Up / Down moves the focused tab, and F2 renames it.

Development commands:

```sh
pnpm check       # Vite+ format/lint checks and Svelte/TypeScript diagnostics
pnpm test        # Session, layout, settings, command, navigation, and policy tests
pnpm test:e2e    # Build, then test the real Electron app through Playwright
pnpm build      # Build the Svelte interface and sandboxed preload into dist/
pnpm start      # Open Electron using the built interface
pnpm package    # Build release/mac-<arch>/Browser.app (macOS)
pnpm test:package # Build the app, then launch the packaged Browser.app in a test
pnpm dev:ui     # Interface only in Vite+; browsing requires Electron
pnpm fmt        # Format supported files through Vite+
```

To use the browser as a normal macOS app, run `pnpm package` and open `release/mac-arm64/Browser.app` (`mac` on Intel), or drag it to Applications. It uses the same profile as `pnpm start` (`~/Library/Application Support/Browser`), so your tabs and spaces carry over. The app has an ad-hoc signature, so it runs on the Mac that built it; other Macs need a Developer ID signature. Its Info.plist lists http and https, so you can pick it as the default web browser in System Settings. On the first launch, macOS can ask for access to "Browser Safe Storage" in the keychain, because `pnpm start` made that item; choose Always Allow. `electron-builder.yml` holds the packaging setup. The app icon comes from `build/icon.svg`; after you change it, run `pnpm exec electron scripts/render-icon.cjs` to update `build/icon.png`.

The local Vite+ CLI is available with `pnpm exec vp`. Global Vite+ installation is optional. Vite+ supplies Vite and Vitest through the pinned overrides in `pnpm-workspace.yaml`.

The browser session module in `electron/browser-session.cjs` owns tab lifetime, selection, split rules, temporary screens, and page visibility. It returns state and effects without importing Electron. Its visual tab slots supply the tab strip, arrow navigation, numbered shortcuts, and tab cycling. `electron/main.cjs` applies the effects to native page views and handles page events, history, and focus.

Tab cycling captures the current visual order until another browser action changes it. Replacing a split pane can move a tab slot during a cycle; keeping the captured order makes every tab reachable in both directions.

The chrome owns page geometry. `src/page-layout.ts` observes the actual DOM content regions and reports rectangles to Electron; native page views follow those measurements. Chrome height, rail width, pane toolbar height, and divider width are defined in CSS. Geometry reports are validated and clipped to the window, and pages stay hidden until their current content regions have been reported.

`shared/settings.js` defines settings defaults, choices, labels, validation, and search URLs. Settings types, controls, storage, and palette preferences use that schema. `shared/commands.js` defines IPC channels, caller access, and palette commands. Main-process registration and the preload use the same table, with a startup check for missing or extra handlers. Vite+ bundles the preload into one CommonJS file because sandboxed preloads cannot load local modules.

The command palette uses a separate transparent local `WebContentsView`, with IPC limited to reading state and running validated palette actions. Remote pages have no preload, no Node access, and run with sandboxing and context isolation enabled. The main process checks IPC senders and rejects calls from subframes. Browsing uses a separate session from the interface.

For a manual check, run `pnpm dev`, open three tabs, and split two of them. Try numbered shortcuts, a full cycle with Ctrl+Tab, and arrow navigation in the tab strip. Change tab placement, resize the window, and drag the divider; pages should stay aligned without reloading. Change a theme or search preference in Settings or the command palette, then restart to check persistence.

This is a prototype. Website cookies and storage use one persistent Electron session for each space. It does not include bookmarks, a downloads interface, browser extensions, or an installer (`pnpm package` builds a `.app`, not a DMG). Camera, microphone, and other permission requests are denied.

Popup links open as ordinary GET tabs, with at most one popup per source tab every 750 ms. Opener-dependent flows and POST popups are not supported. Closing a tab discards its page without an unsaved-changes prompt.

See [the source research](docs/research/electron-references.md) for the pinned T3 Code and Yalqen references and the practices used here.

Created in [T3 Code](https://t3.codes).
