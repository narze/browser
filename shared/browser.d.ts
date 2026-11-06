export type TabZone = "favorites" | "pinned" | "today";
export type SpaceColor =
  | "blue"
  | "purple"
  | "pink"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "gray";
/** A space is a separate set of tabs with its own cookies, logins, and storage. */
export interface Space {
  id: number;
  name: string;
  color: SpaceColor;
  /** The Electron session partition is persist:<profile>. */
  profile: string;
}
/** New tabs for this site, and its subdomains, open in the space. */
export interface SiteRoute {
  id: number;
  host: string;
  spaceId: number;
}
export interface BrowserTab {
  id: number;
  spaceId: number;
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
/** A tab that plays or paused media, makes sound, or is muted. */
export interface TabMedia {
  tabId: number;
  /** The state of its audio or video elements, or null when it has none that played. */
  playback: "playing" | "paused" | null;
  /** The tab makes sound now. */
  audible: boolean;
  muted: boolean;
}
export interface TabFolder {
  id: number;
  name: string;
  collapsed: boolean;
  spaceId: number;
  /** The folder this folder is in, or null at the top level. Always in the same space. */
  parentId: number | null;
}
export interface ArchiveEntry {
  id: number;
  url: string;
  title: string;
  reason: "closed" | "auto";
  archivedAt: number;
  spaceId: number;
}
export interface TabSections {
  favorites: number[][];
  /** Every folder of the space, depth first, with the tabs directly in it. */
  folders: { id: number; slots: number[][] }[];
  pinned: number[][];
  today: number[][];
}
export type EditTarget = { kind: "tab" | "folder" | "space"; id: number };
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
export type SplitLayout = "columns" | "rows" | "grid";
export type SplitEdge = "left" | "right" | "top" | "bottom";
export type PaletteMode = "navigate" | "commands";
export type PaletteAction =
  | { type: "navigate"; input: string; newTab: boolean }
  | { type: "tab"; id: number }
  | { type: "command"; id: string };
export interface BrowserState {
  palette: { query: string; mode: PaletteMode; requestId: number } | null;
  resolvedTheme: "light" | "dark";
  /** Tabs with media, newest playback first. */
  media: TabMedia[];
  split: {
    /** Two to four tabs, in pane order. */
    tabIds: number[];
    layout: SplitLayout;
    /** Track sizes as fractions of the width and height. A grid has two of each. */
    columns: number[];
    rows: number[];
  } | null;
  splitResizing: boolean;
  sidebarResizing: boolean;
  /** A tab is being dragged over the pages, which hide so the chrome can show drop zones. */
  tabDragging: boolean;
  settings: BrowserSettings;
  settingsOpen: boolean;
  archiveOpen: boolean;
  archive: ArchiveEntry[];
  /** The folders of the active space, depth first. */
  folders: TabFolder[];
  /** The sections and slots of the active space. */
  sections: TabSections;
  spaces: Space[];
  activeSpaceId: number;
  routes: SiteRoute[];
  tabLayout: TabLayout;
  tabs: BrowserTab[];
  tabSlots: number[][];
  activeId: number;
  platform: string;
  /** A link shown above the current page. It is not in the tab list until expanded. */
  peek: BrowserTab | null;
  /** The page of the quick window, a small separate window for fast lookups. */
  mini: BrowserTab | null;
}
export interface PageSnapshot {
  id: number;
  /** A data URL. */
  image: string;
}
export interface BrowserExtension {
  id: string;
  name: string;
  version: string;
  path: string;
  enabled: boolean;
  loaded: boolean;
  error: string | null;
  hasPopup: boolean;
  hasOptions: boolean;
}
export interface BrowserApi {
  getExtensions(spaceId: number): Promise<BrowserExtension[]>;
  loadExtension(spaceId: number): Promise<{ error?: string }>;
  setExtensionEnabled(spaceId: number, id: string, enabled: boolean): Promise<{ error?: string }>;
  reloadExtension(spaceId: number, id: string): Promise<{ error?: string }>;
  removeExtension(spaceId: number, id: string): Promise<{ error?: string }>;
  openExtensionPage(
    spaceId: number,
    id: string,
    kind: "popup" | "options",
  ): Promise<{ error?: string }>;
  showExtensionsMenu(): Promise<void>;
  reportPageLayout(regions: PageRegion[]): Promise<void>;
  openPalette(mode?: PaletteMode): Promise<void>;
  closePalette(): Promise<void>;
  executePalette(action: PaletteAction): Promise<{ error?: string }>;
  toggleSplit(): Promise<void>;
  setSplitTab(side: number, id: number): Promise<void>;
  /** Moves the divider after track `index` to `ratio` of its two neighboring tracks. */
  resizeSplit(ratio: number, axis?: "columns" | "rows", index?: number): Promise<void>;
  addSplitPane(): Promise<void>;
  removeSplitPane(id: number): Promise<void>;
  setSplitLayout(layout: SplitLayout): Promise<void>;
  /** Drops a tab on the edge of a shown page to split with it. */
  splitWith(id: number, target: number, edge: SplitEdge): Promise<void>;
  setSplitResizing(resizing: boolean): Promise<void>;
  setSidebarResizing(resizing: boolean): Promise<void>;
  /** Still images of the shown pages, to stand in for them while a tab drag hides them. */
  capturePages(): Promise<PageSnapshot[]>;
  setTabDragging(dragging: boolean): Promise<void>;
  closePeek(): Promise<void>;
  /** Opens the peeked page as a tab, with its page as it is. */
  expandPeek(): Promise<void>;
  /** Opens the quick window, empty or with a web address. */
  openQuickWindow(): Promise<void>;
  navigateQuickWindow(input: string): Promise<{ error?: string }>;
  /** Moves the quick window's page into the main window as a tab. */
  moveQuickWindowToTab(): Promise<void>;
  closeQuickWindow(): Promise<void>;
  toggleSidebar(): Promise<void>;
  toggleCompactMode(): Promise<void>;
  /** Compact mode: tells the window whether the hidden toolbar and tabs are showing. */
  setChromeRevealed(revealed: boolean): Promise<void>;
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
  /** Copies the address of the active page and shows a "Copied" toast. */
  copyUrl(): Promise<void>;
  toggleMute(id: number): Promise<void>;
  /** Pauses the playing media of a tab, or plays the media that it paused. */
  toggleMediaPlayback(id: number): Promise<void>;
  moveTab(id: number, zone: TabZone, folderId: number | null, index: number): Promise<void>;
  renameTab(id: number, title: string): Promise<void>;
  editTab(id: number): Promise<void>;
  resetTab(id: number): Promise<void>;
  sleepTab(id: number): Promise<{ error?: string }>;
  showTabMenu(id: number): Promise<void>;
  createFolder(name?: string, tabId?: number, parentId?: number): Promise<void>;
  renameFolder(id: number, name: string): Promise<void>;
  toggleFolder(id: number): Promise<void>;
  deleteFolder(id: number): Promise<void>;
  /** Makes a folder child `index` of `parentId` (null: the top level). */
  moveFolder(id: number, index: number, parentId: number | null): Promise<void>;
  showFolderMenu(id: number): Promise<void>;
  openArchive(): Promise<void>;
  closeArchive(): Promise<void>;
  restoreArchived(id: number): Promise<void>;
  removeArchived(id: number): Promise<void>;
  clearArchive(): Promise<void>;
  createSpace(): Promise<void>;
  switchSpace(id: number): Promise<void>;
  cycleSpace(direction: number): Promise<void>;
  renameSpace(id: number, name: string): Promise<void>;
  deleteSpace(id: number): Promise<void>;
  showSpaceMenu(id: number): Promise<void>;
  moveTabToSpace(id: number, spaceId: number): Promise<void>;
  addRoute(host: string, spaceId: number): Promise<{ error?: string }>;
  removeRoute(id: number): Promise<void>;
  onEdit(callback: (target: EditTarget) => void): () => void;
  onState(callback: (state: BrowserState) => void): () => void;
  onFocusAddress(callback: () => void): () => void;
  /** Compact mode: the pointer moved onto, or away from, the window edge over a page. */
  onPageEdge(callback: (atEdge: boolean) => void): () => void;
  /** A short message, such as "Copied", to show near the address bar. */
  onToast(callback: (message: string) => void): () => void;
}
