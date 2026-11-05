import { paletteCommands } from "../shared/commands.js";
import { settingsSchema } from "../shared/settings.js";
import type { BrowserState, PaletteAction } from "../shared/browser";

export interface PaletteResult {
  id: string;
  title: string;
  detail: string;
  icon: string;
  hint: string;
  action: PaletteAction;
}

export function paletteResults(input: string, state: BrowserState): PaletteResult[] {
  const query = input.trim();
  const commandsOnly = query.startsWith(">");
  const terms = (commandsOnly ? query.slice(1) : query)
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const matches = (text: string) => terms.every((term) => text.toLowerCase().includes(term));
  const commandResults: PaletteResult[] = paletteCommands(state)
    .filter((command) => matches(`${command.title} ${command.detail}`))
    .map(({ command: _command, args: _args, ...command }) => ({
      ...command,
      id: `command-${command.id}`,
      action: { type: "command", id: command.id },
    }));
  if (commandsOnly) return commandResults;
  const tabs: PaletteResult[] = [...state.tabs]
    .sort((a, b) => Number(b.id === state.activeId) - Number(a.id === state.activeId))
    .filter((tab) => matches(`${tab.customTitle ?? ""} ${tab.title} ${tab.url}`))
    .map((tab) => ({
      id: `tab-${tab.id}`,
      title: tab.customTitle || tab.title,
      detail: tab.url || "New tab",
      icon: tab.url ? "globe" : "plus",
      hint: "Switch tab",
      action: { type: "tab", id: tab.id },
    }));
  const navigation: PaletteResult[] = query
    ? [
        {
          id: "navigate",
          title: query,
          detail: /^(https?:\/\/|localhost[:/]|[^\s]+\.[^\s]+)/i.test(query)
            ? "Open address"
            : `Search with ${settingsSchema.searchEngine.options.find((option) => option.value === state.settings.searchEngine)!.label}`,
          icon: "search",
          hint: "Open",
          action: { type: "navigate", input: query, newTab: false },
        },
      ]
    : [];
  return [...navigation, ...tabs.slice(0, 6), ...commandResults].slice(0, 12);
}
