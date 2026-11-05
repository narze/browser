<script lang="ts">
  import Icon from './Icon.svelte';
  import {
    shortcutActions,
    acceleratorFromKey,
    formatAccelerator,
    normalizeAccelerator,
    resolveShortcuts,
    shortcutConflict,
  } from '../shared/shortcuts.js';
  import type { BrowserApi, BrowserSettings } from '../shared/browser';

  let { overrides, platform, api, busy, onsave }: {
    overrides: Record<string, string>;
    platform: string;
    api: BrowserApi;
    busy: boolean;
    onsave: (patch: Partial<BrowserSettings>) => Promise<unknown>;
  } = $props();

  let query = $state('');
  let recording = $state<string | null>(null);
  let error = $state('');
  let keys = $derived(resolveShortcuts(overrides));
  const display = (id: string) => formatAccelerator(keys[id] ?? '', platform);
  let matches = $derived.by(() => {
    const term = query.trim().toLowerCase();
    if (!term) return shortcutActions;
    return shortcutActions.filter((action) =>
      action.label.toLowerCase().includes(term) ||
      display(action.id).toLowerCase().includes(term) ||
      (normalizeAccelerator(keys[action.id] ?? '', platform) ?? '').toLowerCase().includes(term));
  });
  let groups = $derived([
    { id: 'customized', title: 'Customized shortcuts', actions: matches.filter((action) => Object.hasOwn(overrides, action.id)) },
    { id: 'default', title: 'Default shortcuts', actions: matches.filter((action) => !Object.hasOwn(overrides, action.id)) },
  ].filter((group) => group.actions.length));
  const labelOf = (id: string) => shortcutActions.find((action) => action.id === id)?.label ?? id;

  async function startRecording(id: string) {
    error = '';
    await api.setShortcutRecording(true);
    recording = id;
  }
  async function stopRecording() {
    if (!recording) return;
    recording = null;
    await api.setShortcutRecording(false);
  }

  async function assign(id: string, accelerator: string) {
    const next = { ...overrides };
    const action = shortcutActions.find((entry) => entry.id === id)!;
    const isDefault = accelerator
      ? normalizeAccelerator(action.default, platform) === accelerator
      : !action.default;
    if (isDefault) delete next[id];
    else next[id] = accelerator;
    const conflict = shortcutConflict(next, platform);
    if (conflict) {
      const other = conflict.ids.find((entry) => entry !== id) ?? conflict.ids[0];
      error = `${formatAccelerator(conflict.accelerator, platform)} is already used by “${labelOf(other)}”.`;
      return;
    }
    error = '';
    await onsave({ shortcuts: next });
  }

  async function recordKey(event: KeyboardEvent, id: string) {
    if (recording !== id) return;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    // Tab keeps moving focus, so keyboard users can always leave the field.
    if (plain && event.key === 'Tab') { await stopRecording(); return; }
    event.preventDefault();
    event.stopPropagation();
    if (plain && event.key === 'Escape') { await stopRecording(); return; }
    if (plain && (event.key === 'Backspace' || event.key === 'Delete')) {
      await stopRecording();
      await assign(id, '');
      return;
    }
    const accelerator = acceleratorFromKey(
      { key: event.key, code: event.code, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey },
      platform,
    );
    if (!accelerator) return; // A modifier alone: wait for the rest of the shortcut.
    if (plain && !/^F\d+$/.test(accelerator)) {
      error = `Include ${platform === 'darwin' ? '⌘, ⌃, or ⌥' : 'Ctrl or Alt'} in the shortcut.`;
      return;
    }
    await stopRecording();
    await assign(id, accelerator);
  }

  async function reset(id: string) {
    const next = { ...overrides };
    delete next[id];
    const conflict = shortcutConflict(next, platform);
    if (conflict) {
      const other = conflict.ids.find((entry) => entry !== id) ?? conflict.ids[0];
      error = `The default ${formatAccelerator(conflict.accelerator, platform)} is used by “${labelOf(other)}”. Change that shortcut first.`;
      return;
    }
    error = '';
    await onsave({ shortcuts: next });
  }

  async function resetAll() {
    error = '';
    await onsave({ shortcuts: {} });
  }
</script>

<section class="settings-section shortcut-settings" aria-labelledby="shortcuts-title">
  <div class="shortcut-heading">
    <h2 id="shortcuts-title">Keyboard shortcuts</h2>
    <button class="shortcut-reset-all" disabled={busy || !Object.keys(overrides).length} onclick={resetAll}>Reset all shortcuts</button>
  </div>
  <p class="shortcut-intro">Click a shortcut, then press the new keys. Press Delete to remove it or Escape to cancel.</p>
  <label class="shortcut-search">
    <Icon name="search" size={15} />
    <input type="search" bind:value={query} aria-label="Search shortcuts" placeholder="Type a feature name or shortcut (like “Command” or “⌘T”)" autocomplete="off" spellcheck="false" />
  </label>
  {#if error}<p class="settings-error" role="alert">{error}</p>{/if}
  {#each groups as group (group.id)}
    <h3 class="shortcut-group-title" id="shortcut-group-{group.id}">{group.title}</h3>
    <ul class="shortcut-list" aria-labelledby="shortcut-group-{group.id}">
      {#each group.actions as action (action.id)}
        <li class="shortcut-row">
          <span class="shortcut-label" id="shortcut-label-{action.id}">{action.label}</span>
          {#if Object.hasOwn(overrides, action.id)}
            <button class="shortcut-reset" aria-label="Reset {action.label} shortcut" title="Reset to {formatAccelerator(action.default, platform) || 'none'}" disabled={busy} onclick={() => reset(action.id)}><Icon name="reload" size={13} /></button>
          {/if}
          <button class="shortcut-key" class:recording={recording === action.id} class:empty={!display(action.id)}
            id="shortcut-key-{action.id}" aria-labelledby="shortcut-label-{action.id} shortcut-key-{action.id}" aria-pressed={recording === action.id} disabled={busy}
            onclick={() => recording === action.id ? stopRecording() : startRecording(action.id)}
            onkeydown={(event) => recordKey(event, action.id)} onblur={() => { if (recording === action.id) void stopRecording(); }}>
            {recording === action.id ? 'Type shortcut…' : display(action.id) || 'None'}
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="shortcut-empty">No shortcuts match “{query}”.</p>
  {/each}
</section>
