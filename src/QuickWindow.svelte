<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { QUICK_TOOLBAR_HEIGHT } from '../shared/float-layout.js';
  import type { BrowserState } from '../shared/browser';

  // The toolbar of the quick window. Its page view shows below, from main.cjs.
  const api = window.browser!;
  let browserState = $state<BrowserState | null>(null);
  let address = $state('');
  let error = $state('');
  let editing = false;
  let input: HTMLInputElement;
  const page = $derived(browserState?.mini ?? null);
  const mac = $derived(browserState?.platform === 'darwin');

  function update(next: BrowserState) {
    browserState = next;
    document.documentElement.dataset.theme = next.resolvedTheme;
    if (!editing) address = next.mini?.url ?? '';
  }
  function focusAddress() {
    input.focus();
    input.select();
  }
  onMount(() => {
    const unsubscribe = [api.onState(update), api.onFocusAddress(focusAddress)];
    void api.getState().then((next) => {
      update(next);
      if (!next.mini?.url) focusAddress();
    });
    return () => unsubscribe.forEach((stop) => stop());
  });
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const response = await api.navigateQuickWindow(address);
    error = response.error ?? '';
    if (!error) input.blur();
  }
</script>

<header class="quick-toolbar" class:mac style:height="{QUICK_TOOLBAR_HEIGHT}px">
  <form class="address-bar" class:invalid={!!error} onsubmit={submit}>
    <span class="address-icon"><Icon name={page?.url.startsWith('https:') ? 'shield' : 'search'} size={15} /></span>
    <input bind:this={input} bind:value={address} aria-label="Search or enter address" aria-invalid={!!error} placeholder="Search or enter address" autocomplete="off" spellcheck="false"
      oninput={() => (error = '')} onfocus={() => { editing = true; input.select(); }} onblur={() => { editing = false; if (!error) address = page?.url ?? ''; }} />
    {#if error}<span class="input-error" role="alert" title={error}>{error}</span>{/if}
  </form>
  <button class="quick-open" disabled={!page?.url} title="Move this page into the main window as a tab" onclick={() => api.moveQuickWindowToTab()}><Icon name="expand" size={15} /><span>Open in browser</span></button>
  {#if page?.loading}<div class="loading-bar"></div>{/if}
</header>
<main class="quick-body">
  {#if page?.error}<p class="quick-message" role="alert">{page.error}</p>
  {:else if !page?.url}
    <div class="quick-message"><Icon name="quick" size={28} /><strong>Quick window</strong><span>Look something up without leaving your tabs.</span></div>
  {/if}
</main>
