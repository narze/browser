<script lang="ts">
  import Icon from './Icon.svelte';
  import type { BrowserApi, BrowserTab, TabMedia } from '../shared/browser';

  let { entry, tab, api }: { entry: TabMedia; tab: BrowserTab; api: BrowserApi } = $props();
  let label = $derived(tab.customTitle || tab.title);
  let playing = $derived(entry.playback === 'playing');
  let brokenIcon = $state(false);
</script>

<section class="media-card" aria-label="Media">
  <button class="media-tab" title={`Show ${label}`} onclick={() => api.selectTab(tab.id)}>
    {#if tab.favicon && !brokenIcon}<img class="favicon" src={`favicon://icon/${tab.favicon}`} alt="" width="16" height="16" draggable="false" onerror={() => (brokenIcon = true)} />
    {:else}<span class="tab-icon"><Icon name="volume" size={14} /></span>{/if}
    <span class="media-text"><span class="media-title">{label}</span><small>{playing ? 'Playing' : 'Paused'}</small></span>
  </button>
  <button class="icon-button media-button" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'} onclick={() => api.toggleMediaPlayback(tab.id)}><Icon name={playing ? 'pause' : 'play'} size={15} /></button>
  <button class="icon-button media-button" aria-label="Mute" aria-pressed={entry.muted} title={entry.muted ? 'Unmute tab' : 'Mute tab'} onclick={() => api.toggleMute(tab.id)}><Icon name={entry.muted ? 'muted' : 'volume'} size={15} /></button>
</section>
