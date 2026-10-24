<script lang="ts">
  import type { StatusController } from './status-line'
  let { feedback }: { feedback: StatusController } = $props()
  let anchor: HTMLSpanElement
  let left = $state(0)
  let top = $state(0)
  function position() {
    const box = anchor.getBoundingClientRect()
    left = box.left; top = box.bottom + 4
  }
</script>

<div class="status-line" data-severity={$feedback.severity}>
  <span class="status-line-label">Status</span>
  <div class="status-announcement" role="status" aria-live={$feedback.severity === 'error' ? 'assertive' : 'polite'} aria-atomic="true">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focus reveals the complete status without resizing the workspace.) -->
    <span class="status-line-text" role="note" tabindex="0" bind:this={anchor} onmouseenter={position} onfocus={position}>{$feedback.message}</span>
  </div>
  <span class="status-line-tooltip" aria-hidden="true" style:left={`${left}px`} style:top={`${top}px`}>{$feedback.message}</span>
</div>
