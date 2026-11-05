<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import type { BrowserApi, BrowserState } from '../shared/browser';

  let { state: browserState, api, nextKey, newKey, ondone }: { state: BrowserState; api: BrowserApi | undefined; nextKey: string; newKey: string; ondone: () => void } = $props();
  let editing = $state<number | null>(null);
  let editingSpace = $derived(browserState.spaces.find((space) => space.id === editing));

  async function startEdit(id: number) {
    editing = id;
    await tick();
    const input = document.getElementById('space-name-input') as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }
  function commit(value: string) {
    const id = editing;
    editing = null;
    if (id !== null) void api?.renameSpace(id, value);
    ondone();
  }
  function key(event: KeyboardEvent) {
    if (event.key === 'Enter') { event.preventDefault(); commit((event.currentTarget as HTMLInputElement).value); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); editing = null; ondone(); }
  }
  onMount(() => api?.onEdit((target) => { if (target.kind === 'space') void startEdit(target.id); }));
</script>

<nav class="spaces" aria-label="Spaces">
  {#if editingSpace}
    <span class="space-dot active" data-color={editingSpace.color} aria-hidden="true">{editingSpace.name.slice(0, 1).toUpperCase()}</span>
    <!-- svelte-ignore a11y_autofocus (Rename starts from an explicit user action.) -->
    <input id="space-name-input" class="rename-input space-name-input" aria-label="Space name" value={editingSpace.name} maxlength="120" autocomplete="off" spellcheck="false"
      onkeydown={key} onblur={(event) => { if (editing !== null) commit(event.currentTarget.value); }} />
  {:else}
    {#each browserState.spaces as space (space.id)}
      {@const active = space.id === browserState.activeSpaceId}
      <button class="space-dot" class:active data-color={space.color} aria-label={space.name} aria-current={active ? 'true' : undefined}
        title={active ? `${space.name}${nextKey ? ` · next space ${nextKey}` : ''}` : `Switch to ${space.name}`}
        onclick={() => { if (!active) void api?.switchSpace(space.id); }}
        ondblclick={() => startEdit(space.id)}
        onkeydown={(event) => { if (event.key === 'F2') { event.preventDefault(); void startEdit(space.id); } }}
        oncontextmenu={(event) => { event.preventDefault(); void api?.showSpaceMenu(space.id); }}>{space.name.slice(0, 1).toUpperCase()}</button>
    {/each}
    {#if browserState.spaces.length > 1}<span class="space-name" aria-hidden="true">{browserState.spaces.find((space) => space.id === browserState.activeSpaceId)?.name}</span>{/if}
    <button class="space-add" aria-label="New space" title={newKey ? `New space (${newKey})` : 'New space'} onclick={() => api?.createSpace()}><Icon name="plus" size={13} /></button>
  {/if}
</nav>
