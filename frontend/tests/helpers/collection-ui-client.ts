import { mount, unmount, flushSync, tick } from 'svelte'
import App from '../../src/App.svelte'
import '../../src/app.css'
import type { ParseResponseDto } from '../../src/lib/parse-contract'

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const settle = async () => { flushSync(); await tick(); await new Promise(resolve => setTimeout(resolve, 0)); flushSync() }
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
;(window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
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
    assert((target.querySelector('[aria-label="Scroll to Bottom"]') as HTMLButtonElement).disabled, 'Bottom disabled without a session')
    await click('Select JSONL')
    const status = target.querySelector('.action-status') as HTMLElement
    const resume = target.querySelector('.resume-row') as HTMLElement
    const emptyHeight = resume.getBoundingClientRect().height
    assert(status.getBoundingClientRect().height === 0, 'empty notice takes no height')
    await click('Copy Resume Command')
    assert(copied === 'codex resume test' && status.textContent === 'Copied.', 'copy notice retained')
    assert(resume.getBoundingClientRect().height > emptyHeight, 'notice allocates space')
    await click('Refresh')
    assert(status.textContent === '' && status.getBoundingClientRect().height === 0, 'cleared notice takes no height')
    assert(resume.getBoundingClientRect().height === emptyHeight, 'resume row returns to initial height')

    const toolFilter = Array.from(target.querySelectorAll('label')).find(label => label.textContent?.trim() === 'Tool calls')!.querySelector('input')!
    toolFilter.checked = true; toolFilter.dispatchEvent(new Event('change', { bubbles: true })); await settle()
    const toggles = target.querySelectorAll<HTMLButtonElement>('.terminal-block .collection-toggle')
    for (const index of [2, 0, 1]) { toggles[index].click(); await settle() }
    const panel = target.querySelector('.collection-panel')!
    const articles = Array.from(panel.querySelectorAll('article'))
    assert(articles.map(article => article.querySelector('strong')!.textContent).join(',') === '[YOU],[CODEX],[TOOL]', 'shared roles and source order')
    assert(articles.every((article, index) => article.querySelector('pre')!.textContent === response.parsed_chat_log.transcript_blocks[index].content), 'raw bodies preserved')
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

    await click('Scroll to Bottom'); await new Promise(resolve => setTimeout(resolve, 300))
    const bottom = () => document.documentElement.scrollHeight - window.innerHeight
    assert(bottom() > 0 && Math.abs(window.scrollY - bottom()) <= 1, 'animated Bottom reaches page end')
    await click('Top'); await new Promise(resolve => setTimeout(resolve, 300))
    assert(window.scrollY === 0, 'animated Top retained')
    window.matchMedia = ((query: string) => query === '(prefers-reduced-motion: reduce)'
      ? { matches: true } as MediaQueryList : originalMatchMedia.call(window, query))
    await click('Scroll to Bottom')
    assert(Math.abs(window.scrollY - bottom()) <= 1, 'reduced-motion Bottom is immediate')
    await click('Top'); assert(window.scrollY === 0, 'reduced-motion Top is immediate')
    await click('Clear')
    assert(panel.querySelectorAll('article').length === 0 && Array.from(toggles).every(button => button.getAttribute('aria-pressed') === 'false'), 'Clear resets contents and selection')
  } finally { window.matchMedia = originalMatchMedia; await unmount(instance) }
}
;(globalThis as any).__domReady = true
