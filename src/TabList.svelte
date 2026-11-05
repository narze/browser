<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { beginTabDrag, endTabDrag } from './tab-drag.svelte';
  import { childFolders, containerIds as treeContainerIds, isInside, nudgeFolder, nudgeTab } from './folder-tree';
  import type { BrowserApi, BrowserState, BrowserTab, EditTarget, TabFolder, TabZone } from '../shared/browser';

  let { state: browserState, api, vertical, closeShortcut }: { state: BrowserState; api: BrowserApi | undefined; vertical: boolean; closeShortcut: string } = $props();

  type Drop = { zone: TabZone; folderId: number | null; index: number; marker: string };
  let drag = $state<{ kind: 'tab' | 'folder'; id: number } | null>(null);
  let drop = $state<Drop | null>(null);
  let editing = $state<EditTarget | null>(null);
  let brokenIcons = $state<string[]>([]);
  let tabsById = $derived(new Map(browserState.tabs.map((tab) => [tab.id, tab])));
  let shown = $derived(browserState.split ? browserState.split.tabIds : [browserState.activeId]);
  let hasPinned = $derived(browserState.sections.pinned.length > 0 || browserState.folders.length > 0);
  let draggedTab = $derived(drag?.kind === 'tab' ? tabsById.get(drag.id) : undefined);
  let folderSlots = $derived(new Map(browserState.sections.folders.map((section) => [section.id, section.slots])));

  const label = (tab: BrowserTab) => tab.customTitle || tab.title;
  const containerIds = (zone: TabZone, folderId: number | null) => treeContainerIds(browserState, zone, folderId);
  const children = (parentId: number | null) => childFolders(browserState.folders, parentId);
  /** The tab slots of a folder and of every folder inside it. */
  const subtreeSlots = (folderId: number): number[][] => [
    ...children(folderId).flatMap((child) => subtreeSlots(child.id)),
    ...(folderSlots.get(folderId) ?? []),
  ];

  async function startEdit(target: EditTarget) {
    // Save a rename that is still open before the next one starts.
    const open = document.getElementById('rename-input') as HTMLInputElement | null;
    if (editing && open) commitEdit(open.value);
    editing = target;
    await tick();
    const input = document.getElementById('rename-input') as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }
  function commitEdit(value: string) {
    const target = editing;
    editing = null;
    if (!target) return;
    if (target.kind === 'tab') void api?.renameTab(target.id, value);
    else void api?.renameFolder(target.id, value);
  }
  function editKey(event: KeyboardEvent) {
    if (event.key === 'Enter') { event.preventDefault(); commitEdit((event.currentTarget as HTMLInputElement).value); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); editing = null; }
  }
  onMount(() => api?.onEdit((target) => { if (target.kind !== 'space') void startEdit(target); }));

  // Drag and drop uses native HTML drag events. The main process owns the order.
  function startDrag(event: DragEvent, kind: 'tab' | 'folder', id: number) {
    if (editing) { event.preventDefault(); return; }
    drag = { kind, id };
    event.dataTransfer?.setData('text/plain', `${kind}:${id}`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    // A tab can also drop on a page to split with it.
    if (kind === 'tab' && api) void beginTabDrag(api, id);
  }
  function endDrag() {
    drag = null;
    drop = null;
    if (api) endTabDrag(api);
  }
  const after = (event: DragEvent, horizontal: boolean) => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return horizontal ? event.clientX > box.left + box.width / 2 : event.clientY > box.top + box.height / 2;
  };
  const canDrop = (zone: TabZone) => draggedTab && (zone === 'today' || !!draggedTab.url);
  function overTab(event: DragEvent, tab: BrowserTab) {
    if (drag?.kind !== 'tab' || !canDrop(tab.zone)) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = containerIds(tab.zone, tab.folderId).filter((id) => id !== drag!.id);
    const isAfter = after(event, !vertical || tab.zone === 'favorites');
    const position = ids.indexOf(tab.id);
    drop = { zone: tab.zone, folderId: tab.folderId, index: position < 0 ? ids.length : position + (isAfter ? 1 : 0), marker: `tab-${tab.id}-${isAfter ? 'after' : 'before'}` };
  }
  function overContainer(event: DragEvent, zone: TabZone, folderId: number | null) {
    if (drag?.kind === 'folder' && zone === 'pinned' && folderId === null) {
      event.preventDefault();
      event.stopPropagation();
      const index = children(null).filter((folder) => folder.id !== drag!.id).length;
      drop = { zone, folderId: null, index, marker: 'section-pinned' };
      return;
    }
    if (drag?.kind !== 'tab' || !canDrop(zone)) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = containerIds(zone, folderId).filter((id) => id !== drag!.id);
    drop = { zone, folderId, index: ids.length, marker: folderId ? `folder-${folderId}-into` : `section-${zone}` };
  }
  function overFolder(event: DragEvent, folder: TabFolder) {
    if (drag?.kind === 'tab') return overContainer(event, 'pinned', folder.id);
    if (drag?.kind !== 'folder') return;
    event.stopPropagation();
    if (blocked(folder)) return;
    event.preventDefault();
    // The middle of a folder row drops into it; its edges drop before or after it.
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const share = vertical ? (event.clientY - box.top) / box.height : (event.clientX - box.left) / box.width;
    const others = (parentId: number | null) => children(parentId).map((entry) => entry.id).filter((id) => id !== drag!.id);
    const into = (index: number, marker: string) => (drop = { zone: 'pinned', folderId: folder.id, index, marker });
    if (share > 0.25 && share < 0.75) into(others(folder.id).length, `folder-${folder.id}-into`);
    // Right under an open folder's row is the start of its contents.
    else if (share >= 0.75 && vertical && !folder.collapsed) into(0, `folder-${folder.id}-after`);
    else {
      const isAfter = share >= 0.75;
      const index = others(folder.parentId).indexOf(folder.id) + (isAfter ? 1 : 0);
      drop = { zone: 'pinned', folderId: folder.parentId, index, marker: `folder-${folder.id}-${isAfter ? 'after' : 'before'}` };
    }
  }
  /** A folder cannot move into itself or into a folder inside it. No drop there. */
  function blocked(folder: TabFolder) {
    if (!drag || !isInside(browserState.folders, folder.id, drag.id)) return false;
    drop = null;
    return true;
  }
  /** Between the rows inside a folder: the end of that folder. */
  function overContents(event: DragEvent, folder: TabFolder) {
    if (drag?.kind === 'tab') return overContainer(event, 'pinned', folder.id);
    if (drag?.kind !== 'folder') return;
    event.stopPropagation();
    if (blocked(folder)) return;
    event.preventDefault();
    const index = children(folder.id).filter((entry) => entry.id !== drag!.id).length;
    drop = { zone: 'pinned', folderId: folder.id, index, marker: `folder-${folder.id}-into` };
  }
  function finishDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const [source, target] = [drag, drop];
    endDrag();
    if (!source || !target) return;
    if (source.kind === 'folder') void api?.moveFolder(source.id, target.index, target.folderId).catch(() => {});
    else void api?.moveTab(source.id, target.zone, target.folderId, target.index).catch(() => {});
  }
  const marked = (marker: string) => drop?.marker === marker;

  async function tabKey(event: KeyboardEvent, tab: BrowserTab) {
    const previousKey = vertical ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
    if (event.altKey && event.shiftKey && (event.key === previousKey || event.key === nextKey)) {
      // Keyboard reorder: move the tab one place, and at a folder edge into the next folder.
      event.preventDefault();
      const place = nudgeTab(browserState, tab.id, event.key === nextKey ? 1 : -1);
      if (place) await api?.moveTab(tab.id, tab.zone, place.folderId, place.index);
      await tick();
      document.getElementById(`tab-${tab.id}`)?.focus();
      return;
    }
    if (event.key === 'F2') { event.preventDefault(); void startEdit({ kind: 'tab', id: tab.id }); return; }
    const paneSelection = vertical && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && browserState.split?.tabIds.includes(tab.id);
    if (!paneSelection && event.key !== previousKey && event.key !== nextKey) return;
    event.preventDefault();
    let id: number | undefined;
    if (paneSelection) {
      const ids = browserState.split!.tabIds;
      const index = ids.indexOf(tab.id) + (event.key === 'ArrowLeft' ? -1 : 1);
      id = ids[Math.max(0, Math.min(ids.length - 1, index))];
      await api?.selectTab(id);
    } else id = await api?.cycleTab(event.key === nextKey ? 1 : -1);
    await tick();
    if (id !== undefined) document.getElementById(`tab-${id}`)?.focus();
  }
  async function folderKey(event: KeyboardEvent, folder: TabFolder) {
    if (event.key === 'F2') { event.preventDefault(); void startEdit({ kind: 'folder', id: folder.id }); return; }
    const previousKey = vertical ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
    if (!event.altKey || !event.shiftKey || (event.key !== previousKey && event.key !== nextKey)) return;
    // Keyboard reorder: move the folder among its siblings, and at the edge out of its parent.
    event.preventDefault();
    const place = nudgeFolder(browserState.folders, folder.id, event.key === nextKey ? 1 : -1);
    if (place) await api?.moveFolder(folder.id, place.index, place.parentId);
    await tick();
    document.getElementById(`folder-${folder.id}`)?.focus();
  }
  function menu(event: MouseEvent, tabId: number) {
    event.preventDefault();
    void api?.showTabMenu(tabId);
  }
</script>

{#snippet renameField(value: string, name: string, target: EditTarget)}
  <!-- svelte-ignore a11y_autofocus (Rename starts from an explicit user action.) -->
  <input id="rename-input" class="rename-input" aria-label={name} {value} maxlength="120" autocomplete="off" spellcheck="false"
    onkeydown={editKey} onblur={(event) => { if (editing?.kind === target.kind && editing.id === target.id) commitEdit(event.currentTarget.value); }} />
{/snippet}

{#snippet tabItem(tab: BrowserTab)}
  {@const changed = !!tab.homeUrl && tab.url !== tab.homeUrl && !tab.asleep}
  <!-- svelte-ignore a11y_no_static_element_interactions (Each tab has a keyboard-accessible button; dragging is an extra pointer path.) -->
  <div class="tab" class:active={tab.id === browserState.activeId} class:asleep={tab.asleep} class:editing={editing?.kind === 'tab' && editing.id === tab.id}
    class:drop-before={marked(`tab-${tab.id}-before`)} class:drop-after={marked(`tab-${tab.id}-after`)} class:dragging={drag?.kind === 'tab' && drag.id === tab.id}
    draggable={editing?.id !== tab.id} ondragstart={(event) => startDrag(event, 'tab', tab.id)} ondragend={endDrag}
    ondragover={(event) => overTab(event, tab)} ondrop={finishDrop} oncontextmenu={(event) => menu(event, tab.id)}>
    {#if editing?.kind === 'tab' && editing.id === tab.id}
      <span class="tab-select"><span class="tab-icon"><Icon name="edit" size={14} /></span>{@render renameField(label(tab), 'Tab name', { kind: 'tab', id: tab.id })}</span>
    {:else}
      <button id={`tab-${tab.id}`} class="tab-select" role="tab" aria-label={label(tab)} title={tab.asleep ? `${label(tab)} (asleep)` : label(tab)} aria-selected={tab.id === browserState.activeId}
        tabindex={tab.id === browserState.activeId ? 0 : -1} onkeydown={(event) => tabKey(event, tab)}
        onclick={() => api?.selectTab(tab.id)} ondblclick={() => tab.zone !== 'favorites' && startEdit({ kind: 'tab', id: tab.id })}
        onauxclick={(event) => { if (event.button === 1) void api?.closeTab(tab.id); }}>
        {#if tab.loading}<span class="spinner" aria-label="Loading"></span>
        {:else if tab.favicon && !brokenIcons.includes(tab.favicon)}<img class="favicon" src={`favicon://icon/${tab.favicon}`} alt="" width="16" height="16" draggable="false" onerror={() => (brokenIcons = [...brokenIcons, tab.favicon!])} />
        {:else}<span class="tab-icon"><Icon name={tab.url ? 'globe' : 'plus'} size={14} /></span>{/if}
        <span class="tab-title">{label(tab)}</span>
      </button>
      {#if changed}
        <button class="reset-tab" aria-label={`Back to pinned page: ${label(tab)}`} title={`Back to ${tab.homeTitle || tab.homeUrl}`} onclick={() => api?.resetTab(tab.id)}><Icon name="home" size={12} /></button>
      {/if}
      <button class="close-tab" aria-label={`Close tab: ${label(tab)}`} title={(tab.zone === 'today' ? 'Close tab' : 'Close and unload') + (closeShortcut ? ` (${closeShortcut})` : '')} onclick={() => api?.closeTab(tab.id)}><Icon name="close" size={13} /></button>
    {/if}
  </div>
{/snippet}

{#snippet slot(ids: number[])}
  {#if ids.length > 1}
    <div class="tab-entry split-tab-group" role="group" aria-label="Split tabs">
      {#each ids as id (id)}{@render tabItem(tabsById.get(id)!)}{/each}
    </div>
  {:else}
    <div class="tab-entry">{@render tabItem(tabsById.get(ids[0])!)}</div>
  {/if}
{/snippet}

{#snippet folderNode(folder: TabFolder, depth: number)}
  {@const subfolders = children(folder.id)}
  {@const slots = folderSlots.get(folder.id) ?? []}
  <!-- A collapsed folder hides its subfolders and tabs, except the tabs on screen. -->
  {@const hidden = folder.collapsed ? subtreeSlots(folder.id) : []}
  {@const visibleSlots = folder.collapsed ? hidden.filter((ids) => ids.some((id) => shown.includes(id))) : slots}
  <div class="tab-folder" class:collapsed={folder.collapsed} role="group" aria-label={`Folder: ${folder.name}`} style:--depth={depth}>
    <!-- svelte-ignore a11y_no_static_element_interactions (The folder button below is the keyboard path.) -->
    <div class="folder-header" class:drop-into={marked(`folder-${folder.id}-into`)} class:drop-before={marked(`folder-${folder.id}-before`)} class:drop-after={marked(`folder-${folder.id}-after`)}
      draggable={editing?.id !== folder.id} ondragstart={(event) => startDrag(event, 'folder', folder.id)} ondragend={endDrag}
      ondragover={(event) => overFolder(event, folder)} ondrop={finishDrop}
      oncontextmenu={(event) => { event.preventDefault(); void api?.showFolderMenu(folder.id); }}>
      {#if editing?.kind === 'folder' && editing.id === folder.id}
        <span class="folder-toggle"><span class="folder-icon"><Icon name={folder.collapsed ? 'folder' : 'folderOpen'} size={18} /></span>{@render renameField(folder.name, 'Folder name', { kind: 'folder', id: folder.id })}</span>
      {:else}
        <button id={`folder-${folder.id}`} class="folder-toggle" aria-expanded={!folder.collapsed} title={folder.name}
          onclick={() => api?.toggleFolder(folder.id)} ondblclick={() => startEdit({ kind: 'folder', id: folder.id })}
          onkeydown={(event) => folderKey(event, folder)}>
          <span class="folder-icon"><Icon name={folder.collapsed ? 'folder' : 'folderOpen'} size={18} /></span><span class="folder-name">{folder.name}</span>
          {#if folder.collapsed && hidden.length}<span class="folder-count">{hidden.flat().length}</span>{/if}
        </button>
      {/if}
    </div>
    {#if (!folder.collapsed && (subfolders.length || slots.length)) || visibleSlots.length}
      <!-- svelte-ignore a11y_no_static_element_interactions (Drop target only; rows inside have keyboard paths.) -->
      <div class="folder-tabs" style:--depth={depth + 1} ondragover={(event) => overContents(event, folder)} ondrop={finishDrop}>
        {#if !folder.collapsed}{#each subfolders as child (child.id)}{@render folderNode(child, depth + 1)}{/each}{/if}
        {#each visibleSlots as ids (ids.join())}{@render slot(ids)}{/each}
      </div>
    {:else if !folder.collapsed}
      <span class="drop-hint folder-empty">Drop tabs here</span>
    {/if}
  </div>
{/snippet}

<div class="tabs" class:drag-active={!!drag} role="tablist" aria-label="Browser tabs" aria-orientation={vertical ? 'vertical' : 'horizontal'}>
  {#if browserState.sections.favorites.length || (draggedTab?.url && draggedTab.zone !== 'favorites')}
    <div class="tab-section favorites" class:drop-into={marked('section-favorites')} role="group" aria-label="Favorites"
      ondragover={(event) => overContainer(event, 'favorites', null)} ondrop={finishDrop}>
      {#each browserState.sections.favorites as ids (ids.join())}{@render slot(ids)}{/each}
      {#if !browserState.sections.favorites.length}<span class="drop-hint"><Icon name="star" size={13} /> Drop to add a favorite</span>{/if}
    </div>
  {/if}
  {#if hasPinned || (draggedTab?.url && draggedTab.zone !== 'pinned')}
    <div class="tab-section pinned" class:drop-into={marked('section-pinned')} role="group" aria-label="Pinned tabs"
      ondragover={(event) => overContainer(event, 'pinned', null)} ondrop={finishDrop}>
      {#each children(null) as folder (folder.id)}{@render folderNode(folder, 0)}{/each}
      {#each browserState.sections.pinned as ids (ids.join())}{@render slot(ids)}{/each}
      {#if !hasPinned}<span class="drop-hint"><Icon name="pin" size={13} /> Drop to pin</span>{/if}
    </div>
  {/if}
  {#if browserState.sections.favorites.length || hasPinned}<div class="section-divider" role="separator" aria-label="Today"></div>{/if}
  <div class="tab-section today" class:drop-into={marked('section-today')} role="group" aria-label="Today tabs"
    ondragover={(event) => overContainer(event, 'today', null)} ondrop={finishDrop}>
    {#each browserState.sections.today as ids (ids.join())}{@render slot(ids)}{/each}
  </div>
</div>
