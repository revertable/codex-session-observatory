import type { SearchController } from './search-state'
import { literalMatches } from './literal-search'

const allKey = 'observatory-search', currentKey = 'observatory-search-current'

/** Search rendered message bodies, preserving the semantic DOM and attachment identity. */
export function renderedMatches(viewport: HTMLElement, query: string): Range[] {
  const ranges: Range[] = []
  for (const body of viewport.querySelectorAll<HTMLElement>('.message-content, .technical-message-content')) {
    let text = ''
    const segments: { node: Text; start: number; end: number }[] = []
    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.textContent ?? ''
        segments.push({ node: node as Text, start: text.length, end: text.length + value.length }); text += value
      } else if (node instanceof HTMLElement) {
        const style = getComputedStyle(node)
        if (node.hidden || style.display === 'none' || style.visibility === 'hidden' || node.getAttribute('aria-hidden') === 'true') return
        if (node.tagName === 'BR') { text += '\n'; return }
        const block = /^(P|PRE|LI|TR|TD|TH|H[1-6]|BLOCKQUOTE|DIV)$/.test(node.tagName)
        if (block && text && !text.endsWith('\n')) text += '\n'
        for (const child of node.childNodes) visit(child)
        if (block && text && !text.endsWith('\n')) text += '\n'
      }
    }
    visit(body)
    let first = 0, last = 0
    for (const match of literalMatches(text, query)) {
      while (first < segments.length && segments[first].end <= match.start) first++
      last = Math.max(last, first)
      while (last < segments.length && segments[last].end < match.end) last++
      const start = segments[first], end = segments[last]
      if (!start || !end || start.start > match.start || end.start >= match.end) continue
      const range = document.createRange()
      range.setStart(start.node, match.start - start.start); range.setEnd(end.node, match.end - end.start)
      ranges.push(range)
    }
  }
  return ranges
}

export function attachTranscriptSearch(viewport: HTMLElement, search: SearchController) {
  // Keep supported browser highlight rules out of the build tool's legacy CSS parser.
  const style = document.createElement('style')
  style.textContent = `::highlight(observatory-search) { color: #172033; background-color: #fde68a; }
    ::highlight(observatory-search-current) { color: #ffffff; background-color: #b45309; text-decoration: underline; }
    [data-theme='Terminal Style'] ::highlight(observatory-search), [data-theme='DM Style (Dark)'] ::highlight(observatory-search) { color: #17191d; background-color: #fcd34d; }`
  document.head.append(style)
  let query = '', request = -1, current = -1, ranges: Range[] = [], frame = 0, alive = true
  const clear = () => { CSS.highlights.delete(allKey); CSS.highlights.delete(currentKey) }
  const paint = (scroll: boolean) => {
    clear()
    if (!ranges.length) { search.summary('Transcript', query ? '0 / 0' : ''); return }
    const all = new Highlight()
    for (const range of ranges) all.add(range)
    CSS.highlights.set(allKey, all)
    const active = new Highlight(ranges[current]); active.priority = 1
    CSS.highlights.set(currentKey, active)
    search.summary('Transcript', `${current + 1} / ${ranges.length}`)
    if (scroll) {
      const rect = ranges[current].getBoundingClientRect(), container = viewport.getBoundingClientRect()
      viewport.scrollBy({ top: rect.top - container.top - viewport.clientHeight / 3, behavior: 'instant' })
    }
  }
  const refresh = (next: boolean) => {
    if (!alive) return
    ranges = query ? renderedMatches(viewport, query) : []
    current = ranges.length ? (next ? (current + 1) % ranges.length : 0) : -1
    paint(true)
  }
  const schedule = (next: boolean) => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => refresh(next)) }
  const unsubscribe = search.subscribe(state => {
    if (state.requests.Transcript === request) return
    const same = query === state.queries.Transcript
    query = state.queries.Transcript; request = state.requests.Transcript
    schedule(same && current >= 0)
  })
  const observer = new MutationObserver(() => schedule(false))
  observer.observe(viewport, { subtree: true, childList: true, characterData: true })
  return () => { alive = false; unsubscribe(); observer.disconnect(); cancelAnimationFrame(frame); clear(); style.remove(); search.summary('Transcript', '') }
}
