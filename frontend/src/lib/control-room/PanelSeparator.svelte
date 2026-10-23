<script lang="ts">
  import { onDestroy } from 'svelte'
  let { label, controls, value, minimum, maximum, direction, onResize }: {
    label: string; controls: string; value: number; minimum: number; maximum: number
    direction: 1 | -1; onResize: (width: number) => void
  } = $props()
  let drag: { pointer: number; x: number; width: number; target: HTMLElement } | undefined
  let dragging = $state(false)
  function resize(next: number) { onResize(Math.max(minimum, Math.min(maximum, next))) }
  function finish() {
    const previous = drag
    drag = undefined
    dragging = false
    if (previous?.target.hasPointerCapture(previous.pointer)) previous.target.releasePointerCapture(previous.pointer)
  }
  function start(event: PointerEvent) {
    if (event.button !== 0) return
    finish()
    event.preventDefault()
    event.currentTarget instanceof HTMLElement && event.currentTarget.focus()
    const target = event.currentTarget as HTMLElement
    drag = { pointer: event.pointerId, x: event.clientX, width: value, target }
    target.setPointerCapture(event.pointerId)
    dragging = true
  }
  function move(event: PointerEvent) {
    if (drag?.pointer === event.pointerId) resize(drag.width + direction * (event.clientX - drag.x))
  }
  function key(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    resize(event.key === 'Home' ? minimum : event.key === 'End' ? maximum
      : value + direction * (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 40 : 10))
  }
  onDestroy(finish)
</script>

<!-- Focusable separators implement the WAI-ARIA window splitter keyboard pattern. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="panel-separator" class:dragging role="separator" tabindex="0"
  aria-label={label} aria-controls={controls} aria-orientation="vertical"
  aria-valuemin={minimum} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(value)}
  onpointerdown={start} onpointermove={move} onpointerup={finish}
  onpointercancel={finish} onlostpointercapture={finish} onkeydown={key}></div>
