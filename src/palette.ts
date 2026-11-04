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
  const active = state.tabs.find((tab) => tab.id === state.activeId);
  const modifier = state.platform === "darwin" ? "⌘" : "Ctrl+";
  const commands = [
    {
      id: "new-tab",
      title: "New tab",
      detail: "Start with a blank page",
      icon: "plus",
      hint: `${modifier}T`,
    },
    {
      id: "settings",
      title: "Open settings",
      detail: "Appearance and browsing preferences",
      icon: "settings",
      hint: `${modifier},`,
    },
    {
      id: "split",
      title: state.split ? "Exit split view" : "Split tabs",
      detail: state.split ? "Return to one page" : "Browse two pages side by side",
      icon: "split",
      hint: "",
    },
    {
      id: "close-tab",
      title: "Close current tab",
      detail: active?.title || "New tab",
      icon: "close",
      hint: `${modifier}W`,
    },
    ...(active?.url
      ? [
          {
            id: "reload",
            title: "Reload page",
            detail: active.title,
            icon: "reload",
            hint: `${modifier}R`,
          },
        ]
      : []),
    ...(active?.canGoBack
      ? [
          {
            id: "back",
            title: "Go back",
            detail: "Previous page in this tab",
            icon: "back",
            hint: "Alt+←",
          },
        ]
      : []),
    ...(active?.canGoForward
      ? [
          {
            id: "forward",
            title: "Go forward",
            detail: "Next page in this tab",
            icon: "forward",
            hint: "Alt+→",
          },
        ]
      : []),
    ...(["system", "light", "dark"] as const).map((theme) => ({
      id: `theme-${theme}`,
      title: `${theme[0].toUpperCase()}${theme.slice(1)} theme`,
      detail: theme === "system" ? "Follow your system appearance" : `Use the ${theme} appearance`,
      icon: "settings",
      hint: state.settings.theme === theme ? "Current" : "",
    })),
    ...(["top", "left", "right"] as const).map((layout) => ({
      id: `tabs-${layout}`,
      title: `Tabs on the ${layout}`,
      detail: layout === "top" ? "Horizontal tab bar" : "Vertical tab sidebar",
      icon: "split",
      hint: state.tabLayout === layout ? "Current" : "",
    })),
  ];
  const commandResults: PaletteResult[] = commands
    .filter((command) => matches(`${command.title} ${command.detail}`))
    .map((command) => ({
      ...command,
      id: `command-${command.id}`,
      action: { type: "command", id: command.id },
    }));
  if (commandsOnly) return commandResults;
  const tabs: PaletteResult[] = [...state.tabs]
    .sort((a, b) => Number(b.id === state.activeId) - Number(a.id === state.activeId))
    .filter((tab) => matches(`${tab.title} ${tab.url}`))
    .map((tab) => ({
      id: `tab-${tab.id}`,
      title: tab.title,
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
            : `Search with ${{ duckduckgo: "DuckDuckGo", google: "Google", bing: "Bing" }[state.settings.searchEngine]}`,
          icon: "search",
          hint: "Open",
          action: { type: "navigate", input: query, newTab: false },
        },
      ]
    : [];
  return [...navigation, ...tabs.slice(0, 6), ...commandResults].slice(0, 12);
}
