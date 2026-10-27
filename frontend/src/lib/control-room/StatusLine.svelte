<script lang="ts">
  import type { Feedback, StatusController } from './status-line'
  import type { TranscriptThemeName } from '../rendering/transcript-themes'
  let { feedback, theme }: { feedback: StatusController; theme: TranscriptThemeName } = $props()
  let visible = $state(false)
  let hovered = $state(false)
  let focused = $state(false)
  let previous: Feedback | undefined
  const duration = { info: 4000, success: 4000, warning: 8000, error: 12000, progress: 0 }
  $effect(() => {
    const value = $feedback
    if (value === previous) return
    previous = value
    const show = value.message !== 'Ready.' && value.message !== ''
    visible = show
    if (!show) { hovered = false; focused = false }
  })
  $effect(() => {
    const value = $feedback
    if (!visible || hovered || focused || value.severity === 'progress') return
    const timer = setTimeout(() => { visible = false; feedback.dismiss(value) }, duration[value.severity])
    return () => clearTimeout(timer)
  })
</script>

<div class="toast-region" data-theme={theme}>
  {#if visible}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard focus pauses dismissal and allows scrolling long feedback.) -->
    <section class="status-toast" data-severity={$feedback.severity} tabindex="0" aria-label={`${$feedback.severity} notification`}
      onmouseenter={() => { hovered = true }} onmouseleave={() => { hovered = false }}
      onfocusin={() => { focused = true }} onfocusout={(event) => { focused = event.currentTarget.contains(event.relatedTarget as Node | null) }}>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (The message viewport supports keyboard scrolling.) -->
      <div class="toast-announcement" tabindex="0" role={$feedback.severity === 'error' ? 'alert' : 'status'} aria-atomic="true">
        <div class="toast-heading">
          <span class="toast-icon" data-icon={$feedback.severity} aria-hidden="true">
            <svg class:toast-spinner={$feedback.severity === 'progress'} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              {#if $feedback.severity === 'success'}
                <circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" />
              {:else if $feedback.severity === 'info'}
                <circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" />
              {:else if $feedback.severity === 'progress'}
                <circle class="toast-spinner-track" cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 9 9" />
              {:else if $feedback.severity === 'warning'}
                <path d="m12 3 10 18H2L12 3Zm0 6v5m0 3h.01" />
              {:else}
                <circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" />
              {/if}
            </svg>
          </span>
          <strong class="toast-label">{$feedback.severity}</strong>
        </div>
        <p class="toast-message">{$feedback.message}</p>
      </div>
      <button type="button" class="toast-dismiss" aria-label="Dismiss notification" title="Dismiss notification" onclick={() => { visible = false; hovered = false; focused = false; feedback.dismiss($feedback) }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </section>
  {/if}
</div>
