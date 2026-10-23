<script lang="ts">
  import type { CollectedMessage } from './collection-state'
  import { collectionRoleLabel, serializeCollection } from './collection-state'
  import { formatEntryTimestamp } from '../rendering/entry-timestamp'
  import type { TranscriptThemeName } from '../rendering/transcript-themes'

  interface Props {
    items: readonly CollectedMessage[]
    theme: TranscriptThemeName
    onClear: () => void
  }
  let { items, theme, onClear }: Props = $props()
  let copyStatus = $state('')
  let copying = $state(false)
  $effect(() => { items; copyStatus = '' })

  async function copyAll() {
    const snapshot = items
    if (snapshot.length === 0 || copying) return
    copying = true
    try {
      if (navigator.clipboard == null) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(serializeCollection(snapshot))
      if (items === snapshot) copyStatus = 'Copied.'
    } catch {
      if (items === snapshot) copyStatus = 'Copy failed.'
    } finally {
      copying = false
    }
  }
</script>

<div class="collection-panel" data-theme={theme}>
  <header class="collection-panel-header">
    <h2>Collection <span>({items.length})</span></h2>
    <div class="collection-actions">
      <button type="button" class="compact-action-button" disabled={items.length === 0 || copying} onclick={copyAll}>Copy All</button>
      <button type="button" class="secondary compact-action-button" disabled={items.length === 0} onclick={onClear}>Clear</button>
    </div>
    <p role="status" class="collection-copy-status">{copyStatus}</p>
  </header>
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
