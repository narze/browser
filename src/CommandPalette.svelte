<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { paletteResults, type PaletteResult } from './palette';
  import type { BrowserState } from '../shared/browser';

  const api = window.browser!;
  let browserState = $state<BrowserState | null>(null);
  let query = $state('');
  let selected = $state(0);
  let busy = $state(false);
  let error = $state('');
  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;
  let requestId = 0;
  let results = $derived(browserState ? paletteResults(query, browserState) : []);
  let selection = $derived(Math.min(selected, Math.max(0, results.length - 1)));
  const mac = $derived(browserState?.platform === 'darwin');
  const opensNewTab = (event: KeyboardEvent | MouseEvent) => event.shiftKey || event.metaKey || event.ctrlKey;

  async function update(next: BrowserState) {
    browserState = next;
    document.documentElement.dataset.theme = next.resolvedTheme;
    if (!next.palette) { dialog?.close(); return; }
    if (next.palette.requestId !== requestId) {
      requestId = next.palette.requestId;
      query = next.palette.query;
      selected = 0;
      error = '';
      busy = false;
      await tick();
      if (!browserState?.palette) return;
      if (!dialog.open) dialog.showModal();
      input.focus();
      input.select();
    }
  }
  onMount(() => {
    const unsubscribe = api.onState((next) => void update(next));
    void api.getState().then(update);
    return unsubscribe;
  });
  async function execute(result: PaletteResult | undefined, newTab = false) {
    if (!result || busy) return;
    busy = true;
    error = '';
    try {
      const action = result.action.type === 'navigate' ? { ...result.action, newTab } : result.action;
      const response = await api.executePalette(action);
      error = response.error || '';
    } catch { error = 'Could not run this command. Please try again.'; }
    finally { busy = false; if (error) input.focus(); }
  }
  async function keydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); await api.closePalette(); }
    else if (event.key === 'Tab') { event.preventDefault(); input.focus(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!results.length) return;
      selected = (selection + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      await tick();
      document.getElementById(`result-${results[selected]?.id}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      await execute(results[selection], opensNewTab(event));
    }
  }
</script>

<dialog class="command-palette" aria-label="Command palette" bind:this={dialog} onkeydown={keydown}
  oncancel={(event) => { event.preventDefault(); void api.closePalette(); }}
  onclick={(event) => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) void api.closePalette(); } }}>
  <div class="palette-input-row">
    <Icon name={query.startsWith('>') ? 'command' : 'search'} size={23} />
    <input bind:this={input} bind:value={query} oninput={() => { selected = 0; error = ''; }}
      role="combobox" aria-label="Search or enter a command" aria-controls="palette-results" aria-expanded="true" aria-autocomplete="list"
      aria-activedescendant={results[selection] ? `result-${results[selection].id}` : undefined}
      placeholder="Search tabs, enter a URL, or type > for commands" autocomplete="off" spellcheck="false" maxlength="16384" />
    <kbd>esc</kbd>
  </div>
  {#if error}<p class="palette-error" role="alert">{error}</p>{/if}
  <div class="palette-results" id="palette-results" role="listbox" aria-label="Suggestions" aria-busy={busy}>
    {#each results as result, index (result.id)}
      <button type="button" id={`result-${result.id}`} class="palette-result" class:highlighted={selection === index}
        role="option" aria-selected={selection === index} tabindex="-1" disabled={busy}
        onpointermove={() => selected = index} onmousedown={(event) => event.preventDefault()}
        onclick={(event) => execute(result, opensNewTab(event))}>
        <span class="palette-result-icon"><Icon name={result.icon} size={19} /></span>
        <span class="palette-result-copy"><strong>{result.title}</strong><small>{result.detail}</small></span>
        <span class="palette-result-hint">{result.hint}</span>
      </button>
    {/each}
  </div>
  {#if !results.length}<p class="palette-empty">{query.trim().startsWith('>') ? 'No matching commands.' : 'Search for a page or type > to browse commands.'}</p>{/if}
  <footer class="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Select</span><span><kbd>{mac ? '⌘' : 'Ctrl'} ↵</kbd> Open in new tab</span><span class="palette-footer-tip">Type <kbd>></kbd> for commands</span></footer>
</dialog>
