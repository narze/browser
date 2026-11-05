<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { peekLayout, PEEK_HEADER_HEIGHT } from '../shared/float-layout.js';
  import type { BrowserState } from '../shared/browser';

  // The frame of a peek: a backdrop over the pages and a card around the peeked page.
  // The native page view shows inside the card, at the same rect as main.cjs uses.
  const api = window.browser!;
  let browserState = $state<BrowserState | null>(null);
  let size = $state({ width: window.innerWidth, height: window.innerHeight });
  let brokenIcon = $state('');
  const card = $derived(peekLayout(size.width, size.height).card);
  const peek = $derived(browserState?.peek ?? null);
  const host = $derived(peek?.url ? new URL(peek.url).hostname.replace(/^www\./, '') : '');

  function update(next: BrowserState) {
    browserState = next;
    document.documentElement.dataset.theme = next.resolvedTheme;
  }
  onMount(() => {
    const unsubscribe = api.onState(update);
    void api.getState().then(update);
    const resize = () => (size = { width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => { unsubscribe(); window.removeEventListener('resize', resize); };
  });
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape' && peek) { event.preventDefault(); void api.closePeek(); } }} />

{#if peek}
  <!-- A click outside the card closes the peek; Escape does the same from the keyboard. -->
  <div class="peek-backdrop" role="presentation" onclick={() => api.closePeek()}></div>
  <section class="peek-card" aria-label="Peek" style:left="{card.x}px" style:top="{card.y}px" style:width="{card.width}px" style:height="{card.height}px">
    <header class="peek-header" style:height="{PEEK_HEADER_HEIGHT}px">
      {#if peek.loading}<span class="spinner" aria-label="Loading"></span>
      {:else if peek.favicon && brokenIcon !== peek.favicon}<img class="favicon" src={`favicon://icon/${peek.favicon}`} alt="" width="16" height="16" onerror={() => (brokenIcon = peek.favicon!)} />
      {:else}<span class="peek-globe"><Icon name="globe" size={15} /></span>{/if}
      <span class="peek-title"><strong>{peek.title}</strong><small>{host}</small></span>
      <button class="icon-button" aria-label="Open as tab" title="Open as tab" onclick={() => api.expandPeek()}><Icon name="expand" size={16} /></button>
      <button class="icon-button" aria-label="Close peek" title="Close (Esc)" onclick={() => api.closePeek()}><Icon name="close" size={16} /></button>
    </header>
    {#if peek.error}<p class="peek-error" role="alert">{peek.error}</p>{/if}
  </section>
{/if}
