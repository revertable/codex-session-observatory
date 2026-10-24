<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { TranscriptThemeName } from '../rendering/transcript-themes'
  import PanelSeparator from './PanelSeparator.svelte'
  import { fitWorkspace, initialWidths, panelLimits, type Side } from './workspace-widths'

  interface Props {
    transcript: Snippet
    panel: Snippet
    collectionOpen: boolean
    theme: TranscriptThemeName
    navigator?: Snippet
    sessionsOpen?: boolean
  }
  let { transcript, panel, collectionOpen, theme, navigator, sessionsOpen = true }: Props = $props()
  let width = $state(0)
  let desired = $state({ ...initialWidths })
  const leftOpen = $derived(!!navigator && sessionsOpen)
  const fitted = $derived(fitWorkspace(width, desired, leftOpen, collectionOpen))
  const tracks = $derived([
    ...(leftOpen ? [`${fitted.sessions}px`, '8px'] : []),
    'minmax(0, 1fr)',
    ...(collectionOpen ? ['8px', `${fitted.collection}px`] : []),
  ].join(' '))
  function resize(side: Side, value: number) { desired = { ...desired, [side]: value } }

</script>

<div class="observatory-workspace" data-theme={theme} bind:clientWidth={width} style:grid-template-columns={tracks}>
  {#if navigator}<aside id="sessions-panel" class="workspace-navigator" data-theme={theme} hidden={!sessionsOpen} aria-label="Sessions Panel">{@render navigator()}</aside>{/if}
  {#if leftOpen}
    <PanelSeparator label="Resize Sessions" controls="sessions-panel" value={fitted.sessions}
      minimum={panelLimits.sessions} maximum={Math.max(panelLimits.sessions, fitted.sessions + fitted.transcript - panelLimits.transcript)}
      direction={1} onResize={(value) => resize('sessions', value)} />
  {/if}
  <div class="workspace-transcript" data-theme={theme}>{@render transcript()}</div>
  {#if collectionOpen}
    <PanelSeparator label="Resize Collection" controls="collection-panel" value={fitted.collection}
      minimum={panelLimits.collection} maximum={Math.max(panelLimits.collection, fitted.collection + fitted.transcript - panelLimits.transcript)}
      direction={-1} onResize={(value) => resize('collection', value)} />
  {/if}
  <aside id="collection-panel" class="workspace-collection" data-theme={theme} hidden={!collectionOpen} aria-label="Collection Panel">
    {@render panel()}
  </aside>
</div>
