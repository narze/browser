# Browser architecture implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Implement all five recommendations from the accepted architecture review while preserving the existing browser and command palette.

**Architecture:** A pure browser session module owns tab lifetime, selection, split panes, transient screens, visual tab slots, and page visibility. Electron applies its effects to native views. The renderer measures page rectangles; shared settings and command definitions supply both processes.

**Tech stack:** Existing Electron, Svelte 5, JavaScript/TypeScript, Vite+, Vitest, and Playwright. No new dependencies.

**Spec:** The five recommendations accepted in this thread: session state, measured chrome geometry, visual shortcut order, shared settings schema, shared command table.

## Global constraints

- Keep the current interface, page isolation, popup limits, settings file format, and palette permissions.
- Write tests before implementation and make small commits.
- Keep remote pages sandboxed without a preload. Bundle the local preload with existing Vite+ so its shared imports work in Electron's sandbox.
- Retain existing in-memory tabs and persistent browsing storage; add no session restore.

## Review focus

- Closing the last tab creates one new tab; closing either split pane selects its survivor.
- Switching to a third tab replaces only the focused pane; selecting its opposite swaps sides.
- Chrome, page, and menu shortcuts use the same visual order, including a reversed split pair.
- Native bounds follow DOM layout changes and window sizes, including divider dragging and settings.
- Main-frame sender checks and the palette's restricted command access survive registry extraction.

## Tasks

### Task 1: Pin visible shortcut order

Files: `tests/e2e/architecture.spec.ts`.

- [x] Create A, B, C; split C with A; assert visual order C, A, B and Cmd/Ctrl+1 selects C from chrome and native content.
- [x] Run `pnpm build && pnpm exec playwright test tests/e2e/architecture.spec.ts`. Expected: fails on selection of A instead of C.

### Task 2: Extract browser session

Files: `electron/browser-session.cjs`, `electron/main.cjs`, `shared/browser.d.ts`, `src/App.svelte`, `tests/session.test.ts`, `GLOSSARY.md`.

Interface: `createBrowserSession()` exposes `dispatch(command)` returning `{ state, effects }` and `getState()` returning isolated snapshots. State includes visual `tabSlots` and a page visibility plan. Effects load pages or request focus. Electron stores views in a map by tab ID.

- [x] Write tests for new/close/select/cycle/position, third-tab replacement, pane swaps, settings, resize limits, palette lifecycle, visibility, and snapshot isolation. Run and verify missing module failure.
- [x] Move all session transitions into the module and reconcile its state/effects in main. Use session tab slots in Svelte and session commands for keyboard selection.
- [x] Run unit tests and shortcut E2E; commit the extraction once green.

### Task 3: Measure page rectangles

Files: `src/page-layout.ts`, `src/App.svelte`, `src/SplitView.svelte`, `electron/page-layout.cjs`, `electron/main.cjs`, `shared/browser.d.ts`, `tests/layout.test.ts`, `tests/e2e/architecture.spec.ts`.

Interface: `reportPageLayout([{ id, bounds: { x, y, width, height } }])`; accept at most two finite rectangles and clamp them to the window. Observe DOM content regions with ResizeObserver. Stale or missing regions hide pages until a matching report arrives.

- [x] Test invalid and off-window reports. Extend Electron regression to change chrome height, rail width, pane toolbar height, and divider width via CSS and compare native rectangles with the DOM.
- [x] Replace Electron's pixel constants and split-width arithmetic with measured rectangles. Derive divider dragging from its measured width.
- [x] Run unit and relevant Electron tests; commit.

### Task 4: Share settings and commands

Files: `shared/settings.js`, `shared/commands.js`, `electron/settings.cjs`, `electron/navigation.cjs`, `electron/preload.ts`, `electron/main.cjs`, `src/Settings.svelte`, `src/App.svelte`, `src/palette.ts`, `shared/browser.d.ts`, `vite.preload.config.ts`, `scripts/start.mjs`, `package.json`, `tsconfig.json`, relevant unit tests.

Interfaces: settings schema supplies defaults, choices, labels, search URLs, validation, and inferred settings types. Command registry maps browser method names to channels and palette access. Palette definitions map IDs to registry commands and arguments. Preload and main use the registry, and palette rendering/execution use the same definitions.

- [x] Add tests that each schema choice validates, persists, resolves searches, and appears in palette definitions. Test command access and rejection of unknown/incomplete handlers.
- [x] Centralize definitions; bundle preload with existing Vite+ for build and dev startup.
- [x] Run unit tests, type checks, and Electron tests including palette denial; commit.

### Task 5: Verify and document

Files: `README.md`, this plan.

- [x] Review the complete diff against all five recommendations and fix material issues.
- [x] Run `pnpm check`, `pnpm test`, `pnpm test:e2e`, and `git diff --check`; inspect every result.
- [x] Document module ownership and manual verification; capture the notable result in the brain daily note; commit the final documentation.

## Completion evidence

- Reproduced the original C|A, B numbered-shortcut mismatch in Electron before the extraction.
- Session, measured geometry, schema, and command registry tests were written and run before their implementations.
- Independent review reproduced a split cycling trap. Full forward/backward unit cycles and chrome/native/menu/arrow Electron traversals now cover it. A traversal captures the initial visual order until another browser action; page metadata updates leave it intact.
- Native rectangles arrive asynchronously after DOM layout. The existing rectangle assertion now polls for that report rather than racing ResizeObserver.
- Final verification: `pnpm check` passed with no format, lint, or type errors; `pnpm test` passed 44 tests; `pnpm test:e2e` built both bundles and passed all 5 Electron tests; `git diff --check` passed.
- Development-mode smoke test passed with the bundled preload, shared preferences, palette execution, and new tabs, with no renderer errors. A separate review probe checked actual native focus after tab, settings, and split transitions.
- Module ownership and manual checks are documented in README. The key decisions and validation were captured in the brain daily note.
