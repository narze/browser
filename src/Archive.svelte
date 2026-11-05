<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { settingsSchema } from '../shared/settings.js';
  import type { ArchiveEntry, BrowserApi, BrowserSettings } from '../shared/browser';

  let { entries, archiveAfter, api }: { entries: ArchiveEntry[]; archiveAfter: BrowserSettings['archiveAfter']; api: BrowserApi } = $props();
  let heading: HTMLHeadingElement;
  onMount(() => heading.focus());
  let filter = $state('');
  let shown = $derived(entries.filter((entry) => `${entry.title} ${entry.url}`.toLowerCase().includes(filter.trim().toLowerCase())));
  let policy = $derived(settingsSchema.archiveAfter.options.find((option) => option.value === archiveAfter)!);

  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  function ago(time: number) {
    const minutes = Math.round((time - Date.now()) / 60_000);
    if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
    return relative.format(Math.round(hours / 24), 'day');
  }
</script>

<section class="settings-page archive-page" aria-labelledby="archive-title">
  <button class="settings-back" onclick={() => api.closeArchive()}><Icon name="back" size={16} /> Back to browsing</button>
  <h1 id="archive-title" bind:this={heading} tabindex="-1">Archive</h1>
  <p class="settings-intro">
    {policy.ms === null ? 'Tabs you close land here.' : `Tabs you close, and tabs left unused for ${policy.label}, land here.`}
    Favorites and pinned tabs are never archived.
  </p>
  <div class="archive-tools">
    <input class="archive-filter" type="search" bind:value={filter} aria-label="Filter archive" placeholder="Filter archived tabs" autocomplete="off" spellcheck="false" />
    <button class="archive-clear" disabled={!entries.length} onclick={() => api.clearArchive()}>Clear archive</button>
  </div>
  {#if shown.length}
    <ul class="archive-list" aria-label="Archived tabs">
      {#each shown as entry (entry.id)}
        <li class="archive-entry">
          <span class="tab-icon"><Icon name="globe" size={16} /></span>
          <span class="archive-copy"><strong>{entry.title}</strong><small>{entry.url}</small></span>
          <span class="archive-meta">{entry.reason === 'auto' ? 'Auto-archived' : 'Closed'} {ago(entry.archivedAt)}</span>
          <button class="archive-action" aria-label={`Restore ${entry.title}`} title="Open in a new tab" onclick={() => api.restoreArchived(entry.id)}><Icon name="reload" size={14} /> Restore</button>
          <button class="icon-button" aria-label={`Remove ${entry.title} from archive`} title="Remove" onclick={() => api.removeArchived(entry.id)}><Icon name="close" size={14} /></button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="archive-empty">{entries.length ? 'No archived tabs match your filter.' : 'Nothing here yet. Closed tabs will appear here.'}</p>
  {/if}
</section>
