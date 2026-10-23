<script lang="ts">
  import type { SessionSummary } from './contract'
  import { titleWeight } from './state'
  import { sessionTitlePresentation } from './title-presentation'

  let { item, active, selecting, now, onSelect }: {
    item: SessionSummary
    active: boolean
    selecting: boolean
    now: number
    onSelect: (item: SessionSummary) => Promise<void>
  } = $props()
  const id = $props.id()
  const presentation = $derived(sessionTitlePresentation(item))
  let infoButton: HTMLButtonElement | undefined = $state()
  let tooltip: HTMLSpanElement | undefined = $state()
  let hovered = $state(false)
  let focused = $state(false)
  let dismissed = $state(false)
  let left = $state(0)
  let top = $state(0)
  const open = $derived((hovered || focused) && !dismissed)

  function positionTooltip() {
    if (!infoButton || !tooltip) return
    const anchor = infoButton.getBoundingClientRect()
    const box = tooltip.getBoundingClientRect()
    left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))
    top = anchor.bottom + box.height + 14 <= window.innerHeight
      ? anchor.bottom + 6 : Math.max(8, anchor.top - box.height - 6)
    const list = infoButton.closest('.navigator-list')?.getBoundingClientRect()
    if (list && (anchor.bottom <= list.top || anchor.top >= list.bottom)) dismissed = true
  }
  $effect(() => {
    if (!open) return
    positionTooltip()
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') dismissed = true }
    window.addEventListener('scroll', positionTooltip, true)
    window.addEventListener('resize', positionTooltip)
    window.addEventListener('keydown', dismiss, true)
    return () => {
      window.removeEventListener('scroll', positionTooltip, true)
      window.removeEventListener('resize', positionTooltip)
      window.removeEventListener('keydown', dismiss, true)
    }
  })
</script>

<div class="session-entry-row" class:active class:selecting>
  <div class="session-title-line">
    <button type="button" class="session-entry" class:active
      aria-current={active ? 'true' : undefined}
      aria-describedby={`${id}-date`}
      disabled={selecting} title={presentation.title} data-entry-key={item.entry_key}
      onclick={() => onSelect(item)}>
      <span class="session-title" style:font-weight={titleWeight(item.last_conversation_at_ms, now)}>{presentation.title}</span>
    </button>
    {#if presentation.info}
      <span class="session-title-info" role="group"
        onmouseenter={() => { hovered = true; dismissed = false }} onmouseleave={() => { hovered = false }}
        onfocusin={() => { focused = true; dismissed = false }} onfocusout={() => { focused = false }}>
        <button type="button" class="session-info-button" aria-label="Title information"
          aria-describedby={`${id}-info`} bind:this={infoButton}
          onclick={event => event.stopPropagation()}
          onkeydown={event => {
            if (event.key === 'Escape') { dismissed = true; event.preventDefault(); event.stopPropagation() }
          }}>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <circle cx="10" cy="10" r="8" /><path d="M10 9v5" /><circle cx="10" cy="5.5" r=".7" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <span id={`${id}-info`} role="tooltip" class="session-info-tooltip" class:visible={open}
          style:left={`${left}px`} style:top={`${top}px`} bind:this={tooltip}>{presentation.info}</span>
      </span>
    {/if}
  </div>
  <span class="session-date" id={`${id}-date`}>{item.created_at_ms === null ? 'Creation date unavailable' : new Date(item.created_at_ms).toLocaleDateString()}</span>
</div>
