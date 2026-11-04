export interface BrowserTab {
  id: number;
  title: string;
  url: string;
  loading: boolean;
  error: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
}
export interface PageRegion {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
}
type SettingsSchema = typeof import("./settings.js").settingsSchema;
export type BrowserSettings = {
  [K in keyof SettingsSchema]: SettingsSchema[K] extends { options: readonly { value: infer V }[] }
    ? V
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
  settings: BrowserSettings;
  settingsOpen: boolean;
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
  setTabLayout(layout: TabLayout): Promise<{ error?: string }>;
  updateSettings(settings: Partial<BrowserSettings>): Promise<{ error?: string }>;
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
  onState(callback: (state: BrowserState) => void): () => void;
  onFocusAddress(callback: () => void): () => void;
}
