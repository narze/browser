# Browser verification map

This directory is the maintained source for verifying the user-facing behavior of the Electron browser prototype. Read this index before driving the app, then use the matching feature file as the recipe. Commands assume `V=.claude/skills/verify-browser/scripts/verify.mjs`, run from the repo root.

## Baseline preconditions

- A fresh run from `node $V launch --run <feature>-<n>`: built `dist/`, empty profile, default settings, one empty tab (`New tab`, the "Where to next?" page).
- `node $V doctor` exits 0 with `distStale: false` and `builtFrom` equal to `checkoutRev`.
- `O` holds the run's `fixtureOrigin`: `O=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".verify/runs/<run>/session.json")).fixtureOrigin)')`.
- Never drive a window this run did not launch.

## Driving conventions

- Start every recipe from the baseline unless its preconditions say otherwise. Recipes that change settings or tabs need a new run, not an undo.
- Prefer ARIA roles and accessible names. The locators in each recipe are copied from the app's markup.
- Treat every command as literal. Keep quoted names, `…` characters, and flags unchanged.
- App keyboard shortcuts go through `shortcut`. Menu-only shortcuts go through `menu`. `press` is only for keys typed into a field (Enter, arrows, Escape).
- After any navigation, `wait --until` the tab is not loading before asserting or capturing.
- Use `eval` and `state` only to observe. Every change must come from a user path.

## Proof and skip reporting

- Save artifacts under `.verify/evidence/<run>/<feature-id>/`. `actions.jsonl` already records each action and result.
- UI proof is a `screenshot` (the composited window) plus a `snapshot --out` of the relevant target.
- State proof is the `wait --until` expression that passed, and `state` output saved when it matters.
- Mutation proof includes a second view: a relaunch, a profile file, or a page marker read back.
- Report an entry point you could not drive with the attempted command and the reason. Do not report it as verified through a different path.
- When a menu item stands in for its accelerator, say "menu handler verified, OS key binding not exercised".

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with verify.mjs` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Tabs and navigation](./tabs-and-navigation.md) covers address and new-tab search entry, history, popups, error pages, and closing tabs.
- [Tab layout and switching](./tab-layout-and-switching.md) covers top/left/right placement and keyboard tab switching.
- [Command palette](./command-palette.md) covers opening, tab search, address entry, `>` commands, and dismissal.
- [Split view](./split-view.md) covers splitting, pane selection, divider resizing, and leaving split view.
- [Settings](./settings.md) covers theme, tab placement, search engine, shortcuts toggle, and persistence across restarts.
- [Tab organization](./tab-organization.md) covers favorites, pinned tabs, folders, drag and keyboard reorder, rename, sleep, the archive, and persistence.
