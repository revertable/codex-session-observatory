import { mount, unmount, flushSync, tick } from 'svelte'
import App from '../../src/App.svelte'
import '../../src/app.css'
import '../../src/lib/rendering/transcript.css'
import type { ParseResponseDto } from '../../src/lib/parse-contract'

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const settle = async () => { flushSync(); await tick(); await new Promise(resolve => setTimeout(resolve, 0)); flushSync() }
const waitForPageScroll = (destination: () => number, label: string) => new Promise<void>((resolve, reject) => {
  let matchingFrames = 0
  let frame = 0
  const timeout = setTimeout(() => {
    cancelAnimationFrame(frame)
    reject(new Error(`${label}: scrollY=${(document.querySelector('.transcript-viewport') as HTMLElement).scrollTop}, target=${destination()}`))
  }, 5000)
  const observe = () => {
    matchingFrames = Math.abs((document.querySelector('.transcript-viewport') as HTMLElement).scrollTop - destination()) <= 1 ? matchingFrames + 1 : 0
    if (matchingFrames >= 2) {
      clearTimeout(timeout)
      resolve()
    } else frame = requestAnimationFrame(observe)
  }
  frame = requestAnimationFrame(observe)
})
const target = document.querySelector('#target') as HTMLElement
let copied = ''
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
  writeText: async (text: string) => { copied = text },
} })
const response: ParseResponseDto = {
  source: { file_name: 'session.jsonl', absolute_path: 'session.jsonl', session_id: 'test', resume_command: 'codex resume test' },
  session: { classification: 'interactive', identity: null, capabilities: {
    can_show_transcript: true, can_resume: true, can_export_worklog: false, can_open_parent_session: false,
  } },
  parsed_chat_log: {
    entries: [], referenced_conversations: [], observed_event_counts: [],
    counters: { parsed_candidates: 3, total_entries: 3, visible_entries: 3, ignored_lines: 0, malformed_lines: 0 },
    transcript_blocks: [
      { entry_type: 'you', label: '[YOU]', title: 'A', timestamp: '2026-10-22T23:33:48.799Z', content: 'A\nSecond line' },
      { entry_type: 'codex', label: '[CODEX]', title: 'B', timestamp: '2026-10-22T01:33:48.100Z', content: 'B\n```ts\n  code\n\tend\n```' },
      { entry_type: 'tool_call', label: '[TOOL CALL]', title: 'C', timestamp: null, content: 'C\n' + 'original line\n'.repeat(40) },
    ],
  },
}
let selectedPath = 'session.jsonl'
const navigatorPage = () => ({ snapshot_id: 'test', sessions_root: '.', total: 2, items: [selectedPath, 'other-' + selectedPath].map((path, i) => ({entry_key: String(i), thread_id: String(i), path, title: i ? 'Other fixture' : 'Session fixture', title_source: 'database_name', created_at_ms: 1, created_at_source: 'session_meta', last_conversation_at_ms: null, last_conversation_at_source: 'unavailable', storage_date: null, classification: 'interactive', thread_source: 'user'})), next_cursor: null, has_more: false, diagnostics: { discovered_files: 2, guardian_sessions: 0, duplicate_files: 0, unreadable_files: 0, warnings: [] } })
;(window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
  if (command === 'list_system_fonts') return []
  if (command === 'reload_session_navigator') return navigatorPage()
  if (command === 'resolve_jsonl_initial_directory') return '.'
  if (command === 'plugin:dialog|open') return 'session.jsonl'
  if (command === 'parse_selected_jsonl') return structuredClone(response)
  throw new Error('Unavailable in test: ' + command)
} }
const click = async (label: string) => {
  const button = Array.from(target.querySelectorAll('button')).find(button =>
    button.getAttribute('aria-label') === label || button.textContent?.trim() === label)
  assert(button && !button.disabled, 'enabled action: ' + label)
  button!.click(); await settle()
}
;(globalThis as any).__collectionUiCase = async () => {
  const instance = mount(App, { target })
  const originalMatchMedia = window.matchMedia
  try {
    await settle()
    assert((target.querySelector('[aria-label="Scroll Transcript to Bottom"]') as HTMLButtonElement).disabled, 'Bottom disabled without a session')
    assert(!target.querySelector('[aria-label="Scroll to Bottom"]'), 'global Bottom removed')
    assert((target.querySelector('[aria-label="Capture Transcript"]') as HTMLButtonElement).disabled, 'Capture disabled without session')
    assert((target.querySelector('[aria-label="Copy All"]') as HTMLButtonElement).disabled && (target.querySelector('[aria-label="Clear Collection"]') as HTMLButtonElement).disabled, 'empty Collection actions disabled')
    await click('Session fixture')
    const status = () => target.querySelector('.toast-message')?.textContent ?? ''
    const resume = target.querySelector('.resume-row') as HTMLElement
    const emptyHeight = resume.getBoundingClientRect().height
    assert(status() === '', 'Ready is hidden')
    await click('Copy Resume Command')
    assert(copied === 'codex resume test' && status() === 'Copied to clipboard.', 'copy notice retained')
    assert(resume.getBoundingClientRect().height === emptyHeight, 'copy feedback never resizes Resume row')
    await click('Refresh')
    assert(status() === '', 'successful Refresh hides Ready')
    assert(resume.getBoundingClientRect().height === emptyHeight, 'resume row returns to initial height')

    const toolFilter = Array.from(target.querySelectorAll('label')).find(label => label.textContent?.trim() === 'Tool calls')!.querySelector('input')!
    toolFilter.checked = true; toolFilter.dispatchEvent(new Event('change', { bubbles: true })); await settle()
    const toggles = target.querySelectorAll<HTMLButtonElement>('.terminal-block .collection-toggle')
    for (const index of [2, 0, 1]) { toggles[index].click(); await settle() }
    const panel = target.querySelector('.collection-panel')!
    const articles = Array.from(panel.querySelectorAll('article'))
    assert(articles.map(article => article.querySelector('strong')!.textContent).join(',') === '[YOU],[CODEX],[TOOL]', 'shared roles and source order')
    assert(articles.every((article, index) => article.querySelector('pre')!.textContent === response.parsed_chat_log.transcript_blocks[index].content), 'raw bodies preserved')
    assert(articles[0].querySelector('pre > span:not(.collection-code)'), 'ordinary Collection text stays prose')
    assert(articles[1].querySelector('.collection-code')?.textContent?.includes('```'), 'raw fenced code gets a separate typography range')
    assert(articles[2].querySelector('.collection-code')?.textContent === response.parsed_chat_log.transcript_blocks[2].content, 'tool log retains one code range')

    const title = panel.querySelector('h2')!.getBoundingClientRect()
    const actions = panel.querySelector('.collection-actions')!.getBoundingClientRect()
    assert(title.right <= actions.left && Math.abs((title.top + title.bottom) - (actions.top + actions.bottom)) < 2, 'header stays on one nonoverlapping row')
    await click('Copy All')
    const expected = articles.map(article => {
      const role = article.querySelector('strong')!.textContent
      const time = article.querySelector('time')?.textContent
      return role + (time ? ' ' + time : '') + '\n' + article.querySelector('pre')!.textContent
    }).join('\n\n---\n\n')
    assert(copied === expected, 'clipboard header and raw body match panel')
    await click('Capture Transcript')
    assert(copied.includes('A\nSecond line') && copied.includes('original line') && panel.querySelectorAll('article').length === 3, 'Capture retains content and Collection state')
    assert(status() === 'Transcript copied to clipboard.', 'existing Capture feedback reaches Toast')

    const bottom = () => (target.querySelector('.transcript-viewport') as HTMLElement).scrollHeight - (target.querySelector('.transcript-viewport') as HTMLElement).clientHeight
    assert(bottom() > 0, 'fixture requires a scrollable Transcript')
    await click('Scroll Transcript to Bottom')
    await waitForPageScroll(bottom, 'animated Bottom completion')
    assert(bottom() > 0 && Math.abs((document.querySelector('.transcript-viewport') as HTMLElement).scrollTop - bottom()) <= 1, 'animated Bottom reaches Transcript end')
    await click('Scroll Transcript to Top')
    await waitForPageScroll(() => 0, 'animated Top completion')
    assert((document.querySelector('.transcript-viewport') as HTMLElement).scrollTop === 0, 'animated Top retained')

    // Reproduce a late rendering frame that outlasts the former 300ms assertion.
    // The assertion must wait for the real destination, not elapsed wall time.
    const originalRequestFrame = window.requestAnimationFrame
    let delayedFrameRan = false
    try {
      window.requestAnimationFrame = callback => {
        window.requestAnimationFrame = originalRequestFrame
        setTimeout(() => originalRequestFrame.call(window, now => {
          delayedFrameRan = true
          callback(now)
        }), 400)
        return 0
      }
      await click('Scroll Transcript to Bottom')
      await waitForPageScroll(bottom, 'delayed-frame Bottom completion')
      assert(delayedFrameRan && Math.abs((document.querySelector('.transcript-viewport') as HTMLElement).scrollTop - bottom()) <= 1, 'Bottom reaches Transcript end after a late frame')
    } finally { window.requestAnimationFrame = originalRequestFrame }
    await click('Scroll Transcript to Top')
    await waitForPageScroll(() => 0, 'Top after delayed-frame Bottom')
    window.matchMedia = ((query: string) => query === '(prefers-reduced-motion: reduce)'
      ? { matches: true } as MediaQueryList : originalMatchMedia.call(window, query))
    await click('Scroll Transcript to Bottom')
    assert(Math.abs((document.querySelector('.transcript-viewport') as HTMLElement).scrollTop - bottom()) <= 1, 'reduced-motion Bottom is immediate')
    await click('Scroll Transcript to Top'); assert((document.querySelector('.transcript-viewport') as HTMLElement).scrollTop === 0, 'reduced-motion Top is immediate')
    await click('Clear Collection')
    assert(panel.querySelectorAll('article').length === 0 && Array.from(toggles).every(button => button.getAttribute('aria-pressed') === 'false'), 'Clear resets contents and selection')
  } finally { window.matchMedia = originalMatchMedia; await unmount(instance) }
}
;(globalThis as any).__domReady = true
