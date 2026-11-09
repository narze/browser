<script lang="ts">
  import type { BrowserApi, BrowserExtension, Space } from '../shared/browser';

  let { api, spaces, activeSpaceId }: { api: BrowserApi; spaces: Space[]; activeSpaceId: number } = $props();
  // svelte-ignore state_referenced_locally (Start with the current space; keep the user's selection.)
  let spaceId = $state(activeSpaceId);
  let installed = $state<BrowserExtension[]>([]);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  $effect(() => {
    const target = spaceId;
    let current = true;
    loading = true;
    error = '';
    api.getExtensions(target).then((result) => {
      if (current) installed = result;
    }).catch(() => {
      if (current) error = 'Could not read extensions for this space.';
    }).finally(() => { if (current) loading = false; });
    return () => { current = false; };
  });

  async function run(operation: () => Promise<{ error?: string }>) {
    const target = spaceId;
    busy = true;
    error = '';
    try {
      const result = await operation();
      error = result.error ?? '';
      installed = await api.getExtensions(target);
    } catch {
      error = 'Could not update extensions. Please try again.';
    } finally { busy = false; }
  }

  async function browseStore() {
    await run(async () => {
      await api.switchSpace(spaceId);
      await api.newTab();
      const result = await api.navigate('https://chromewebstore.google.com/');
      if (!result.error) await api.closeSettings();
      return result;
    });
  }
</script>

<section class="settings-section" aria-labelledby="extensions-title" aria-busy={busy || loading}>
  <h2 id="extensions-title">Extensions</h2>
  <p class="extension-intro">Install from Chrome Web Store or load an unpacked folder containing <code>manifest.json</code>. Extensions and their data stay in the space you choose.</p>
  <p class="extension-intro">Only load extensions you trust. They can read and change the sites their permissions allow.</p>
  <div class="extension-controls">
    <label for="extension-space">Space</label>
    <select id="extension-space" bind:value={spaceId} disabled={busy}>
      {#each spaces as space (space.id)}<option value={space.id}>{space.name}</option>{/each}
    </select>
    <button class="route-add" disabled={busy || loading} onclick={browseStore}>Chrome Web Store</button>
    <button class="route-add" disabled={busy || loading} onclick={() => run(() => api.loadExtension(spaceId))}>Load unpacked</button>
  </div>
  {#if loading}
    <p class="extension-intro">Loading extensions…</p>
  {:else if !installed.length}
    <p class="extension-intro">No extensions in this space.</p>
  {:else}
    <ul class="extension-list" aria-label="Installed extensions">
      {#each installed as extension (extension.id)}
        <li class="extension-row">
          <div class="extension-heading">
            <div><strong>{extension.name}</strong><span class="extension-version">{extension.version}</span></div>
            <label class="extension-enabled">
              <input class="settings-toggle" type="checkbox" aria-label={`Enable ${extension.name}`} checked={extension.enabled} disabled={busy}
                onchange={(event) => run(() => api.setExtensionEnabled(spaceId, extension.id, event.currentTarget.checked))} />
              {extension.enabled ? 'Enabled' : 'Disabled'}
            </label>
          </div>
          <p class="extension-path" title={extension.path}>{extension.path}</p>
          {#if extension.error}<p class="settings-error">Could not load: {extension.error}</p>{/if}
          <div class="extension-actions">
            {#if extension.hasPopup}<button disabled={busy} onclick={() => run(() => api.openExtensionPage(spaceId, extension.id, 'popup'))}>Open popup</button>{/if}
            {#if extension.hasOptions}<button disabled={busy} onclick={() => run(() => api.openExtensionPage(spaceId, extension.id, 'options'))}>Options</button>{/if}
            <button disabled={busy || !extension.enabled} onclick={() => run(() => api.reloadExtension(spaceId, extension.id))}>Reload</button>
            <button disabled={busy} onclick={() => run(() => api.removeExtension(spaceId, extension.id))}>Remove</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
  {#if error}<p class="settings-error" role="alert">{error}</p>{/if}
  <p class="extension-intro">Supports Electron-compatible Manifest V3 store extensions. Some Chrome APIs are unavailable. Themes, Chrome apps, local .crx files, automatic updates, and Chrome account sync are not supported. Keep unpacked folders on disk; reload pages after changing an extension.</p>
</section>

<style>
  .extension-intro { color: var(--muted); font-size: 12px; line-height: 1.6; margin: 12px 0; }
  .extension-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin: 18px 0; font-size: 12px; }
  .extension-controls select { min-width: 120px; max-width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--text); font: inherit; }
  .extension-controls .route-add { min-height: 34px; }
  .extension-list { list-style: none; padding: 0; margin: 16px 0; }
  .extension-row { border-top: 1px solid var(--border); padding: 16px 0; min-width: 0; }
  .extension-heading { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; font-size: 13px; }
  .extension-heading strong { overflow-wrap: anywhere; }
  .extension-version { color: var(--muted); font-size: 11px; margin-left: 8px; }
  .extension-enabled { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 12px; }
  .extension-path { color: var(--muted); font-size: 11px; overflow-wrap: anywhere; margin: 8px 0 12px; }
  .extension-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .extension-actions button { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); font: inherit; font-size: 12px; }
  .extension-actions button:hover { background: var(--hover); }
  button:disabled { opacity: .45; }
  button:focus-visible, select:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
