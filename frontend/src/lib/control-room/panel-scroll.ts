type Edge = 'top' | 'bottom'
const animations = new WeakMap<HTMLElement, () => void>()

export function cancelPanelScroll(element: HTMLElement | undefined) {
  if (element) animations.get(element)?.()
}

export function scrollPanel(element: HTMLElement | undefined, edge: Edge) {
  if (!element) return
  cancelPanelScroll(element)
  if (!element.getClientRects().length) return
  const destination = edge === 'top' ? 0 : Math.max(0, element.scrollHeight - element.clientHeight)
  const start = element.scrollTop
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || start === destination) {
    element.scrollTop = destination
    return
  }
  let frame = 0
  const started = performance.now()
  const cancel = () => {
    cancelAnimationFrame(frame)
    animations.delete(element)
    for (const event of ['wheel', 'pointerdown', 'keydown']) element.removeEventListener(event, cancel)
  }
  animations.set(element, cancel)
  for (const event of ['wheel', 'pointerdown', 'keydown']) element.addEventListener(event, cancel, { passive: true })
  const step = (now: number) => {
    if (!element.isConnected || !element.getClientRects().length) { cancel(); return }
    const progress = Math.min((now - started) / 200, 1)
    element.scrollTop = start + (destination - start) * (1 - Math.pow(1 - progress, 3))
    if (progress < 1) frame = requestAnimationFrame(step)
    else cancel()
  }
  frame = requestAnimationFrame(step)
}
