export interface BrowserTab {
  id: number;
  title: string;
  url: string;
  loading: boolean;
  error: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
}
export type TabLayout = "top" | "left" | "right";
export interface BrowserSettings {
  tabLayout: TabLayout;
  searchEngine: "duckduckgo" | "google" | "bing";
  showShortcuts: boolean;
}
export interface BrowserState {
  split: { tabIds: [number, number]; ratio: number } | null;
  splitResizing: boolean;
  settings: BrowserSettings;
  settingsOpen: boolean;
  tabLayout: TabLayout;
  tabs: BrowserTab[];
  activeId: number;
  platform: string;
}
export interface BrowserApi {
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
  closeTab(id: number): Promise<void>;
  navigate(input: string): Promise<{ error?: string }>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  stop(): Promise<void>;
  onState(callback: (state: BrowserState) => void): () => void;
  onFocusAddress(callback: () => void): () => void;
}
