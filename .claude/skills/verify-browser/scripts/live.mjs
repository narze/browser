// Live view of one verify run's Electron window: a loopback HTTP server that
// serves a viewer page, window frames, and an input endpoint. Only the window
// is streamed (not the whole screen), at 1x by default, as JPEG layers that the
// viewer composites (the palette layer stays PNG to keep its transparency).
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

// Read per request so viewer edits apply on reload, without restarting the run.
const PAGE = new URL("./live.html", import.meta.url);

export async function startLive({ app, port = 6090, host = "127.0.0.1" }) {
  // Keep the display awake so Chromium keeps painting while nobody watches the Mac.
  const caffeinate =
    process.platform === "darwin"
      ? spawn("caffeinate", ["-d", "-i", "-w", String(process.pid)], { stdio: "ignore" })
      : null;

  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.show();
    electronApp.focus({ steal: true });
    win?.focus();
  });

  // Keys and clipboard actions go to the focused view. Without OS focus Electron reports
  // none, so fall back to the open palette (it owns the keyboard while shown), then the
  // last tapped view, then the chrome.
  await app.evaluate(({ BrowserWindow, webContents }) => {
    globalThis.__livePickKeyTarget = () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return null;
      const views = win.contentView.children.filter((v) => v.getVisible() && v.webContents);
      const live = [win.webContents, ...views.map((v) => v.webContents)];
      const usable = (c) => c && !c.isDestroyed() && live.includes(c);
      const focused = webContents.getFocusedWebContents();
      const palette = views.find((v) => v.webContents.getURL().endsWith("#palette"))?.webContents;
      const remembered =
        globalThis.__liveKeyTarget && webContents.fromId(globalThis.__liveKeyTarget);
      return (
        (usable(focused) && focused) ||
        (usable(palette) && palette) ||
        (usable(remembered) && remembered) ||
        win.webContents
      );
    };
  });

  // One cache per resolution: viewers in HD and normal mode must never share a capture
  // or a sequence number, or each would keep receiving the other's frames.
  const modes = {
    true: { inflight: null, last: { seq: 0, hash: "", frame: null } },
    false: { inflight: null, last: { seq: 0, hash: "", frame: null } },
  };
  async function capture(hd) {
    const mode = modes[!!hd];
    if (mode.inflight) return mode.inflight;
    mode.inflight = (async () => {
      const frame = await app.evaluate(
        async ({ BrowserWindow }, { hd }) => {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return null;
          const [width, height] = win.getContentSize();
          const encode = async (contents, w, h, png) => {
            let image = await contents.capturePage();
            if (!hd && image.getSize().width !== w)
              image = image.resize({ width: w, height: h, quality: "good" });
            return (png ? image.toPNG() : image.toJPEG(72)).toString("base64");
          };
          const layers = [
            {
              x: 0,
              y: 0,
              width,
              height,
              type: "jpeg",
              data: await encode(win.webContents, width, height, false),
            },
          ];
          for (const view of win.contentView.children) {
            if (!view.getVisible() || !view.webContents) continue;
            const b = view.getBounds();
            if (b.width < 2 || b.height < 2) continue;
            const png = view.webContents.getURL().endsWith("#palette");
            layers.push({
              ...b,
              type: png ? "png" : "jpeg",
              data: await encode(view.webContents, b.width, b.height, png),
            });
          }
          return { width, height, title: win.getTitle(), layers };
        },
        { hd },
      );
      const hash = createHash("sha1")
        .update(JSON.stringify(frame?.layers.map((l) => [l.x, l.y, l.width, l.height, l.data])))
        .digest("hex");
      if (hash !== mode.last.hash) mode.last = { seq: mode.last.seq + 1, hash, frame };
      return mode.last;
    })().finally(() => (mode.inflight = null));
    return mode.inflight;
  }

  // Input routing: find the topmost visible view under the point (palette, then
  // pages), else the chrome. Drags stay with the view that got the mouse down.
  let dragTarget = null;
  async function input(event) {
    return app
      .evaluate(
        async ({ BrowserWindow, webContents }, { event, dragTarget }) => {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return { dragTarget: null };
          const views = win.contentView.children.filter((v) => v.getVisible() && v.webContents);
          const hit = (x, y) => {
            for (const view of [...views].reverse()) {
              const b = view.getBounds();
              if (x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height)
                return { contents: view.webContents, ox: b.x, oy: b.y };
            }
            return { contents: win.webContents, ox: 0, oy: 0 };
          };
          const byId = (id) => {
            const contents = webContents.fromId(id);
            if (!contents || contents.isDestroyed()) return null;
            if (contents === win.webContents) return { contents, ox: 0, oy: 0 };
            const view = views.find((v) => v.webContents === contents);
            if (!view) return null;
            const b = view.getBounds();
            return { contents, ox: b.x, oy: b.y };
          };
          const modifiers = event.modifiers || [];
          if (event.kind === "mouse") {
            const t =
              (event.type !== "mouseDown" && dragTarget && byId(dragTarget)) ||
              hit(event.x, event.y);
            const base = {
              x: Math.round(event.x - t.ox),
              y: Math.round(event.y - t.oy),
              modifiers,
            };
            if (event.type === "mouseWheel") {
              t.contents.sendInputEvent({
                type: "mouseWheel",
                ...base,
                deltaX: -event.deltaX,
                deltaY: -event.deltaY,
                canScroll: true,
                hasPreciseScrollingDeltas: true,
              });
              return { dragTarget };
            }
            if (event.type === "mouseDown") {
              // A tap is the user's intent to interact: make the window and that view key targets.
              if (!win.isFocused()) win.focus();
              t.contents.focus();
              globalThis.__liveKeyTarget = t.contents.id;
              // macOS draws <select> popups as native menus that frame capture cannot see.
              // Hand the options to the viewer instead of opening one on the Mac.
              if ((event.button || "left") === "left") {
                const select = await t.contents
                  .executeJavaScript(
                    `(() => {
                      const el = document.elementFromPoint(${base.x}, ${base.y});
                      const sel = el && el.closest && el.closest("select");
                      if (!sel || sel.disabled || sel.multiple || sel.size > 1) return null;
                      const token = Math.random().toString(36).slice(2);
                      sel.dataset.liveSelect = token;
                      sel.focus();
                      const r = sel.getBoundingClientRect();
                      return {
                        token,
                        value: sel.value,
                        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
                        label: sel.getAttribute("aria-label") || sel.labels?.[0]?.textContent?.trim() || "",
                        options: [...sel.options].map((o) => ({ value: o.value, label: o.label || o.text, disabled: o.disabled })),
                      };
                    })()`,
                    true,
                  )
                  .catch(() => null);
                if (select) {
                  globalThis.__liveSwallowUp = true;
                  select.contentsId = t.contents.id;
                  select.rect.x += t.ox;
                  select.rect.y += t.oy;
                  return { dragTarget: null, select };
                }
              }
            }
            if (event.type === "mouseUp" && globalThis.__liveSwallowUp) {
              globalThis.__liveSwallowUp = false;
              return { dragTarget: null };
            }
            t.contents.sendInputEvent({
              type: event.type,
              ...base,
              button: event.button || "left",
              clickCount: event.clickCount || 1,
              movementX: event.movementX || 0,
              movementY: event.movementY || 0,
            });
            if (event.type === "mouseDown") return { dragTarget: t.contents.id };
            if (event.type === "mouseUp") return { dragTarget: null };
            return { dragTarget };
          }
          const target = globalThis.__livePickKeyTarget();
          if (event.kind === "text") {
            target.insertText(event.text);
            return { dragTarget };
          }
          target.sendInputEvent({ type: event.type, keyCode: event.keyCode, modifiers });
          if (event.type === "keyDown" && event.char)
            target.sendInputEvent({ type: "char", keyCode: event.char, modifiers });
          return { dragTarget };
        },
        { event, dragTarget },
      )
      .then((result) => {
        dragTarget = result.dragTarget;
        return result.select || null;
      });
  }

  // Copy/cut/paste through the app's own edit commands, using the Mac clipboard as the
  // hand-off: copy and cut read what the app put there; paste writes the viewer's text
  // there first, so the page sees a real paste event.
  async function clipboardAction({ action, text }) {
    return app.evaluate(
      async ({ clipboard }, { action, text }) => {
        const target = globalThis.__livePickKeyTarget();
        if (!target) return { error: "window closed" };
        if (action === "paste") {
          await clipboard.writeText(String(text ?? ""));
          target.paste();
          return { ok: true };
        }
        if (action === "selectAll") {
          target.selectAll();
          return { ok: true };
        }
        // Electron 45 made the clipboard API async; await works for either form.
        const before = await clipboard.readText();
        await clipboard.writeText("");
        if (action === "cut") target.cut();
        else target.copy();
        for (let i = 0; i < 40; i++) {
          const copied = await clipboard.readText();
          if (copied) return { text: copied };
          await new Promise((r) => setTimeout(r, 25));
        }
        await clipboard.writeText(before); // nothing was selected; leave the clipboard as it was
        return { text: "" };
      },
      { action: String(action), text },
    );
  }

  // Apply the viewer's choice to the probed <select> the way a user's pick does.
  async function choose({ contentsId, token, value }) {
    return app.evaluate(
      async ({ webContents }, { contentsId, token, value }) => {
        const contents = webContents.fromId(contentsId);
        if (!contents || contents.isDestroyed()) return false;
        return contents.executeJavaScript(
          `(() => {
            const sel = document.querySelector('select[data-live-select="${token}"]');
            if (!sel) return false;
            delete sel.dataset.liveSelect;
            const value = ${JSON.stringify(value ?? null)};
            if (value === null || value === sel.value) return true;
            sel.value = value;
            sel.dispatchEvent(new Event("input", { bubbles: true }));
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          })()`,
          true,
        );
      },
      { contentsId, token: String(token).replace(/[^a-z0-9]/gi, ""), value },
    );
  }

  // Fit the real window to the viewer's shape (a phone gets a narrow, tall window, so
  // the chrome renders larger). The window minimum and the Mac's screen bound it.
  let originalSize = null;
  async function resize({ width, height, reset }) {
    const result = await app.evaluate(
      ({ BrowserWindow, screen }, { width, height, reset, originalSize }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) throw new Error("window closed");
        const before = win.getContentSize();
        if (reset && !originalSize) return { before, size: before }; // nothing to restore
        const area = screen.getDisplayMatching(win.getBounds()).workArea;
        const [minW, minH] = win.getMinimumSize();
        let [w, h] = reset && originalSize ? originalSize : [Math.round(width), Math.round(height)];
        w = Math.min(Math.max(w, minW || 1), area.width);
        h = Math.min(Math.max(h, minH || 1), area.height);
        win.setContentSize(w, h);
        const bounds = win.getBounds();
        win.setPosition(
          area.x + Math.max(0, Math.round((area.width - bounds.width) / 2)),
          area.y + Math.max(0, Math.round((area.height - bounds.height) / 2)),
        );
        return { before, size: win.getContentSize() };
      },
      { width, height, reset: !!reset, originalSize },
    );
    if (!originalSize && !reset) originalSize = result.before;
    if (reset) originalSize = null;
    return { width: result.size[0], height: result.size[1] };
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://live");
    if (req.method === "GET" && url.pathname === "/") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(readFileSync(PAGE));
      return;
    }
    if (req.method === "GET" && url.pathname === "/frame") {
      const hd = url.searchParams.get("hd") === "1";
      const since = Number(url.searchParams.get("since") || 0);
      capture(hd)
        .then((state) => {
          res.setHeader("cache-control", "no-store");
          if (!state.frame) {
            res.statusCode = 503;
            res.end("window closed");
          } else if (state.seq === since) {
            res.statusCode = 204;
            res.end();
          } else {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ seq: state.seq, ...state.frame }));
          }
        })
        .catch((error) => {
          res.statusCode = 500;
          res.end(String(error?.message || error));
        });
      return;
    }
    if (req.method === "POST" && url.pathname === "/clipboard") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(await clipboardAction(JSON.parse(body))));
        } catch (error) {
          res.statusCode = 400;
          res.end(String(error?.message || error));
        }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/select") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: await choose(JSON.parse(body)) }));
        } catch (error) {
          res.statusCode = 400;
          res.end(String(error?.message || error));
        }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/resize") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const size = await resize(JSON.parse(body || "{}"));
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(size));
        } catch (error) {
          res.statusCode = 400;
          res.end(String(error?.message || error));
        }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/input") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const selects = [];
          for (const event of JSON.parse(body)) {
            const select = await input(event);
            if (select) selects.push(select);
          }
          if (selects.length) {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ select: selects.at(-1) }));
          } else {
            res.statusCode = 204;
            res.end();
          }
        } catch (error) {
          res.statusCode = 400;
          res.end(String(error?.message || error));
        }
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return {
    url: `http://${host === "127.0.0.1" ? "localhost" : host}:${server.address().port}/`,
    close() {
      server.close();
      caffeinate?.kill();
    },
  };
}
