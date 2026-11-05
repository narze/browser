<script lang="ts">
  import { onMount } from 'svelte';
  import { dropZone } from './split-layout';
  import { endTabDrag, tabDrag } from './tab-drag.svelte';
  import type { BrowserApi, BrowserState, SplitEdge } from '../shared/browser';

  // Drop zones over the pages while a tab is dragged. Still images stand in for the
  // native pages, which hide during the drag.
  let { state: browserState, api, region }: { state: BrowserState; api: BrowserApi; region: HTMLElement } = $props();
  const INSET = 8;
  type Rect = { x: number; y: number; width: number; height: number };
  let bounds = $state<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  let targets = $state<(Rect & { id: number })[]>([]);
  let zone = $state<(Rect & { edge: SplitEdge; target: number }) | null>(null);

  onMount(() => {
    const box = region.getBoundingClientRect();
    bounds = { x: box.x, y: box.y, width: box.width, height: box.height };
    targets = [region, ...region.querySelectorAll<HTMLElement>('[data-page-id]')]
      .filter((element) => element.dataset.pageId)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { id: Number(element.dataset.pageId), x: rect.x - box.x, y: rect.y - box.y, width: rect.width, height: rect.height };
      });
  });

  function over(event: DragEvent) {
    const id = tabDrag.id;
    const x = event.clientX - bounds.x;
    const y = event.clientY - bounds.y;
    const target = targets.find((rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);
    const split = browserState.split;
    if (id === null || !target || target.id === id) { zone = null; return; }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const full = !!split && split.tabIds.length >= 4 && !split.tabIds.includes(id);
    zone = { ...dropZone(split?.layout ?? null, target, x, y, full), target: target.id };
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    const [id, target] = [tabDrag.id, zone];
    zone = null;
    if (id !== null && target) void api.splitWith(id, target.target, target.edge).catch(() => {});
    // The split can move the dragged tab in the tab list, so its dragend may never come.
    endTabDrag(api);
  }
</script>

<div class="page-drop" aria-hidden="true" style:left="{bounds.x}px" style:top="{bounds.y}px" style:width="{bounds.width}px" style:height="{bounds.height}px"
  ondragover={over} ondragleave={() => (zone = null)} ondrop={drop}>
  {#each targets as target (target.id)}
    {@const snapshot = tabDrag.snapshots.find((entry) => entry.id === target.id)}
    {#if snapshot}<img src={snapshot.image} alt="" style:left="{target.x}px" style:top="{target.y}px" style:width="{target.width}px" style:height="{target.height}px" />{/if}
  {/each}
  {#if zone}
    <div class="page-drop-zone" data-edge={zone.edge} style:left="{zone.x + INSET}px" style:top="{zone.y + INSET}px" style:width="{zone.width - INSET * 2}px" style:height="{zone.height - INSET * 2}px"></div>
  {/if}
</div>
