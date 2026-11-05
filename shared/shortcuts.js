// @ts-check
// Keyboard shortcuts use Electron accelerator strings. "CmdOrCtrl" is Cmd on macOS
// and Ctrl elsewhere. Stored overrides map an action id to an accelerator, or to ""
// when the user removed the shortcut.

/**
 * @typedef {{ id: string, label: string, default: string, pagePriority?: boolean }} ShortcutAction
 * pagePriority actions run only when the focused page does not handle the key,
 * for example Alt+Left moves by word in a text field on macOS.
 */

/** @type {readonly ShortcutAction[]} */
export const shortcutActions = [
  { id: "newTab", label: "New tab", default: "CmdOrCtrl+T" },
  { id: "closeTab", label: "Close tab", default: "CmdOrCtrl+W" },
  { id: "reopenClosedTab", label: "Reopen closed tab", default: "CmdOrCtrl+Shift+T" },
  { id: "openAddress", label: "Open address palette", default: "CmdOrCtrl+L" },
  { id: "commandPalette", label: "Command palette", default: "CmdOrCtrl+K" },
  { id: "reload", label: "Reload page", default: "CmdOrCtrl+R" },
  { id: "back", label: "Back", default: "Alt+Left", pagePriority: true },
  { id: "forward", label: "Forward", default: "Alt+Right", pagePriority: true },
  { id: "copyUrl", label: "Copy page address", default: "CmdOrCtrl+Shift+C" },
  { id: "nextTab", label: "Next tab", default: "Ctrl+Tab" },
  { id: "previousTab", label: "Previous tab", default: "Ctrl+Shift+Tab" },
  { id: "nextTabAlternate", label: "Next tab (alternate)", default: "CmdOrCtrl+Shift+]" },
  { id: "previousTabAlternate", label: "Previous tab (alternate)", default: "CmdOrCtrl+Shift+[" },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((position) => ({
    id: `selectTab${position}`,
    label: `Go to tab ${position}`,
    default: `CmdOrCtrl+${position}`,
  })),
  { id: "selectLastTab", label: "Go to last tab", default: "CmdOrCtrl+9" },
  { id: "togglePin", label: "Pin or unpin tab", default: "CmdOrCtrl+D" },
  { id: "toggleFavorite", label: "Add to or remove from favorites", default: "CmdOrCtrl+Shift+D" },
  { id: "toggleSplit", label: "Split view", default: "Ctrl+Shift+=" },
  { id: "toggleSidebar", label: "Show or hide tab sidebar", default: "CmdOrCtrl+S" },
  { id: "newFolder", label: "New folder", default: "" },
  { id: "nextSpace", label: "Next space", default: "CmdOrCtrl+Alt+Right" },
  { id: "previousSpace", label: "Previous space", default: "CmdOrCtrl+Alt+Left" },
  { id: "newSpace", label: "New space", default: "" },
  { id: "settings", label: "Settings", default: "CmdOrCtrl+," },
  { id: "archive", label: "Archive", default: "CmdOrCtrl+Shift+A" },
  { id: "devTools", label: "Developer tools", default: "CmdOrCtrl+Alt+I" },
];

const actionIds = new Set(shortcutActions.map((action) => action.id));

const MODIFIERS = /** @type {const} */ ({
  cmd: "Cmd",
  command: "Cmd",
  ctrl: "Ctrl",
  control: "Ctrl",
  cmdorctrl: "CmdOrCtrl",
  commandorcontrol: "CmdOrCtrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  super: "Cmd",
  meta: "Cmd",
});
const ORDER = ["Ctrl", "Alt", "Shift", "Cmd"];

/** Physical keys whose character changes with Shift, Option, or the keyboard layout. */
const CODE_KEYS = /** @type {Record<string, string>} */ ({
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
});
const NAMED_KEYS = /** @type {Record<string, string>} */ ({
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Tab: "Tab",
  Enter: "Enter",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
  " ": "Space",
});
const KEY_NAMES = new Set([...Object.values(CODE_KEYS), ...Object.values(NAMED_KEYS), "Plus"]);
const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;

/** @param {string} key */
function keyName(key) {
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  if (FUNCTION_KEY.test(key.toUpperCase())) return key.toUpperCase();
  const named = Object.values(NAMED_KEYS).find((name) => name.toLowerCase() === key.toLowerCase());
  if (named) return named;
  if (key === "Esc") return "Escape";
  if (key === "Return") return "Enter";
  return KEY_NAMES.has(key) ? key : null;
}

/**
 * Returns the platform form of an accelerator with modifiers in display order,
 * or null when it is not a valid shortcut.
 * @param {string} accelerator
 * @param {string} platform
 * @returns {string | null}
 */
export function normalizeAccelerator(accelerator, platform) {
  if (typeof accelerator !== "string" || !accelerator) return null;
  // "+" separates parts, so a trailing "+" key is written "Plus" in Electron.
  const parts = accelerator.split("+");
  const key = keyName(parts.pop() ?? "");
  if (!key) return null;
  const modifiers = new Set();
  for (const part of parts) {
    const name = MODIFIERS[/** @type {keyof typeof MODIFIERS} */ (part.toLowerCase())];
    if (!name) return null;
    const resolved = name === "CmdOrCtrl" ? (platform === "darwin" ? "Cmd" : "Ctrl") : name;
    if (modifiers.has(resolved)) return null;
    modifiers.add(resolved);
  }
  const ordered = ORDER.filter((name) => modifiers.has(name)).map((name) =>
    name === "Cmd" && platform !== "darwin" ? "Super" : name,
  );
  return [...ordered, key].join("+");
}

/**
 * Converts a keydown (Electron input or DOM KeyboardEvent fields) to a platform accelerator.
 * Letters and digits follow the keyboard layout; other keys use their physical position,
 * because Shift and Option change the character they type.
 * @param {{ key: string, code: string, ctrl: boolean, meta: boolean, alt: boolean, shift: boolean }} event
 * @param {string} platform
 * @returns {string | null}
 */
export function acceleratorFromKey(event, platform) {
  const { key = "", code = "" } = event;
  let name = null;
  if (/^[a-z0-9]$/i.test(key)) name = key.toUpperCase();
  else if (/^Key[A-Z]$/.test(code)) name = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) name = code.slice(5);
  else if (FUNCTION_KEY.test(key)) name = key;
  else if (CODE_KEYS[code]) name = CODE_KEYS[code];
  else if (NAMED_KEYS[key]) name = NAMED_KEYS[key];
  if (!name) return null;
  const modifiers = [
    event.ctrl && "Ctrl",
    event.alt && "Alt",
    event.shift && "Shift",
    event.meta && (platform === "darwin" ? "Cmd" : "Super"),
  ].filter(Boolean);
  return [...modifiers, name].join("+");
}

/**
 * @param {Record<string, string>} overrides
 * @returns {Record<string, string>}
 */
export function resolveShortcuts(overrides) {
  return Object.fromEntries(
    shortcutActions.map((action) => [
      action.id,
      Object.hasOwn(overrides, action.id) ? overrides[action.id] : action.default,
    ]),
  );
}

/**
 * Maps each platform accelerator to the action it runs.
 * @param {Record<string, string>} overrides
 * @param {string} platform
 * @returns {Map<string, string>}
 */
export function shortcutLookup(overrides, platform) {
  const lookup = new Map();
  for (const [id, accelerator] of Object.entries(resolveShortcuts(overrides))) {
    const normalized = normalizeAccelerator(accelerator, platform);
    if (normalized && !lookup.has(normalized)) lookup.set(normalized, id);
  }
  return lookup;
}

/**
 * Returns the first shortcut that two or more actions share, or null.
 * @param {Record<string, string>} overrides
 * @param {string} platform
 * @returns {{ accelerator: string, ids: string[] } | null}
 */
export function shortcutConflict(overrides, platform) {
  /** @type {Map<string, string[]>} */
  const used = new Map();
  for (const [id, accelerator] of Object.entries(resolveShortcuts(overrides))) {
    const normalized = normalizeAccelerator(accelerator, platform);
    if (normalized) used.set(normalized, [...(used.get(normalized) ?? []), id]);
  }
  for (const [accelerator, ids] of used) if (ids.length > 1) return { accelerator, ids };
  return null;
}

/** @param {unknown} value @returns {value is Record<string, string>} */
export function isShortcutOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([id, accelerator]) =>
      actionIds.has(id) &&
      typeof accelerator === "string" &&
      (accelerator === "" || normalizeAccelerator(accelerator, "darwin") !== null),
  );
}

/**
 * Keeps the valid entries of stored overrides, so a removed action or a damaged entry
 * does not reset every other shortcut.
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
export function sanitizeShortcutOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([id, accelerator]) => isShortcutOverrides({ [id]: accelerator })),
  );
}

const MAC_SYMBOLS = /** @type {Record<string, string>} */ ({
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Cmd: "⌘",
});
const KEY_SYMBOLS = /** @type {Record<string, string>} */ ({
  Left: "←",
  Right: "→",
  Up: "↑",
  Down: "↓",
  Plus: "+",
});
const MAC_KEY_SYMBOLS = /** @type {Record<string, string>} */ ({
  ...KEY_SYMBOLS,
  Tab: "⇥",
  Enter: "↩",
  Escape: "⎋",
  Backspace: "⌫",
  Delete: "⌦",
});

/**
 * @param {string} accelerator
 * @param {string} platform
 * @returns {string}
 */
export function formatAccelerator(accelerator, platform) {
  const normalized = normalizeAccelerator(accelerator, platform);
  if (!normalized) return "";
  const parts = normalized.split("+");
  const key = parts.pop() ?? "";
  if (platform === "darwin")
    return parts.map((part) => MAC_SYMBOLS[part]).join("") + (MAC_KEY_SYMBOLS[key] ?? key);
  return [...parts, KEY_SYMBOLS[key] ?? key].join("+");
}
