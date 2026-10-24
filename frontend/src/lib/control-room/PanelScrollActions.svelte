<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { Snippet } from 'svelte'
  import { cancelPanelScroll, scrollPanel } from './panel-scroll'
  let { viewport, label, disabled = false, leading }: { viewport: HTMLElement | undefined; label: string; disabled?: boolean; leading?: Snippet } = $props()
  onDestroy(() => cancelPanelScroll(viewport))
</script>

<footer class="panel-scroll-actions" aria-label={`${label} scroll actions`}>
  {#if leading}<div class="panel-scroll-leading">{@render leading()}</div>{/if}
  <button type="button" class="toolbar-icon-button panel-icon-button" {disabled} aria-label={`Scroll ${label} to Top`} title={`Scroll ${label} to Top`} onclick={() => scrollPanel(viewport, 'top')}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16M12 21V9m-5 5 5-5 5 5" /></svg>
  </button>
  <button type="button" class="toolbar-icon-button panel-icon-button" {disabled} aria-label={`Scroll ${label} to Bottom`} title={`Scroll ${label} to Bottom`} onclick={() => scrollPanel(viewport, 'bottom')}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 20h16" /></svg>
  </button>
</footer>
