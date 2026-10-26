<script lang="ts">
  import { onMount } from 'svelte'
  import { useStatus } from '../control-room/status-context'
  import { sessionNavigatorApi, resolveNavigatorSession, openNavigatorContainingFolder } from '../tauri-bridge'
  import { createNavigator, matchesSelection } from './state'
  import SessionEntry from './SessionEntry.svelte'
  import type { SessionSummary, NavigatorTarget } from './contract'
  import SessionContextMenu, { type SessionAction } from './SessionContextMenu.svelte'
  import PanelScrollActions from '../control-room/PanelScrollActions.svelte'
  import type { TranscriptThemeName } from '../rendering/transcript-themes'

  let { selectedPath, selectedThreadId, theme, selecting = false, visible = true, onSelect, onExport }: {
    selectedPath: string
    selectedThreadId: string | null
    theme: TranscriptThemeName
    selecting?: boolean
    visible?: boolean
    onSelect: (item: SessionSummary) => Promise<void>
    onExport: (target: NavigatorTarget) => Promise<void>
  } = $props()
  const feedback = useStatus()!
  const navigator = createNavigator(sessionNavigatorApi, feedback, {
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  })
  let viewport: HTMLDivElement | undefined = $state()
  let now = $state(Date.now())
  const nextMode = $derived($navigator.mode === 'Flat' ? 'Hierarchical' : 'Flat')
  const snapshotId = $derived($navigator.page?.snapshot_id)
  let context = $state<{ item: SessionSummary; target: NavigatorTarget; x: number; y: number; anchor: HTMLButtonElement } | null>(null)
  let actionBusy = $state(false)
  const blocked = $derived(selecting || actionBusy || $navigator.loading)
  function closeMenu() {
    const anchor = context?.anchor
    context = null
    if (anchor?.isConnected && anchor.getClientRects().length) anchor.focus({ preventScroll: true })
  }
  function openMenu(item: SessionSummary, x: number, y: number, anchor: HTMLButtonElement) {
    if (blocked || !snapshotId) return
    context = { item, target: { snapshot_id: snapshotId, entry_key: item.entry_key }, x, y, anchor }
  }
  async function action(kind: SessionAction) {
    const current = context
    if (!current || blocked) return
    closeMenu()
    actionBusy = true
    const token = kind === 'export' ? undefined : feedback.begin('navigator-action')
    try {
      if (kind === 'open') {
        const path = await resolveNavigatorSession(current.target)
        await onSelect({ ...current.item, path })
      } else if (kind === 'folder') {
        await openNavigatorContainingFolder(current.target)
      } else await onExport(current.target)
      feedback.finish(token)
    } catch (error) {
      const message = (error as { message?: string })?.message ?? String(error)
      feedback.finish(token, 'error', message + ((error as { code?: string })?.code === 'navigator_snapshot_expired' ? ' Reload Sessions to retry.' : ''))
    } finally { actionBusy = false }
  }
  $effect(() => {
    const current = context
    if (current && (!visible || blocked || current.target.snapshot_id !== snapshotId || $navigator.mode !== contextMode)) closeMenu()
  })
  let contextMode = $state<'Flat' | 'Hierarchical'>('Flat')
  $effect(() => {
    if (snapshotId && viewport) viewport.scrollTop = 0
  })

  function nearBottom() {
    if (viewport && viewport.clientHeight > 0 && $navigator.mode === 'Flat' && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 100) {
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
  <SessionEntry {item} active={matchesSelection(item, selectedPath, selectedThreadId)} selecting={blocked} {now} {onSelect}
    onContext={(item, x, y, anchor) => { contextMode = $navigator.mode; openMenu(item, x, y, anchor) }} />
{/snippet}

<section class="session-navigator" data-theme={theme} aria-label="Session Navigator">
  <header class="navigator-header">
    <div class="navigator-heading">
      <h2 aria-live="polite">Sessions{$navigator.page ? ` (${$navigator.page.total})` : ''}</h2>
      <div class="navigator-mode">
        <button type="button" class="toolbar-icon-button panel-icon-button" aria-label={`Switch to ${nextMode} mode`}
          title={`Switch to ${nextMode} mode`} onclick={() => navigator.toggle()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            {#if $navigator.mode === 'Flat'}
              <path d="M4 6h16M4 12h16M4 18h16" />
            {:else}
              <rect x="3" y="3" width="5" height="5" rx="1" />
              <rect x="15" y="10" width="6" height="4" rx="1" />
              <rect x="15" y="17" width="6" height="4" rx="1" />
              <path d="M5.5 8v11H15M5.5 12H15" />
            {/if}
          </svg>
        </button>
        <button type="button" class="toolbar-icon-button panel-icon-button navigator-reload" aria-label="Reload Sessions"
          title="Reload Sessions" disabled={$navigator.loading || actionBusy}
          onclick={() => { feedback.clear('navigator-action'); void navigator.reload() }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7" />
          </svg>
        </button>
      </div>
    </div>
  </header>
  {#if $navigator.error}
    <div class="navigator-recovery"><button type="button" class="secondary" onclick={() => { feedback.clear('navigator-action'); void navigator.retry() }}>Retry Sessions</button></div>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable content must be keyboard focusable.) -->
  <div class="navigator-list panel-scroll" bind:this={viewport} onscroll={nearBottom} role="region" tabindex="0" aria-label="Session list"
    aria-busy={$navigator.loading || $navigator.loadingMore || $navigator.loadingHierarchy}>
    {#if !$navigator.loading && $navigator.page?.total === 0}<p class="navigator-empty">No sessions found.</p>{/if}
    {#if $navigator.mode === 'Flat'}
      {#each $navigator.page?.items ?? [] as item (item.entry_key)}{@render row(item)}{/each}
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
  <PanelScrollActions viewport={viewport} label="Sessions">
    {#snippet leading()}
      <span class="status" data-navigator-mode={$navigator.mode}>{$navigator.mode}</span>
    {/snippet}
  </PanelScrollActions>
</section>
{#if context}
  {#key context}
    <SessionContextMenu x={context.x} y={context.y} {theme} onClose={closeMenu} onAction={action} />
  {/key}
{/if}
