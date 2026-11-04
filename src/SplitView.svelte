<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import type { BrowserApi, BrowserState } from '../shared/browser';

  let { state: browserState, api }: { state: BrowserState; api: BrowserApi } = $props();
  let workspace: HTMLDivElement;
  let divider = $state<HTMLDivElement>();
  let dragging = $state(false);
  let queries = $state(['', '']);
  let errors = $state(['', '']);
  let panes = $derived(browserState.split?.tabIds.map(id => browserState.tabs.find(tab => tab.id === id)!) || []);

  async function navigate(side: number) {
    await api.setSplitTab(side, panes[side].id);
    const result = await api.navigate(queries[side]);
    errors[side] = result.error || '';
    if (!result.error) queries[side] = '';
  }
  function startResize(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    void api.setSplitResizing(true);
  }
  function moveResize(event: PointerEvent) {
    if (!dragging) return;
    const bounds = workspace.getBoundingClientRect();
    const gap = divider!.getBoundingClientRect().width;
    void api.resizeSplit((event.clientX - bounds.x - gap / 2) / (bounds.width - gap));
  }
  function stopResize() {
    if (!dragging) return;
    dragging = false;
    void api.setSplitResizing(false);
  }
  function resizeKey(event: KeyboardEvent) {
    const ratio = browserState.split?.ratio ?? 0.5;
    const values: Record<string, number> = { ArrowLeft: ratio - 0.05, ArrowRight: ratio + 0.05, Home: 0.25, End: 0.75 };
    if (event.key in values) { event.preventDefault(); void api.resizeSplit(values[event.key]); }
  }
  onDestroy(stopResize);
</script>

<div class="split-workspace" bind:this={workspace} style:grid-template-columns={`minmax(0, ${browserState.split?.ratio ?? 0.5}fr) var(--split-divider-width) minmax(0, ${1 - (browserState.split?.ratio ?? 0.5)}fr)`}>
  {#each panes as tab, side}
    {#if side === 1}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (This adjustable separator supports keyboard resizing.) -->
      <div class="split-divider" bind:this={divider} class:dragging role="separator" aria-label="Resize split panes" aria-orientation="vertical"
        aria-valuemin="25" aria-valuemax="75" aria-valuenow={Math.round((browserState.split?.ratio ?? 0.5) * 100)} tabindex="0"
        onpointerdown={startResize} onpointermove={moveResize} onpointerup={stopResize} onpointercancel={stopResize} onlostpointercapture={stopResize} onkeydown={resizeKey}></div>
    {/if}
    <section class="split-pane" class:focused={browserState.activeId === tab.id} aria-label={side === 0 ? 'Left pane' : 'Right pane'}>
      <header class="pane-toolbar">
        <button class="pane-focus" aria-label={side === 0 ? 'Focus left pane' : 'Focus right pane'} aria-pressed={browserState.activeId === tab.id} onclick={() => api.selectTab(tab.id)}><span></span>{side === 0 ? 'Left' : 'Right'}</button>
        <select aria-label={side === 0 ? 'Left pane tab' : 'Right pane tab'} value={tab.id} onchange={(event) => api.setSplitTab(side, Number(event.currentTarget.value))}>
          {#each browserState.tabs as option}<option value={option.id}>{option.title}</option>{/each}
        </select>
      </header>
      <div class="pane-content" data-page-id={tab.id}>
        {#if tab.error}
          <div class="pane-placeholder"><Icon name="globe" size={28} /><h2>This page couldn’t load.</h2><p>{tab.error}</p><button class="retry" onclick={async () => { await api.selectTab(tab.id); await api.reload(); }}>Try again</button></div>
        {:else if !tab.url}
          <div class="pane-placeholder">
            <Icon name="split" size={28} /><h2>A little more room.</h2><p>Open a website here, or choose an existing tab above.</p>
            <form class="pane-search" onsubmit={(event) => { event.preventDefault(); void navigate(side); }}>
              <input aria-label={side === 0 ? 'Search left pane' : 'Search right pane'} bind:value={queries[side]} placeholder="Search or enter address" autocomplete="off" spellcheck="false" />
              <button aria-label={side === 0 ? 'Go in left pane' : 'Go in right pane'}><Icon name="arrow" size={16} /></button>
            </form>
            {#if errors[side]}<p class="settings-error" role="alert">{errors[side]}</p>{/if}
          </div>
        {:else if browserState.splitResizing || browserState.sidebarResizing}
          <div class="pane-placeholder"><Icon name="globe" size={28} /><h2>{tab.title}</h2><p>{browserState.sidebarResizing ? 'Resizing sidebar…' : 'Resizing pane…'}</p></div>
        {/if}
      </div>
    </section>
  {/each}
</div>
