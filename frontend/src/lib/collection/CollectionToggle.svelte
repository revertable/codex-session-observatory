<script lang="ts">
  interface Props {
    selected: boolean
    onToggle: () => void
  }
  let { selected, onToggle }: Props = $props()
</script>

<button
  type="button"
  class="collection-toggle"
  class:collected={selected}
  aria-pressed={selected}
  aria-label={selected ? 'Remove from Collection' : 'Add to Collection'}
  title={selected ? 'Remove from Collection' : 'Add to Collection'}
  onclick={onToggle}
>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if selected}
      <path d="m5 12 4 4L19 6" />
    {:else}
      <path d="M5 12h14M12 5v14" />
    {/if}
  </svg>
</button>
