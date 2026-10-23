<script lang="ts">
  import { onMount } from 'svelte'
  import { sessionNavigatorApi } from '../tauri-bridge'
  import { createNavigator, matchesSelection } from './state'
  import SessionEntry from './SessionEntry.svelte'
  import type { SessionSummary } from './contract'
  import type { TranscriptThemeName } from '../rendering/transcript-themes'

  let { selectedPath, selectedThreadId, theme, selecting = false, onSelect }: {
    selectedPath: string
    selectedThreadId: string | null
    theme: TranscriptThemeName
    selecting?: boolean
    onSelect: (item: SessionSummary) => Promise<void>
  } = $props()
  const navigator = createNavigator(sessionNavigatorApi)
  let viewport: HTMLDivElement | undefined = $state()
  let now = $state(Date.now())
  const nextMode = $derived($navigator.mode === 'Flat' ? 'Hierarchical' : 'Flat')
  const snapshotId = $derived($navigator.page?.snapshot_id)
  $effect(() => {
    if (snapshotId && viewport) viewport.scrollTop = 0
  })

  function nearBottom() {
    if (viewport && $navigator.mode === 'Flat' && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 100) {
      void navigator.more()
    }
  }
  // Fill a tall viewport and continue while the sentinel stays visible after a page.
  $effect(() => {
    const state = $navigator
    if (state.mode !== 'Flat' || state.loading || state.loadingMore || state.error || !state.page?.has_more) return
    const frame = requestAnimationFrame(nearBottom)
    return () => cancelAnimationFrame(frame)
  })
  onMount(() => {
    void navigator.reload()
    const timer = setInterval(() => { now = Date.now() }, 60000)
    return () => { clearInterval(timer); navigator.dispose() }
  })
</script>

{#snippet row(item: SessionSummary)}
  <SessionEntry {item} active={matchesSelection(item, selectedPath, selectedThreadId)} {selecting} {now} {onSelect} />
{/snippet}

<section class="session-navigator" data-theme={theme} aria-label="Session Navigator">
  <header class="navigator-header">
    <div class="navigator-heading">
      <h2>Codex</h2>
      <div class="navigator-mode">
        <span class="status" data-navigator-mode={$navigator.mode}>{$navigator.mode}</span>
        <button type="button" class="toolbar-icon-button" aria-label={`Switch to ${nextMode} mode`}
          title={`Switch to ${nextMode} mode`} onclick={() => navigator.toggle()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" />
          </svg>
        </button>
        <button type="button" class="toolbar-icon-button navigator-reload" aria-label="Reload Sessions"
          title="Reload Sessions" disabled={$navigator.loading} onclick={() => navigator.reload()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7" />
          </svg>
        </button>
      </div>
    </div>
    <p class="navigator-count" aria-live="polite">{$navigator.page ? `${$navigator.page.total} sessions` : 'Local sessions'}</p>
  </header>
  <div class="navigator-messages" aria-live="polite">
    {#if $navigator.loading}<p role="status">Loading sessions…</p>{/if}
    {#if $navigator.loadingHierarchy}<p role="status">Loading hierarchy…</p>{/if}
    {#if $navigator.error}
      <div role="alert"><p>{$navigator.error.message}</p>
        {#if $navigator.error.code === 'navigator_snapshot_expired'}<p>The session list has expired. Retry to reload it.</p>{/if}
        <button type="button" class="secondary" onclick={() => navigator.retry()}>Retry Sessions</button>
      </div>
    {/if}
    {#if $navigator.page?.diagnostics.warnings.length}
      <details class="navigator-diagnostics"><summary>Session list warnings</summary>
        {#each $navigator.page.diagnostics.warnings as warning}<p>{warning}</p>{/each}
      </details>
    {/if}
  </div>
  <div class="navigator-list" bind:this={viewport} onscroll={nearBottom} role="region" aria-label="Session list"
    aria-busy={$navigator.loading || $navigator.loadingMore || $navigator.loadingHierarchy}>
    {#if !$navigator.loading && $navigator.page?.total === 0}<p class="navigator-empty">No sessions found.</p>{/if}
    {#if $navigator.mode === 'Flat'}
      {#each $navigator.page?.items ?? [] as item (item.entry_key)}{@render row(item)}{/each}
      {#if $navigator.loadingMore}<p class="navigator-empty" role="status">Loading more sessions…</p>{/if}
    {:else if $navigator.hierarchy}
      {#each [...$navigator.hierarchy.years].sort((a, b) => b.year - a.year) as year (year.year)}
        <details class="navigator-year" open>
          <summary>{year.year}</summary>
          {#each [...year.months].sort((a, b) => b.month - a.month) as month (month.month)}
            <details class="navigator-month" open>
              <summary>{String(month.month).padStart(2, '0')}</summary>
              {#each [...month.days].sort((a, b) => b.day - a.day) as day (day.day)}
                <details class="navigator-day" open>
                  <summary>{String(day.day).padStart(2, '0')}</summary>
                  {#each day.items as item (item.entry_key)}{@render row(item)}{/each}
                </details>
              {/each}
            </details>
          {/each}
        </details>
      {/each}
      {#if $navigator.hierarchy.unfiled_items.length}
        <details class="navigator-unfiled" open><summary>Outside date folders</summary>
          {#each $navigator.hierarchy.unfiled_items as item (item.entry_key)}{@render row(item)}{/each}
        </details>
      {/if}
    {/if}
  </div>
</section>
