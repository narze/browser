<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { settingsSchema } from '../shared/settings.js';
  import type { BrowserSettings } from '../shared/browser';

  let { settings, onclose, onsave }: {
    settings: BrowserSettings;
    onclose: () => void;
    onsave: (patch: Partial<BrowserSettings>) => Promise<{ error?: string }>;
  } = $props();
  let busy = $state(false);
  let message = $state('Changes save automatically.');
  let error = $state('');
  let heading: HTMLHeadingElement;
  onMount(() => heading.focus());

  async function save(patch: Partial<BrowserSettings>) {
    busy = true;
    error = '';
    message = 'Saving…';
    try {
      const result = await onsave(patch);
      error = result.error || '';
      message = error ? '' : 'Saved.';
    } catch {
      error = 'Could not save your settings. Please try again.';
      message = '';
    } finally {
      busy = false;
    }
  }
</script>

<section class="settings-page" aria-labelledby="settings-title">
  <button class="settings-back" onclick={onclose}><Icon name="back" size={16} /> Back to browsing</button>
  <h1 id="settings-title" bind:this={heading} tabindex="-1">Settings</h1>
  <p class="settings-intro">Make yourself at home.</p>

  <section class="settings-section" aria-labelledby="appearance-title">
    <h2 id="appearance-title">Appearance</h2>
    <div class="preference-row theme-preference">
      <label for="theme"><strong id="theme-label">{settingsSchema.theme.label}</strong><span id="theme-description">Choose your look, or follow your system appearance.</span></label>
      <select id="theme" aria-labelledby="theme-label" aria-describedby="theme-description" value={settings.theme} disabled={busy}
        onchange={(event) => save({ theme: event.currentTarget.value as BrowserSettings['theme'] })}>
        {#each settingsSchema.theme.options as option}<option value={option.value}>{option.label}</option>{/each}
      </select>
    </div>
    <fieldset class="layout-options" disabled={busy}>
      <legend>{settingsSchema.tabLayout.label}</legend>
      <p>Keep tabs across the top or give them a side of their own.</p>
      <div class="layout-choices">
        {#each settingsSchema.tabLayout.options as { value: placement, label }}
          <label class="layout-choice" class:selected={settings.tabLayout === placement}>
            <input type="radio" name="settings-layout" value={placement} checked={settings.tabLayout === placement}
              onchange={() => save({ tabLayout: placement as BrowserSettings['tabLayout'] })} />
            <span class="layout-preview" class:preview-left={placement === 'left'} class:preview-right={placement === 'right'}><span></span></span>
            <span>{label}</span>
          </label>
        {/each}
      </div>
    </fieldset>
  </section>

  <section class="settings-section" aria-labelledby="browsing-title">
    <h2 id="browsing-title">Browsing</h2>
    <div class="preference-row">
      <label for="search-engine"><strong>{settingsSchema.searchEngine.label}</strong><span>Used when you type a search in either address field.</span></label>
      <select id="search-engine" value={settings.searchEngine} disabled={busy}
        onchange={(event) => save({ searchEngine: event.currentTarget.value as BrowserSettings['searchEngine'] })}>
        {#each settingsSchema.searchEngine.options as option}<option value={option.value}>{option.label}</option>{/each}
      </select>
    </div>
    <div class="preference-row">
      <label for="show-shortcuts"><strong>{settingsSchema.showShortcuts.label}</strong><span>Show quick links on the new-tab page.</span></label>
      <input id="show-shortcuts" class="settings-toggle" type="checkbox" checked={settings.showShortcuts} disabled={busy}
        onchange={(event) => save({ showShortcuts: event.currentTarget.checked })} />
    </div>
  </section>
  <p class="settings-status" role="status">{message}</p>
  {#if error}<p class="settings-error" role="alert">{error}</p>{/if}
  <p class="settings-footnote">Your preferences stay on this device.</p>
</section>
