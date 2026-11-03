# Browser · Electrobun + CEF prototype

This is a separate port of the Electron browser at commit `011d155`, including top, left and right tabs. The root Electron application can continue evolving independently. Svelte 5 and Vite+ build the same interface; Electrobun 2.0.5 packages a Bun 1.4.4 main process and CEF. Both the interface and web pages explicitly use the CEF renderer.

```sh
cd experiments/electrobun
bun install --frozen-lockfile
bun run build
bun run start
```

On this Mac the resulting application is `build/dev-macos-arm64/BrowserCEF-dev.app`. Double-click it, or run `open build/dev-macos-arm64/BrowserCEF-dev.app`. The Bun runtime and CEF are included in that bundle.

`bun run typecheck` checks TypeScript and Svelte. `bun run dev` rebuilds/relaunches the app on source changes. For UI HMR, run `bun run dev:ui` in one terminal and `BROWSER_HMR=1 bun run dev` in another; the main process falls back to bundled assets if Vite is unavailable. Edit commands and browser shortcuts are installed as native application menu roles/actions. Native shortcuts still need manual confirmation on each OS.

If the Electron app already uses port 5173, run `bun run dev:ui -- --port 5187` and set `BROWSER_HMR_URL=http://127.0.0.1:5187/` alongside `BROWSER_HMR=1` for Electrobun.

## Structure

- `src/mainview/{App,Icon}.svelte` and `style.css`: copied browser UI.
- `src/mainview/browser.ts`: implements the shared BrowserApi using native `<electrobun-webview>` elements, preserving page instances when switching or moving tabs.
- `src/mainview/page-preload.ts`: sends only title, URL and load metadata from top-level pages. Incoming metadata is validated and can update only its own tab.
- `src/bun/index.ts`: CEF window, typed configuration/menu RPC, native menu roles and macOS child-view removal guard.
- `shared/`: the copied BrowserApi types, address parsing and popup policy, plus Electrobun's typed RPC schema.

Remote tabs use `sandbox` to disable Electrobun RPC. The trusted interface owns navigation commands. Metadata events are not privileged requests. Native navigation rules allow HTTP, HTTPS and blank tabs. Named `persist:` partitions share cookies/local storage across tabs. Vite explicitly resolves `electrobun/view` from `.hutch/devkit`; the npm package is a CLI bootstrap, not the browser SDK.

## Known limits

This is a prototype, tested on macOS arm64. CEF is configured for macOS, Windows and Linux; builds and behavior on the other operating systems are unverified.

**macOS tab removal:** Electrobun 2.0.5 calls CEF `CloseBrowser(false)` when removing an embedded browser. CEF also requests closure of its host NSWindow. The main process cancels window-close callbacks for 500 ms after a trusted tab-removal request. Native child targets are still destroyed; views are not pooled. A user closing the window during that brief interval may need to retry. This is a bounded prototype workaround, pending a native lifecycle fix. [Pinned native source](https://github.com/blackboardsh/electrobun/blob/v2.0.5/package/src/native/macos/nativeWrapper.mm).

**New persistent partitions:** CEF sometimes returns null from the first `CreateBrowserSync` while a new persistent request context initializes. Before any document has committed, the port checks readiness after 750 ms and recreates the view at most twice. A failed final attempt shows an error. The retry delay remains in the benchmark's observed navigation time. [Pinned request-context implementation](https://github.com/blackboardsh/electrobun/blob/v2.0.5/package/src/native/shared/partition_context.h).

**Navigation errors:** This CEF integration emits main-frame load-start/load-end navigation events but does not implement `OnLoadError`. A failed network navigation can therefore leave this port's load indicator pending instead of showing the copied retry screen. Stop and navigating to another page still work. The benchmark records this as a failed feature check; it is not silently counted as parity.

**Sandbox distinction:** Electrobun's `sandbox` option blocks application RPC, and the benchmark tries invoking a native command from a remote tab to verify that block. The macOS CEF runtime itself sets `no_sandbox = true` and launches renderer processes with `--no-sandbox`. This port is not ready for use as a secure general-purpose browser. [Pinned CEF initialization and RPC dispatch](https://github.com/blackboardsh/electrobun/blob/v2.0.5/package/src/native/macos/nativeWrapper.mm).

Popup flows inherit the original prototype's HTTP(S)-only and rate-limit restrictions. Full opener/OAuth window semantics, downloads, extensions, DRM and session restoration are not implemented or verified here.

Run the shared comparison from the repository root with `node benchmarks/run.mjs`. See [benchmark methodology](../../benchmarks/README.md).
