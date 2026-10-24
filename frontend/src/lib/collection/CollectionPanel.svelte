<script lang="ts">
  import type { CollectedMessage } from './collection-state'
  import { collectionRoleLabel, serializeCollection } from './collection-state'
  import { formatEntryTimestamp } from '../rendering/entry-timestamp'
  import type { TranscriptThemeName } from '../rendering/transcript-themes'
  import { useStatus } from '../control-room/status-context'
  import PanelScrollActions from '../control-room/PanelScrollActions.svelte'

  interface Props {
    items: readonly CollectedMessage[]
    theme: TranscriptThemeName
    onClear: () => void
  }
  let { items, theme, onClear }: Props = $props()
  const feedback = useStatus()!
  let copying = $state(false)
  let viewport: HTMLDivElement | undefined = $state()

  async function copyAll() {
    const snapshot = items
    if (snapshot.length === 0 || copying) return
    copying = true
    const token = feedback.begin('collection-copy', '', true)
    try {
      if (navigator.clipboard == null) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(serializeCollection(snapshot))
      feedback.finish(token, 'success', items === snapshot ? 'Copied to clipboard.' : '')
    } catch {
      feedback.finish(token, 'error', items === snapshot ? 'Copy failed.' : '')
    } finally {
      copying = false
    }
  }
</script>

<div class="collection-panel" data-theme={theme}>
  <header class="collection-panel-header">
    <h2>Collection <span>({items.length})</span></h2>
    <div class="collection-actions">
      <button type="button" class="toolbar-icon-button panel-icon-button" aria-label="Copy All" title="Copy All" disabled={items.length === 0 || copying} onclick={copyAll}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H4v13h4" /></svg>
      </button>
      <button type="button" class="toolbar-icon-button panel-icon-button" aria-label="Clear Collection" title="Clear Collection" disabled={items.length === 0} onclick={onClear}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>
      </button>
    </div>
  </header>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable content must be keyboard focusable.) -->
  <div class="collection-body panel-scroll" bind:this={viewport} role="region" tabindex="0" aria-label="Collection items">
    {#if items.length === 0}
      <p class="collection-empty">Add messages using the collection button beside each timestamp.</p>
    {:else}
      <ol class="collection-messages">
        {#each items as item (item.id)}
          {@const timestamp = formatEntryTimestamp(item.block.timestamp)}
          <li>
            <article class="collection-message">
              <header>
                <strong>{collectionRoleLabel(item.block)}</strong>
                {#if timestamp !== null}<time class="collection-timestamp" datetime={timestamp.datetime} title={`Original timestamp: ${timestamp.datetime}`}>· {timestamp.label}</time>{/if}
              </header>
              <pre>{item.block.content}</pre>
            </article>
          </li>
        {/each}
      </ol>
    {/if}
  </div>
  <PanelScrollActions {viewport} label="Collection" />
</div>
