<script lang="ts">
  import { onMount } from 'svelte'
  import type { TranscriptThemeName } from '../rendering/transcript-themes'
  export type SessionAction = 'open' | 'folder' | 'export'
  let { x, y, theme, onClose, onAction }: {
    x: number; y: number; theme: TranscriptThemeName
    onClose: () => void; onAction: (action: SessionAction) => void
  } = $props()
  let menu: HTMLDivElement
  let left = $state(0)
  let top = $state(0)
  const actions: [SessionAction, string][] = [['open','Open'],['folder','Open Containing Folder'],['export','Export Worklog']]
  function portal(element: HTMLElement) {
    document.body.appendChild(element)
    return { destroy: () => element.remove() }
  }
  onMount(() => {
    const rect = menu.getBoundingClientRect()
    left = Math.max(8, Math.min(x, innerWidth - rect.width - 8))
    top = Math.max(8, Math.min(y, innerHeight - rect.height - 8))
    menu.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const outside = (event: Event) => { if (!menu.contains(event.target as Node)) onClose() }
    const layoutChanged = (event: Event) => { if (!menu.contains(event.target as Node)) onClose() }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside, true)
    window.addEventListener('scroll', layoutChanged, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside, true)
      window.removeEventListener('scroll', layoutChanged, true)
      window.removeEventListener('resize', onClose)
    }
  })
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation(); onClose(); return
    }
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % buttons.length
      : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length : null
    if (next !== null) { event.preventDefault(); buttons[next].focus() }
  }
</script>

<div class="session-context-menu" data-theme={theme} role="menu" tabindex="-1" aria-label="Session actions"
  bind:this={menu} use:portal style:left={`${left}px`} style:top={`${top}px`}
  onkeydown={key} oncontextmenu={event => event.preventDefault()}>
  {#each actions as [action, label]}
    <button type="button" role="menuitem" tabindex="-1" onclick={() => onAction(action)}>{label}</button>
  {/each}
</div>
