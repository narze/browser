export type TabZone = "favorites" | "pinned" | "today";
export interface BrowserTab {
  id: number;
  title: string;
  url: string;
  loading: boolean;
  error: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Favorites and pinned tabs stay until removed; today tabs archive when idle. */
  zone: TabZone;
  folderId: number | null;
  /** The page a favorite or pinned tab returns to when reset or closed. */
  homeUrl: string | null;
  homeTitle: string | null;
  /** A name the user chose. It replaces the page title in the browser controls. */
  customTitle: string | null;
  /** A cached icon file name, served to the chrome as favicon://icon/<name>. */
  favicon: string | null;
  /** A sleeping tab has no loaded page until it is shown again. */
  asleep: boolean;
  lastActiveAt: number;
}
export interface TabFolder {
  id: number;
  name: string;
  collapsed: boolean;
}
export interface ArchiveEntry {
  id: number;
  url: string;
  title: string;
  reason: "closed" | "auto";
  archivedAt: number;
}
export interface TabSections {
  favorites: number[][];
  folders: { id: number; slots: number[][] }[];
  pinned: number[][];
  today: number[][];
}
export type EditTarget = { kind: "tab" | "folder"; id: number };
export interface PageRegion {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
}
type SettingsSchema = typeof import("./settings.js").settingsSchema;
export type BrowserSettings = {
  [K in keyof SettingsSchema]: K extends "shortcuts"
    ? Record<string, string>
    : SettingsSchema[K] extends { options: readonly { value: infer V }[] }
      ? V
      : SettingsSchema[K] extends { min: number }
        ? number
        : boolean;
};
export type TabLayout = BrowserSettings["tabLayout"];
export type PaletteMode = "navigate" | "commands";
export type PaletteAction =
  | { type: "navigate"; input: string; newTab: boolean }
  | { type: "tab"; id: number }
  | { type: "command"; id: string };
export interface BrowserState {
  palette: { query: string; mode: PaletteMode; requestId: number } | null;
  resolvedTheme: "light" | "dark";
  split: { tabIds: [number, number]; ratio: number } | null;
  splitResizing: boolean;
  sidebarResizing: boolean;
  settings: BrowserSettings;
  settingsOpen: boolean;
  archiveOpen: boolean;
  archive: ArchiveEntry[];
  folders: TabFolder[];
  sections: TabSections;
  tabLayout: TabLayout;
  tabs: BrowserTab[];
  tabSlots: number[][];
  activeId: number;
  platform: string;
}
export interface BrowserApi {
  reportPageLayout(regions: PageRegion[]): Promise<void>;
  openPalette(mode?: PaletteMode): Promise<void>;
  closePalette(): Promise<void>;
  executePalette(action: PaletteAction): Promise<{ error?: string }>;
  toggleSplit(): Promise<void>;
  setSplitTab(side: number, id: number): Promise<void>;
  resizeSplit(ratio: number): Promise<void>;
  setSplitResizing(resizing: boolean): Promise<void>;
  setSidebarResizing(resizing: boolean): Promise<void>;
  toggleSidebar(): Promise<void>;
  setTabLayout(layout: TabLayout): Promise<{ error?: string }>;
  updateSettings(settings: Partial<BrowserSettings>): Promise<{ error?: string }>;
  /** Pauses browser shortcuts while the settings page records a new one. */
  setShortcutRecording(recording: boolean): Promise<void>;
  openSettings(): Promise<void>;
  closeSettings(): Promise<void>;
  getState(): Promise<BrowserState>;
  newTab(): Promise<number>;
  selectTab(id: number): Promise<void>;
  cycleTab(direction: number): Promise<number>;
  selectTabPosition(position: number): Promise<void>;
  closeTab(id: number): Promise<void>;
  navigate(input: string): Promise<{ error?: string }>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  stop(): Promise<void>;
  moveTab(id: number, zone: TabZone, folderId: number | null, index: number): Promise<void>;
  renameTab(id: number, title: string): Promise<void>;
  editTab(id: number): Promise<void>;
  resetTab(id: number): Promise<void>;
  sleepTab(id: number): Promise<{ error?: string }>;
  showTabMenu(id: number): Promise<void>;
  createFolder(name?: string, tabId?: number): Promise<void>;
  renameFolder(id: number, name: string): Promise<void>;
  toggleFolder(id: number): Promise<void>;
  deleteFolder(id: number): Promise<void>;
  moveFolder(id: number, index: number): Promise<void>;
  showFolderMenu(id: number): Promise<void>;
  openArchive(): Promise<void>;
  closeArchive(): Promise<void>;
  restoreArchived(id: number): Promise<void>;
  removeArchived(id: number): Promise<void>;
  clearArchive(): Promise<void>;
  onEdit(callback: (target: EditTarget) => void): () => void;
  onState(callback: (state: BrowserState) => void): () => void;
  onFocusAddress(callback: () => void): () => void;
}
