<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    transcript: Snippet
    panel: Snippet
    collectionOpen: boolean
    navigator?: Snippet
  }
  let { transcript, panel, collectionOpen, navigator }: Props = $props()
</script>

<div class="observatory-workspace" class:collection-open={collectionOpen} class:has-navigator={!!navigator}>
  {#if navigator}<aside class="workspace-navigator">{@render navigator()}</aside>{/if}
  <div class="workspace-transcript">{@render transcript()}</div>
  <aside id="collection-panel" class="workspace-collection" hidden={!collectionOpen} aria-label="Collection Panel">
    {@render panel()}
  </aside>
</div>
