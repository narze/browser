export interface BrowserTab {
  id: number;
  title: string;
  url: string;
  loading: boolean;
  error: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
}
export interface BrowserState {
  tabs: BrowserTab[];
  activeId: number;
  platform: string;
}
export interface BrowserApi {
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
