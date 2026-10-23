<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    transcript: Snippet
    panel: Snippet
    collectionOpen: boolean
  }
  let { transcript, panel, collectionOpen }: Props = $props()
</script>

<!-- A future navigator belongs beside these workspace columns, not inside a
     transcript renderer or the collection's state. -->
<div class="observatory-workspace" class:collection-open={collectionOpen}>
  <div class="workspace-transcript">{@render transcript()}</div>
  <aside id="collection-panel" class="workspace-collection" hidden={!collectionOpen} aria-label="Collection Panel">
    {@render panel()}
  </aside>
</div>
