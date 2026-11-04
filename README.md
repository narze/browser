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
- Click **Split tabs** in the toolbar to show two tabs side by side. The pair shares one tab slot, with a clickable segment for each page in left-to-right pane order. In a vertical tab rail, Left/Right arrow keys switch between the segments. Choose tabs from each pane's dropdown, click a page to control it with the address bar, and drag the divider to resize (or focus it and use Left/Right arrow keys). With one tab open, splitting creates a new tab for the second pane. Selecting a third tab replaces the focused pane. **Exit split view** keeps the focused page visible; closing either split tab expands the remaining page. Splits last for the current app session.

| Shortcut                  | Action                              |
| ------------------------- | ----------------------------------- |
| Cmd/Ctrl+T                | New tab                             |
| Cmd/Ctrl+W                | Close tab                           |
| Cmd/Ctrl+L                | Open address palette                |
| Cmd/Ctrl+K                | Open command palette                |
| Cmd/Ctrl+R                | Reload                              |
| Cmd/Ctrl+,                | Settings                            |
| Alt+Left / Alt+Right      | Back / forward                      |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab                 |
| Cmd/Ctrl+1 to 8 / 9       | Select tab by position / last tab   |
| Cmd/Ctrl+Shift+] / [      | Next / previous tab                 |
| Cmd/Ctrl+Alt+I            | Developer tools for the active page |

Development commands:

```sh
pnpm check       # Vite+ format/lint checks and Svelte/TypeScript diagnostics
pnpm test        # Session, layout, settings, command, navigation, and policy tests
pnpm test:e2e    # Build, then test the real Electron app through Playwright
pnpm build      # Build the Svelte interface and sandboxed preload into dist/
pnpm start      # Open Electron using the built interface
pnpm dev:ui     # Interface only in Vite+; browsing requires Electron
pnpm fmt        # Format supported files through Vite+
```

The local Vite+ CLI is available with `pnpm exec vp`. Global Vite+ installation is optional. Vite+ supplies Vite and Vitest through the pinned overrides in `pnpm-workspace.yaml`.

The browser session module in `electron/browser-session.cjs` owns tab lifetime, selection, split rules, temporary screens, and page visibility. It returns state and effects without importing Electron. Its visual tab slots supply the tab strip, arrow navigation, numbered shortcuts, and tab cycling. `electron/main.cjs` applies the effects to native page views and handles page events, history, and focus.

Tab cycling captures the current visual order until another browser action changes it. Replacing a split pane can move a tab slot during a cycle; keeping the captured order makes every tab reachable in both directions.

The chrome owns page geometry. `src/page-layout.ts` observes the actual DOM content regions and reports rectangles to Electron; native page views follow those measurements. Chrome height, rail width, pane toolbar height, and divider width are defined in CSS. Geometry reports are validated and clipped to the window, and pages stay hidden until their current content regions have been reported.

`shared/settings.js` defines settings defaults, choices, labels, validation, and search URLs. Settings types, controls, storage, and palette preferences use that schema. `shared/commands.js` defines IPC channels, caller access, and palette commands. Main-process registration and the preload use the same table, with a startup check for missing or extra handlers. Vite+ bundles the preload into one CommonJS file because sandboxed preloads cannot load local modules.

The command palette uses a separate transparent local `WebContentsView`, with IPC limited to reading state and running validated palette actions. Remote pages have no preload, no Node access, and run with sandboxing and context isolation enabled. The main process checks IPC senders and rejects calls from subframes. Browsing uses a separate session from the interface.

For a manual check, run `pnpm dev`, open three tabs, and split two of them. Try numbered shortcuts, a full cycle with Ctrl+Tab, and arrow navigation in the tab strip. Change tab placement, resize the window, and drag the divider; pages should stay aligned without reloading. Change a theme or search preference in Settings or the command palette, then restart to check persistence.

This is a prototype. Tab lists are kept in memory, while website cookies and storage use Electron's persistent browsing session. It does not include session restore, bookmarks, a downloads interface, browser extensions, or an installer. Camera, microphone, and other permission requests are denied.

Popup links open as ordinary GET tabs, with at most one popup per source tab every 750 ms. Opener-dependent flows and POST popups are not supported. Closing a tab discards its page without an unsaved-changes prompt.

See [the source research](docs/research/electron-references.md) for the pinned T3 Code and Yalqen references and the practices used here.

Created in [T3 Code](https://t3.codes).
