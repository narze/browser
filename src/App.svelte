<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import Settings from './Settings.svelte';
  import SplitView from './SplitView.svelte';
  import PageDrop from './PageDrop.svelte';
  import { tabDrag } from './tab-drag.svelte';
  import TabList from './TabList.svelte';
  import Archive from './Archive.svelte';
  import SpaceSwitcher from './SpaceSwitcher.svelte';
  import MediaControls from './MediaControls.svelte';
  import { observePageLayout } from './page-layout';
  import { clampSidebarWidth, defaultSettings, settingsSchema } from '../shared/settings.js';
  import { formatAccelerator, resolveShortcuts } from '../shared/shortcuts.js';
  import type { BrowserState } from '../shared/browser';

  const api = window.browser;
  let pageRegion = $state<HTMLElement>();
  $effect(() => {
    // Rebind observers after Svelte changes which tabs occupy the page regions.
    const layoutKey = [browserState.activeId, browserState.split?.tabIds.join(','), browserState.settingsOpen, browserState.archiveOpen, browserState.tabLayout, chromeHidden].join(':');
    if (api && pageRegion && browserState.activeId > 0 && layoutKey) return observePageLayout(pageRegion, api.reportPageLayout);
  });
  let browserState = $state<BrowserState>({ palette: null, resolvedTheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', media: [], tabs: [], tabSlots: [], activeId: 0, platform: '', tabLayout: defaultSettings.tabLayout, split: null, splitResizing: false, sidebarResizing: false, tabDragging: false, peek: null, mini: null, settingsOpen: false, archiveOpen: false, archive: [], folders: [], spaces: [], activeSpaceId: 0, routes: [], sections: { favorites: [], folders: [], pinned: [], today: [] }, settings: { ...defaultSettings } });
  $effect(() => { document.documentElement.dataset.theme = browserState.resolvedTheme; });
  let vertical = $derived(browserState.tabLayout !== 'top');
  let sidebarHidden = $derived(vertical && !browserState.settings.sidebarVisible);
  // Local width while dragging; persisted to settings once on release.
  let dragWidth = $state<number | null>(null);
  let sidebarDragging = false;
  let sidebarWidth = $derived(dragWidth ?? browserState.settings.sidebarWidth);
  // Compact mode hides the toolbar and tabs. They show while the pointer came from
  // their window edge and has not moved onto the page yet, or while they have focus.
  const EDGE = 4;
  let edgeReveal = $state(false);
  let chromeFocused = $state(false);
  let compact = $derived(browserState.settings.compactMode);
  // A short message near the address bar, such as "Copied". Compact mode shows the toolbar for it.
  let toast = $state('');
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function showToast(message: string) {
    toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 1600);
  }
  let revealed = $derived(compact && (edgeReveal || chromeFocused || dragWidth !== null || tabDrag.id !== null || !!toast));
  let chromeHidden = $derived(compact && !revealed);
  $effect(() => { void api?.setChromeRevealed(revealed); });

  let address = $state('');
  let query = $state('');
  let inputError = $state('');
  let addressInput: HTMLInputElement;
  let current = $derived(browserState.tabs.find((tab) => tab.id === browserState.activeId));
  // The sidebar media card shows the newest tab with media that is not on screen.
  let shownIds = $derived(browserState.split ? browserState.split.tabIds : [browserState.activeId]);
  let mediaEntry = $derived(vertical && !sidebarHidden && !chromeHidden ? browserState.media.find((entry) => entry.playback && !shownIds.includes(entry.tabId)) : undefined);
  let mediaTab = $derived(mediaEntry && browserState.tabs.find((tab) => tab.id === mediaEntry.tabId));
  let keys = $derived(resolveShortcuts(browserState.settings.shortcuts ?? {}));
  const key = (id: string) => formatAccelerator(keys[id] ?? '', browserState.platform);
  const withKey = (label: string, id: string) => (key(id) ? `${label} (${key(id)})` : label);
  const shortcuts = [
    { name: 'GitHub', url: 'https://github.com', icon: 'code', color: 'var(--text)', detail: 'Build something' },
    { name: 'Wikipedia', url: 'https://wikipedia.org', icon: 'globe', color: '#52728a', detail: 'Follow your curiosity' },
    { name: 'Svelte', url: 'https://svelte.dev', icon: 'code', color: '#d75b37', detail: 'Make it reactive' },
    { name: 'Hacker News', url: 'https://news.ycombinator.com', icon: 'arrow', color: '#bc7b2a', detail: 'See what’s happening' },
  ];

  function update(next: BrowserState) {
    const revealTab = next.activeId !== browserState.activeId || next.tabLayout !== browserState.tabLayout;
    const nextTab = next.tabs.find((tab) => tab.id === next.activeId);
    if (next.activeId !== browserState.activeId || nextTab?.url !== current?.url) {
      address = nextTab?.url || '';
      inputError = '';
      query = '';
    }
    browserState = next;
    if (revealTab) void tick().then(() => document.getElementById(`tab-${next.activeId}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }

  async function navigate(value: string) {
    const result = await api?.navigate(value);
    inputError = result?.error || '';
    if (!inputError) addressInput.blur();
  }

  function pageEdge(atEdge: boolean) {
    edgeReveal = atEdge;
  }
  // The pointer over the chrome's own page area (new-tab page, split toolbars) works like a page.
  function pointerMove(event: PointerEvent) {
    if (!compact) return;
    const { tabLayout } = browserState;
    const atEdge = event.clientY < EDGE || (tabLayout === 'left' && event.clientX < EDGE) || (tabLayout === 'right' && event.clientX >= window.innerWidth - EDGE);
    if (atEdge) edgeReveal = true;
    else if ((event.target as Element).closest?.('main')) edgeReveal = false;
  }
  function trackFocus() {
    // Focus moves after focusout, and to a page view without a focusin here.
    setTimeout(() => { chromeFocused = document.hasFocus() && !!document.activeElement?.closest('.chrome'); });
  }

  async function focusAddress() {
    if (compact) edgeReveal = true;
    await tick();
    addressInput?.focus();
    addressInput?.select();
  }

  function startSidebarResize(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    sidebarDragging = true;
    dragWidth = sidebarWidth;
    void api?.setSidebarResizing(true);
  }
  function moveSidebarResize(event: PointerEvent) {
    if (!sidebarDragging) return;
    const width = browserState.tabLayout === 'right' ? window.innerWidth - event.clientX : event.clientX;
    dragWidth = clampSidebarWidth(Math.min(width, window.innerWidth / 2));
  }
  async function stopSidebarResize() {
    if (!sidebarDragging || dragWidth === null) return;
    sidebarDragging = false;
    const width = dragWidth;
    if (width !== browserState.settings.sidebarWidth) await api?.updateSettings({ sidebarWidth: width });
    await api?.setSidebarResizing(false);
    dragWidth = null;
  }
  function sidebarResizeKey(event: KeyboardEvent) {
    const grow = browserState.tabLayout === 'right' ? 'ArrowLeft' : 'ArrowRight';
    const shrink = browserState.tabLayout === 'right' ? 'ArrowRight' : 'ArrowLeft';
    const { min, max, default: initial } = settingsSchema.sidebarWidth;
    const values: Record<string, number> = { [grow]: sidebarWidth + 20, [shrink]: sidebarWidth - 20, Home: min, End: max, Enter: initial };
    if (!(event.key in values)) return;
    event.preventDefault();
    void api?.updateSettings({ sidebarWidth: clampSidebarWidth(values[event.key]) });
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (browserState.settingsOpen) { void api?.closeSettings(); return; }
      if (browserState.archiveOpen) { void api?.closeArchive(); return; }
      address = current?.url || '';
      inputError = '';
      addressInput.blur();
      if (current?.loading) void api?.stop();
    }
  }

  onMount(() => {
    if (!api) return;
    const offState = api.onState(update);
    const offFocus = api.onFocusAddress(() => void focusAddress());
    const offEdge = api.onPageEdge(pageEdge);
    const offToast = api.onToast(showToast);
    void api.getState().then((initial) => { update(initial); if (!current?.url) void focusAddress(); });
    return () => { offState(); offFocus(); offEdge(); offToast(); clearTimeout(toastTimer); };
  });
</script>

<svelte:window onkeydown={keydown} onpointermove={pointerMove} onfocusin={trackFocus} onfocusout={trackFocus} onblur={trackFocus} />

<div class="browser" class:mac={browserState.platform === 'darwin'} class:vertical class:left={browserState.tabLayout === 'left'} class:right={browserState.tabLayout === 'right'} class:sidebar-resizing={dragWidth !== null} class:sidebar-hidden={sidebarHidden} class:chrome-hidden={chromeHidden} class:has-media={!!mediaTab} style:--sidebar-width={sidebarHidden || chromeHidden ? '0px' : vertical ? `min(${sidebarWidth}px, 50vw)` : undefined}>
  {#if vertical && !sidebarHidden && !chromeHidden}
    <div class="tab-rail" aria-hidden="true"></div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (This adjustable separator supports keyboard resizing.) -->
    <div class="sidebar-resizer" role="separator" aria-label="Resize tab sidebar" aria-orientation="vertical" title="Drag to resize · double-click to reset"
      aria-valuemin={settingsSchema.sidebarWidth.min} aria-valuemax={settingsSchema.sidebarWidth.max} aria-valuenow={sidebarWidth} tabindex="0"
      onpointerdown={startSidebarResize} onpointermove={moveSidebarResize} onpointerup={stopSidebarResize} onpointercancel={stopSidebarResize} onlostpointercapture={stopSidebarResize}
      ondblclick={() => api?.updateSettings({ sidebarWidth: settingsSchema.sidebarWidth.default })} onkeydown={sidebarResizeKey}></div>
  {/if}
  <header class="chrome">
    <div class="tab-row">
      <SpaceSwitcher state={browserState} {api} nextKey={key('nextSpace')} newKey={key('newSpace')} ondone={() => { if (!current?.url) void focusAddress(); }} />
      <TabList state={browserState} {api} {vertical} closeShortcut={key('closeTab')} />
      {#if mediaEntry && mediaTab && api}<MediaControls entry={mediaEntry} tab={mediaTab} {api} />{/if}
      <button class="icon-button new-tab" aria-label="New tab" title={withKey('New tab', 'newTab')} disabled={!api} onclick={() => api?.newTab()}><Icon name="plus" size={18} />{#if vertical}<span>New tab</span>{#if key('newTab')}<kbd>{key('newTab')}</kbd>{/if}{/if}</button>
      <div class="drag-space"></div>
      <span class="window-name">Browser</span>
    </div>
    <div class="toolbar">
      <nav aria-label="Page navigation">
        <button class="icon-button" aria-label="Back" title={withKey('Back', 'back')} disabled={!current?.canGoBack} onclick={() => api?.back()}><Icon name="back" /></button>
        <button class="icon-button" aria-label="Forward" title={withKey('Forward', 'forward')} disabled={!current?.canGoForward} onclick={() => api?.forward()}><Icon name="forward" /></button>
        <button class="icon-button" aria-label={current?.loading ? 'Stop loading' : 'Reload'} title={current?.loading ? 'Stop loading' : withKey('Reload', 'reload')} disabled={!current?.url} onclick={() => current?.loading ? api?.stop() : api?.reload()}><Icon name={current?.loading ? 'close' : 'reload'} size={17} /></button>
      </nav>
      <form class="address-bar" class:invalid={!!inputError} onsubmit={(event) => { event.preventDefault(); void navigate(address); }}>
        <span class="address-icon"><Icon name={current?.url.startsWith('https:') ? 'shield' : 'search'} size={15} /></span>
        <input bind:this={addressInput} bind:value={address} aria-label="Search or enter address" aria-invalid={!!inputError} placeholder="Search or enter address" autocomplete="off" spellcheck="false" disabled={!api} onfocus={() => addressInput.select()} />
        {#if inputError}<span class="input-error" role="alert" title={inputError}>{inputError}</span>{/if}
        <span class="address-toast" role="status">{#if toast}<Icon name="check" size={13} />{toast}{/if}</span>
        {#if key('openAddress') && !toast}<span class="address-shortcut">{key('openAddress')}</span>{/if}
      </form>
      <button class="icon-button" aria-label="Command palette" title={withKey('Command palette', 'commandPalette')} disabled={!api} onclick={() => api?.openPalette()}><Icon name="command" size={17} /></button>
      <button class="icon-button home-button" aria-label="Home" title="New-tab page" disabled={!api} onclick={() => navigate('')}><Icon name="home" size={17} /></button>
      {#if browserState.split}
        {@const split = browserState.split}
        <div class="split-controls" role="group" aria-label="Split layout">
          <button class="icon-button" class:settings-active={split.layout === 'columns'} aria-label="Columns" aria-pressed={split.layout === 'columns'} title="Arrange panes in columns" onclick={() => api?.setSplitLayout('columns')}><Icon name="split" size={16} /></button>
          <button class="icon-button" class:settings-active={split.layout === 'rows'} aria-label="Rows" aria-pressed={split.layout === 'rows'} title="Arrange panes in rows" onclick={() => api?.setSplitLayout('rows')}><Icon name="splitRows" size={16} /></button>
          <button class="icon-button" class:settings-active={split.layout === 'grid'} aria-label="Grid" aria-pressed={split.layout === 'grid'} title={split.tabIds.length < 3 ? 'A grid needs three or four panes' : 'Arrange panes in a grid'} disabled={split.tabIds.length < 3} onclick={() => api?.setSplitLayout('grid')}><Icon name="splitGrid" size={16} /></button>
          <button class="icon-button" aria-label="Add split pane" title={split.tabIds.length < 4 ? 'Add split pane' : 'A split has at most four panes'} disabled={split.tabIds.length >= 4} onclick={() => api?.addSplitPane()}><Icon name="addPane" size={16} /></button>
        </div>
      {/if}
      <button class="icon-button" class:settings-active={!!browserState.split} aria-label={browserState.split ? 'Exit split view' : 'Split tabs'} aria-pressed={!!browserState.split} title={browserState.split ? 'Exit split view' : 'Split tabs'} disabled={!api} onclick={() => api?.toggleSplit()}><Icon name="split" size={18} /></button>
      <button class="icon-button" class:settings-active={browserState.archiveOpen} aria-label="Archive" aria-pressed={browserState.archiveOpen} title={withKey('Archive', 'archive')} disabled={!api} onclick={() => browserState.archiveOpen ? api?.closeArchive() : api?.openArchive()}><Icon name="archive" size={18} /></button>
      <button class="icon-button" class:settings-active={browserState.settingsOpen} aria-label="Settings" aria-pressed={browserState.settingsOpen} title={withKey('Settings', 'settings')} disabled={!api} onclick={() => api?.openSettings()}><Icon name="settings" size={18} /></button>
    </div>
    {#if current?.loading}<div class="loading-bar"></div>{/if}
  </header>

  <main bind:this={pageRegion} data-page-id={!browserState.split || browserState.settingsOpen || browserState.archiveOpen ? browserState.activeId : undefined}>
    {#if browserState.settingsOpen && api}
      <Settings settings={browserState.settings} platform={browserState.platform} spaces={browserState.spaces} routes={browserState.routes} activeSpaceId={browserState.activeSpaceId} {api} onclose={() => api.closeSettings()} onsave={(patch) => api.updateSettings(patch)} />
    {:else if browserState.archiveOpen && api}
      <Archive entries={browserState.archive} archiveAfter={browserState.settings.archiveAfter} {api} />
    {:else if browserState.split && api}
      <SplitView state={browserState} {api} />
    {:else if current?.error}
      <section class="error-page">
        <span class="error-icon"><Icon name="globe" size={38} /></span>
        <h1>This page couldn’t load.</h1>
        <p>{current.error}</p>
        <button class="retry" onclick={() => api?.reload()}>Try again <Icon name="reload" size={16} /></button>
      </section>
    {:else if !current?.url}
      <section class="new-page">
        <div class="intro">
          <div class="browser-mark" aria-hidden="true"><span></span><span></span><span></span></div>
          <h1>Where to next?</h1>
          <p>A fresh tab. A little room to explore.</p>
        </div>
        <form class="start-search" onsubmit={(event) => { event.preventDefault(); void navigate(query); }}>
          <Icon name="search" size={21} />
          <input bind:value={query} aria-label="Search the web" placeholder="Search the web or enter a URL" autocomplete="off" spellcheck="false" disabled={!api} />
          <button aria-label="Go" disabled={!api || !query.trim()}><Icon name="arrow" size={20} /></button>
        </form>
        {#if browserState.settings.showShortcuts}<div class="quick-links">
          {#each shortcuts as shortcut}
            <button class="quick-link" disabled={!api} onclick={() => navigate(shortcut.url)}>
              <span class="quick-icon" style:color={shortcut.color}><Icon name={shortcut.icon} size={22} /></span>
              <span><strong>{shortcut.name}</strong><small>{shortcut.detail}</small></span>
            </button>
          {/each}
        </div>{/if}
        {#if !api}<p class="desktop-notice">Run <code>pnpm dev</code> to open the Electron browser.</p>{/if}
      </section>
      <footer class="new-page-footer"><span class="status-dot"></span> Ready to explore {#if key('newTab')}<span class="footer-shortcut">New tab <kbd>{key('newTab')}</kbd></span>{/if}</footer>
    {/if}
    {#if tabDrag.id !== null && api && pageRegion && !browserState.settingsOpen && !browserState.archiveOpen}<PageDrop state={browserState} {api} region={pageRegion} />{/if}
  </main>
</div>
