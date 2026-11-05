<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import ShortcutSettings from './ShortcutSettings.svelte';
  import { settingsSchema } from '../shared/settings.js';
  import type { BrowserApi, BrowserSettings, SiteRoute, Space } from '../shared/browser';

  let { settings, platform, api, spaces, routes, activeSpaceId, onclose, onsave }: {
    settings: BrowserSettings;
    spaces: Space[];
    routes: SiteRoute[];
    activeSpaceId: number;
    platform: string;
    api: BrowserApi;
    onclose: () => void;
    onsave: (patch: Partial<BrowserSettings>) => Promise<{ error?: string }>;
  } = $props();
  let busy = $state(false);
  let message = $state('Changes save automatically.');
  let error = $state('');
  let heading: HTMLHeadingElement;
  onMount(() => heading.focus());
  let routeHost = $state('');
  // svelte-ignore state_referenced_locally (The form starts with the active space and then keeps the choice.)
  let routeSpace = $state(activeSpaceId);
  let routeError = $state('');
  const spaceName = (id: number) => spaces.find((space) => space.id === id)?.name ?? '';

  async function addRoute(event: SubmitEvent) {
    event.preventDefault();
    const result = await api.addRoute(routeHost, routeSpace);
    routeError = result.error || '';
    if (!routeError) routeHost = '';
  }

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
    <div class="preference-row">
      <label for="compact-mode"><strong>{settingsSchema.compactMode.label}</strong><span>Hide the toolbar and tabs until you point at the window edge.</span></label>
      <input id="compact-mode" class="settings-toggle" type="checkbox" checked={settings.compactMode} disabled={busy}
        onchange={(event) => save({ compactMode: event.currentTarget.checked })} />
    </div>
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
  <section class="settings-section" aria-labelledby="tabs-title">
    <h2 id="tabs-title">Tabs</h2>
    <div class="preference-row">
      <label for="archive-after"><strong>{settingsSchema.archiveAfter.label}</strong><span>Unused tabs move to the archive. Favorites and pinned tabs stay.</span></label>
      <select id="archive-after" value={settings.archiveAfter} disabled={busy}
        onchange={(event) => save({ archiveAfter: event.currentTarget.value as BrowserSettings['archiveAfter'] })}>
        {#each settingsSchema.archiveAfter.options as option}<option value={option.value}>{option.label}</option>{/each}
      </select>
    </div>
    <div class="preference-row">
      <label for="sleep-after"><strong>{settingsSchema.sleepAfter.label}</strong><span>Sleeping tabs free memory and reload when you open them.</span></label>
      <select id="sleep-after" value={settings.sleepAfter} disabled={busy}
        onchange={(event) => save({ sleepAfter: event.currentTarget.value as BrowserSettings['sleepAfter'] })}>
        {#each settingsSchema.sleepAfter.options as option}<option value={option.value}>{option.label}</option>{/each}
      </select>
    </div>
  </section>
  <section class="settings-section" aria-labelledby="routing-title">
    <h2 id="routing-title">Link routing</h2>
    <p class="routing-intro">Links to these sites open in a new tab in their space, with that space’s logins. Subdomains are included.</p>
    {#if routes.length}
      <ul class="route-list" aria-label="Link routes">
        {#each routes as route (route.id)}
          <li class="route-row">
            <strong>{route.host}</strong><Icon name="arrow" size={14} /><span>{spaceName(route.spaceId)}</span>
            <button class="icon-button route-remove" aria-label={`Remove route for ${route.host}`} title="Remove" onclick={() => api.removeRoute(route.id)}><Icon name="close" size={14} /></button>
          </li>
        {/each}
      </ul>
    {/if}
    <form class="route-form" onsubmit={addRoute}>
      <input aria-label="Site" placeholder="github.com" bind:value={routeHost} autocomplete="off" spellcheck="false" aria-invalid={!!routeError} />
      <select aria-label="Space for this site" bind:value={routeSpace}>
        {#each spaces as space (space.id)}<option value={space.id}>{space.name}</option>{/each}
      </select>
      <button class="route-add" disabled={!routeHost.trim()}>Add route</button>
    </form>
    {#if routeError}<p class="settings-error" role="alert">{routeError}</p>{/if}
  </section>
  <ShortcutSettings overrides={settings.shortcuts} {platform} {api} {busy} onsave={save} />
  <p class="settings-status" role="status">{message}</p>
  {#if error}<p class="settings-error" role="alert">{error}</p>{/if}
  <p class="settings-footnote">Your preferences stay on this device.</p>
</section>
