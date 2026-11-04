<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import Settings from './Settings.svelte';
  import SplitView from './SplitView.svelte';
  import { observePageLayout } from './page-layout';
  import type { BrowserState, TabLayout } from '../shared/browser';

  const api = window.browser;
  let pageRegion: HTMLElement;
  $effect(() => {
    // Rebind observers after Svelte changes which tabs occupy the page regions.
    const layoutKey = [browserState.activeId, browserState.split?.tabIds.join(','), browserState.settingsOpen, browserState.tabLayout].join(':');
    if (api && pageRegion && browserState.activeId > 0 && layoutKey) return observePageLayout(pageRegion, api.reportPageLayout);
  });
  let browserState = $state<BrowserState>({ palette: null, resolvedTheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', tabs: [], tabSlots: [], activeId: 0, platform: '', tabLayout: 'top', split: null, splitResizing: false, settingsOpen: false, settings: { tabLayout: 'top', searchEngine: 'duckduckgo', showShortcuts: true, theme: 'system' } });
  $effect(() => { document.documentElement.dataset.theme = browserState.resolvedTheme; });
  let vertical = $derived(browserState.tabLayout !== 'top');
  let tabRows = $derived(browserState.tabSlots.map((ids) => ids.map((id) => browserState.tabs.find((tab) => tab.id === id)!)));
  let visibleTabs = $derived(tabRows.flat());

  let address = $state('');
  let query = $state('');
  let inputError = $state('');
  let addressInput: HTMLInputElement;
  let current = $derived(browserState.tabs.find((tab) => tab.id === browserState.activeId));
  let modifier = $derived(browserState.platform === 'darwin' ? '⌘' : 'Ctrl+');
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

  async function focusAddress() {
    await tick();
    addressInput?.focus();
    addressInput?.select();
  }

  async function tabKey(event: KeyboardEvent, tabId: number) {
    const previousKey = vertical ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
    let id: number | undefined;
    if (vertical && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && browserState.split?.tabIds.includes(tabId)) {
      id = browserState.split.tabIds[event.key === 'ArrowLeft' ? 0 : 1];
    } else if (event.key === previousKey || event.key === nextKey) {
      const index = visibleTabs.findIndex((tab) => tab.id === tabId);
      const direction = event.key === nextKey ? 1 : -1;
      id = visibleTabs[(index + direction + visibleTabs.length) % visibleTabs.length].id;
    }
    if (id !== undefined) {
      event.preventDefault();
      await api?.selectTab(id);
      await tick();
      document.getElementById(`tab-${id}`)?.focus();
    }
  }

  function keydown(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'Tab') {
      event.preventDefault();
      void api?.cycleTab(event.shiftKey ? -1 : 1);
    }
    if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
      event.preventDefault();
      void api?.selectTabPosition(Number(event.key));
    }
    if (event.key === 'Escape') {
      if (browserState.settingsOpen) { void api?.closeSettings(); return; }
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
    void api.getState().then((initial) => { update(initial); if (!current?.url) void focusAddress(); });
    return () => { offState(); offFocus(); };
  });
</script>

<svelte:window onkeydown={keydown} />

<div class="browser" class:mac={browserState.platform === 'darwin'} class:vertical class:left={browserState.tabLayout === 'left'} class:right={browserState.tabLayout === 'right'}>
  {#if vertical}<div class="tab-rail" aria-hidden="true"></div>{/if}
  <header class="chrome">
    <div class="tab-row">
      <div class="tabs" role="tablist" aria-label="Browser tabs" aria-orientation={vertical ? 'vertical' : 'horizontal'}>
        {#each tabRows as row (row.length > 1 ? 'split' : row[0].id)}
          <div class="tab-entry" class:split-tab-group={row.length > 1} role={row.length > 1 ? 'group' : undefined} aria-label={row.length > 1 ? 'Split tabs' : undefined}>
            {#each row as tab (tab.id)}
              <div class="tab" class:active={tab.id === browserState.activeId}>
                <button id={`tab-${tab.id}`} class="tab-select" role="tab" aria-label={tab.title} title={tab.title} aria-selected={tab.id === browserState.activeId}
                  tabindex={tab.id === browserState.activeId ? 0 : -1} onkeydown={(event) => tabKey(event, tab.id)}
                  onclick={() => api?.selectTab(tab.id)} onauxclick={(event) => { if (event.button === 1) void api?.closeTab(tab.id); }}>
                  {#if tab.loading}<span class="spinner" aria-label="Loading"></span>
                  {:else}<span class="tab-icon"><Icon name={tab.url ? 'globe' : 'plus'} size={14} /></span>{/if}
                  <span class="tab-title">{tab.title}</span>
                </button>
                <button class="close-tab" aria-label={`Close tab: ${tab.title}`} title="Close tab ({modifier}W)" onclick={() => api?.closeTab(tab.id)}><Icon name="close" size={13} /></button>
              </div>
            {/each}
          </div>
        {/each}
      </div>
      <button class="icon-button new-tab" aria-label="New tab" title="New tab ({modifier}T)" disabled={!api} onclick={() => api?.newTab()}><Icon name="plus" size={18} />{#if vertical}<span>New tab</span><kbd>{modifier}T</kbd>{/if}</button>
      <div class="drag-space"></div>
      <label class="layout-control">
        <span>Tabs</span>
        <select aria-label="Tab layout" value={browserState.tabLayout} disabled={!api} onchange={async (event) => { const result = await api?.setTabLayout(event.currentTarget.value as TabLayout); inputError = result?.error || ''; }}>
          <option value="top">Top</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </label>
      <span class="window-name">Browser</span>
    </div>
    <div class="toolbar">
      <nav aria-label="Page navigation">
        <button class="icon-button" aria-label="Back" title="Back (Alt+Left)" disabled={!current?.canGoBack} onclick={() => api?.back()}><Icon name="back" /></button>
        <button class="icon-button" aria-label="Forward" title="Forward (Alt+Right)" disabled={!current?.canGoForward} onclick={() => api?.forward()}><Icon name="forward" /></button>
        <button class="icon-button" aria-label={current?.loading ? 'Stop loading' : 'Reload'} title={current?.loading ? 'Stop loading' : `Reload (${modifier}R)`} disabled={!current?.url} onclick={() => current?.loading ? api?.stop() : api?.reload()}><Icon name={current?.loading ? 'close' : 'reload'} size={17} /></button>
      </nav>
      <form class="address-bar" class:invalid={!!inputError} onsubmit={(event) => { event.preventDefault(); void navigate(address); }}>
        <span class="address-icon"><Icon name={current?.url.startsWith('https:') ? 'shield' : 'search'} size={15} /></span>
        <input bind:this={addressInput} bind:value={address} aria-label="Search or enter address" aria-invalid={!!inputError} placeholder="Search or enter address" autocomplete="off" spellcheck="false" disabled={!api} onfocus={() => addressInput.select()} />
        {#if inputError}<span class="input-error" role="alert" title={inputError}>{inputError}</span>{/if}
        <span class="address-shortcut">{modifier}L</span>
      </form>
      <button class="icon-button" aria-label="Command palette" title="Command palette ({modifier}K)" disabled={!api} onclick={() => api?.openPalette()}><Icon name="command" size={17} /></button>
      <button class="icon-button home-button" aria-label="Home" title="New-tab page" disabled={!api} onclick={() => navigate('')}><Icon name="home" size={17} /></button>
      <button class="icon-button" class:settings-active={!!browserState.split} aria-label={browserState.split ? 'Exit split view' : 'Split tabs'} aria-pressed={!!browserState.split} title={browserState.split ? 'Exit split view' : 'Split tabs'} disabled={!api} onclick={() => api?.toggleSplit()}><Icon name="split" size={18} /></button>
      <button class="icon-button" class:settings-active={browserState.settingsOpen} aria-label="Settings" aria-pressed={browserState.settingsOpen} title="Settings ({modifier},)" disabled={!api} onclick={() => api?.openSettings()}><Icon name="settings" size={18} /></button>
    </div>
    {#if current?.loading}<div class="loading-bar"></div>{/if}
  </header>

  <main bind:this={pageRegion} data-page-id={!browserState.split || browserState.settingsOpen ? browserState.activeId : undefined}>
    {#if browserState.settingsOpen && api}
      <Settings settings={browserState.settings} onclose={() => api.closeSettings()} onsave={(patch) => api.updateSettings(patch)} />
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
      <footer class="new-page-footer"><span class="status-dot"></span> Ready to explore <span class="footer-shortcut">New tab <kbd>{modifier}T</kbd></span></footer>
    {/if}
  </main>
</div>
