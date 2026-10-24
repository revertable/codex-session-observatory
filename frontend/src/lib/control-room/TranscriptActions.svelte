<script lang="ts">
  import type { LoadStatus } from '../load-workflow'

  interface Props {
    status: LoadStatus
    hasSelectedPath: boolean
    canCaptureTranscript: boolean
    actionStatusMessage: string
    onCapture: () => void | Promise<void>
    onRefresh: () => void | Promise<void>
  }

  let {
    status,
    hasSelectedPath,
    canCaptureTranscript,
    actionStatusMessage,
    onCapture,
    onRefresh,
  }: Props = $props()
</script>

<header class="transcript-panel-header" aria-label="Transcript header">
  <div class="transcript-heading">
  <h2>Transcript</h2>
  <div class="transcript-actions">
    <button
      type="button"
      class="toolbar-icon-button panel-icon-button"
      aria-label="Capture Transcript"
      title="Capture Transcript"
      disabled={status !== 'loaded' || !canCaptureTranscript}
      onclick={onCapture}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5H5v16h14V5h-4" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M8 12h8M8 16h8" /></svg>
    </button>
    <button
      type="button"
      class="toolbar-icon-button panel-icon-button"
      aria-label="Refresh Transcript"
      title="Refresh Transcript"
      disabled={!hasSelectedPath}
      onclick={() => onRefresh()}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7" /></svg>
    </button>
  </div>
  </div>
  <span class="transcript-action-status" aria-live="polite">{actionStatusMessage}</span>
</header>
