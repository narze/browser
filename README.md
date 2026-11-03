<img src="assets/icon.svg" width="64" height="64" alt="">

# Browser prototype

A small tabbed desktop browser built with Electron, Svelte 5, TypeScript, and Vite+.

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts Vite+ and opens Electron. Changes to Svelte update live. Restart the command after changing Electron main or preload code.

Features:

- Create, switch, and close tabs, including links that open a new tab.
- Use the **Tabs** selector in the title bar to place tabs at the top, left, or right. Vertical tabs support Up/Down arrow navigation; the choice lasts for the current app session.
- Enter an HTTP(S) address or search DuckDuckGo from either search field.
- Go back, forward, reload, stop, or return to the new-tab page.
- Each tab has a separate `WebContentsView`. Background pages keep their state.
- Show navigation errors with a retry action.

| Shortcut                  | Action                              |
| ------------------------- | ----------------------------------- |
| Cmd/Ctrl+T                | New tab                             |
| Cmd/Ctrl+W                | Close tab                           |
| Cmd/Ctrl+L                | Focus address bar                   |
| Cmd/Ctrl+R                | Reload                              |
| Alt+Left / Alt+Right      | Back / forward                      |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab                 |
| Cmd/Ctrl+1 to 8 / 9       | Select tab by position / last tab   |
| Cmd/Ctrl+Shift+] / [      | Next / previous tab                 |
| Cmd/Ctrl+Alt+I            | Developer tools for the active page |

Development commands:

```sh
pnpm check       # Vite+ format/lint checks and Svelte/TypeScript diagnostics
pnpm test        # Address resolution tests through Vite+ / Vitest
pnpm test:e2e    # Build, then test the real Electron app through Playwright
pnpm build      # Build the Svelte interface into dist/
pnpm start      # Open Electron using the built interface
pnpm dev:ui     # Interface only in Vite+; browsing requires Electron
pnpm fmt        # Format supported files through Vite+
```

The local Vite+ CLI is available with `pnpm exec vp`. Global Vite+ installation is optional. Vite+ supplies Vite and Vitest through the pinned overrides in `pnpm-workspace.yaml`.

The Electron main process owns the tab state and page views. The preload exposes a small command/event API to the local Svelte interface. Remote pages have no preload, no Node access, and run with sandboxing and context isolation enabled. The main process checks IPC senders. Browsing uses a separate session from the interface.

This is a prototype. Tab lists are kept in memory, while website cookies and storage use Electron's persistent browsing session. It does not include session restore, bookmarks, a downloads interface, browser extensions, or an installer. Camera, microphone, and other permission requests are denied.

Popup links open as ordinary GET tabs, with at most one popup per source tab every 750 ms. Opener-dependent flows and POST popups are not supported. Closing a tab discards its page without an unsaved-changes prompt.

See [the source research](docs/research/electron-references.md) for the pinned T3 Code and Yalqen references and the practices used here.

Created in [T3 Code](https://t3.codes).
