<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import { dividerRatio, paneNames, splitGrid } from './split-layout';
  import type { BrowserApi, BrowserState } from '../shared/browser';

  let { state: browserState, api }: { state: BrowserState; api: BrowserApi } = $props();
  let workspace: HTMLDivElement;
  let dragging = $state<{ axis: 'columns' | 'rows'; index: number; gap: number } | null>(null);
  let queries = $state(['', '', '', '']);
  let errors = $state(['', '', '', '']);
  let split = $derived(browserState.split!);
  let panes = $derived(split.tabIds.map(id => browserState.tabs.find(tab => tab.id === id)!));
  let names = $derived(paneNames(split.layout, panes.length));
  let grid = $derived(splitGrid(split));
  const capitalize = (name: string) => name[0].toUpperCase() + name.slice(1);

  async function navigate(side: number) {
    await api.setSplitTab(side, panes[side].id);
    const result = await api.navigate(queries[side]);
    errors[side] = result.error || '';
    if (!result.error) queries[side] = '';
  }
  function startResize(event: PointerEvent, axis: 'columns' | 'rows', index: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    dragging = { axis, index, gap: target.getBoundingClientRect()[axis === 'columns' ? 'width' : 'height'] };
    // Capture keeps a release outside the window, and the window listeners keep the drag
    // when hiding the page views drops that capture.
    target.setPointerCapture(event.pointerId);
    window.addEventListener('pointermove', moveResize);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    window.addEventListener('blur', stopResize);
    void api.setSplitResizing(true);
  }
  function moveResize(event: PointerEvent) {
    // Electron can send a move without a button when the page views hide; it is not part of the drag.
    if (!dragging || !(event.buttons & 1)) return;
    const { axis, index, gap } = dragging;
    const bounds = workspace.getBoundingClientRect();
    const position = axis === 'columns' ? event.clientX - bounds.x : event.clientY - bounds.y;
    void api.resizeSplit(dividerRatio(split[axis], index, position, axis === 'columns' ? bounds.width : bounds.height, gap), axis, index);
  }
  function stopResize() {
    window.removeEventListener('pointermove', moveResize);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
    window.removeEventListener('blur', stopResize);
    if (!dragging) return;
    dragging = null;
    void api.setSplitResizing(false);
  }
  const pairRatio = (axis: 'columns' | 'rows', index: number) => split[axis][index] / (split[axis][index] + split[axis][index + 1]);
  function resizeKey(event: KeyboardEvent, axis: 'columns' | 'rows', index: number) {
    const ratio = pairRatio(axis, index);
    const [less, more] = axis === 'columns' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    const values: Record<string, number> = { [less]: ratio - 0.05, [more]: ratio + 0.05, Home: 0, End: 1 };
    if (event.key in values) { event.preventDefault(); void api.resizeSplit(values[event.key], axis, index); }
  }
  // In a grid of four, each grip sits in the middle of the first crossed track, so the grips never cross.
  function gripAt(axis: 'columns' | 'rows') {
    if (split.layout !== 'grid' || split.tabIds.length < 4) return undefined;
    return `${(split[axis === 'columns' ? 'rows' : 'columns'][0] / 2) * 100}%`;
  }
  const dividerLabel = (axis: 'columns' | 'rows', index: number) =>
    grid.dividers.length === 1 ? 'Resize split panes' : `Resize ${axis} ${index + 1} and ${index + 2}`;
  onDestroy(stopResize);
</script>

<div class="split-workspace" class:rows={split.layout === 'rows'} bind:this={workspace} style:grid-template-columns={grid.columns} style:grid-template-rows={grid.rows}>
  {#each panes as tab, side}
    <section class="split-pane" class:focused={browserState.activeId === tab.id} style:grid-area={grid.panes[side]} aria-label={`${capitalize(names[side])} pane`}>
      <header class="pane-toolbar">
        <button class="pane-focus" aria-label={`Focus ${names[side]} pane`} aria-pressed={browserState.activeId === tab.id} onclick={() => api.selectTab(tab.id)}><span></span>{capitalize(names[side])}</button>
        <select aria-label={`${capitalize(names[side])} pane tab`} value={tab.id} onchange={(event) => api.setSplitTab(side, Number(event.currentTarget.value))}>
          {#each browserState.tabs.filter((option) => option.spaceId === browserState.activeSpaceId) as option}<option value={option.id}>{option.title}</option>{/each}
        </select>
        <button class="pane-remove" aria-label={`Remove ${names[side]} pane from split`} title="Remove from split · the tab stays open" onclick={() => api.removeSplitPane(tab.id)}><Icon name="close" size={13} /></button>
      </header>
      <div class="pane-content" data-page-id={tab.id}>
        {#if tab.error}
          <div class="pane-placeholder"><Icon name="globe" size={28} /><h2>This page couldn’t load.</h2><p>{tab.error}</p><button class="retry" onclick={async () => { await api.selectTab(tab.id); await api.reload(); }}>Try again</button></div>
        {:else if !tab.url}
          <div class="pane-placeholder">
            <Icon name="split" size={28} /><h2>A little more room.</h2><p>Open a website here, or choose an existing tab above.</p>
            <form class="pane-search" onsubmit={(event) => { event.preventDefault(); void navigate(side); }}>
              <input aria-label={`Search ${names[side]} pane`} bind:value={queries[side]} placeholder="Search or enter address" autocomplete="off" spellcheck="false" />
              <button aria-label={`Go in ${names[side]} pane`}><Icon name="arrow" size={16} /></button>
            </form>
            {#if errors[side]}<p class="settings-error" role="alert">{errors[side]}</p>{/if}
          </div>
        {/if}
      </div>
    </section>
  {/each}
  {#each grid.dividers as divider (`${divider.axis}-${divider.index}`)}
    {@const ratio = Math.round(pairRatio(divider.axis, divider.index) * 100)}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (This adjustable separator supports keyboard resizing.) -->
    <div class="split-divider" class:horizontal={divider.axis === 'rows'} class:dragging={dragging?.axis === divider.axis && dragging.index === divider.index} style:grid-area={divider.area} style:--grip-at={gripAt(divider.axis)}
      role="separator" aria-label={dividerLabel(divider.axis, divider.index)} aria-orientation={divider.axis === 'columns' ? 'vertical' : 'horizontal'}
      aria-valuemin="0" aria-valuemax="100" aria-valuenow={ratio} tabindex="0"
      onpointerdown={(event) => startResize(event, divider.axis, divider.index)}
      onkeydown={(event) => resizeKey(event, divider.axis, divider.index)}></div>
  {/each}
</div>
