import { mount, unmount, flushSync, tick } from 'svelte'
import App from '../../src/App.svelte'
import type { ParseResponseDto, TranscriptBlockDto } from '../../src/lib/parse-contract'
import { serializeTranscript } from '../../src/lib/rendering/transcript-capture'
import '../../src/app.css'
import '../../src/lib/rendering/transcript.css'

const target = document.querySelector('#target') as HTMLElement
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const settle = async () => { flushSync(); await tick(); await new Promise(resolve => setTimeout(resolve, 0)); flushSync() }
let resolveLoad: (value: ParseResponseDto) => void
let copied = ''
const opened: string[] = []
let exportArgs: Record<string, unknown> | undefined
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied = text } } })
const block = (entry_type: TranscriptBlockDto['entry_type'], content: string): TranscriptBlockDto => ({ entry_type, content, timestamp: '2026-10-25T00:00:00Z', label: entry_type.toUpperCase(), title: entry_type })
const all = [block('you', '**A** [docs](https://example.com/docs)'), block('tool_call', '  Tool call'), block('codex', '**B**'), block('tool_result', '  Tool result'), block('you', '**Duplicate**'), block('system', 'System'), block('you', '**Duplicate**'), block('context', 'Context'), block('task', 'Task')]
const response: ParseResponseDto = {
  source: { file_name: 'session.jsonl', absolute_path: 'session.jsonl', session_id: 'fixture', resume_command: null },
  session: { classification: 'interactive', identity: null, capabilities: { can_show_transcript: true, can_resume: false, can_export_worklog: true, can_open_parent_session: false } },
  parsed_chat_log: { entries: [], transcript_blocks: all, referenced_conversations: [], observed_event_counts: [], counters: { parsed_candidates: all.length, total_entries: all.length, visible_entries: all.length, ignored_lines: 0, malformed_lines: 0 } },
}
;(window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args?: Record<string, unknown>) => {
  if (command === 'reload_session_navigator') return { snapshot_id: 'fixture', sessions_root: '.', total: 2, items: ['session.jsonl', 'other.jsonl'].map((path, index) => ({ entry_key: String(index), thread_id: String(index), path, title: index ? 'Other fixture' : 'Session fixture', title_source: 'database_name', created_at_ms: 1, created_at_source: 'session_meta', last_conversation_at_ms: null, last_conversation_at_source: 'unavailable', storage_date: null, classification: 'interactive', thread_source: 'user' })), has_more: false, next_cursor: null, diagnostics: { discovered_files: 2, duplicate_files: 0, guardian_sessions: 0, unreadable_files: 0, warnings: [] } }
  if (command === 'list_system_fonts') return []
  if (command === 'plugin:app|version') throw new Error('No update check in test')
  if (command === 'parse_selected_jsonl') return new Promise<ParseResponseDto>(resolve => { resolveLoad = resolve })
  if (command === 'plugin:opener|open_url') { opened.push(String(args?.url)); return }
  if (command === 'plugin:dialog|open') return 'synthetic-export'
  if (command === 'export_worklog') { exportArgs = args; return { status: 'exported', bundle_path: 'synthetic-export/bundle', generated_files: ['000_index.md'], refreshed: false, folder_opened: true } }
  throw new Error('Unexpected command: ' + command)
} }
const sections = () => [...target.querySelectorAll<HTMLElement>('.transcript-presentation section[data-kind]')]
const body = (section: Element) => section.querySelector('.message-content,.technical-message-content')
const collect = (section: Element) => section.querySelector<HTMLButtonElement>('.collection-toggle')!
const header = (section: Element) => section.querySelector<HTMLButtonElement>('button[aria-expanded]')!
const selected = (section: Element) => collect(section).getAttribute('aria-pressed') === 'true'
const snapshots = () => [...target.querySelectorAll('.collection-message')].map(x => x.textContent)
async function click(label: string) { const button = [...target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label); assert(button && !button.disabled, 'enabled button: ' + label); button!.click(); await settle() }
async function filter(index: number) { target.querySelectorAll<HTMLInputElement>('.filter-list input')[index].click(); await settle() }

;(globalThis as any).__filterReuseCase = async () => {
  for (const theme of ['Terminal Style', 'Markdown Style', 'DM Style', 'DM Style (Dark)'] as const) {
    const instance = mount(App, { target })
    try {
      await settle(); await click('Session fixture'); resolveLoad(structuredClone(response)); await settle()
      const chooser = target.querySelector<HTMLSelectElement>('select[aria-label="Theme"]')!; chooser.value = theme; chooser.dispatchEvent(new Event('change', { bubbles: true })); await settle()
      const original = sections(), bodies = original.map(body), children = bodies.map(node => node!.firstChild)
      assert(original.length === 4 && original[2] !== original[3], theme + ': duplicates remain distinct')
      collect(original[2]).click(); await settle(); assert(selected(original[2]) && !selected(original[3]), theme + ': only first duplicate selected')
      collect(original[3]).click(); collect(original[0]).click(); await settle(); const capturedBefore = snapshots(); assert(capturedBefore.length === 3, theme + ': both duplicate snapshots retained')
      await filter(2); const withTool = sections(); assert(withTool.length === 5 && withTool[1].dataset.kind === 'tool_call', theme + ': tool inserted in source order')
      for (const [i, position] of [0, 2, 3, 4].entries()) { assert(withTool[position] === original[i], theme + ': wrapper retained at new index'); assert(body(withTool[position]) === bodies[i] && body(withTool[position])!.firstChild === children[i], theme + ': body and semantic child retained') }
      assert(selected(withTool[0]) && !selected(withTool[2]) && selected(withTool[3]) && selected(withTool[4]), theme + ': flags follow moved messages')
      collect(withTool[1]).click(); await settle(); assert(selected(withTool[1]) && !selected(withTool[2]), theme + ': new tool handler targets current index'); collect(withTool[1]).click(); await settle()
      assert(snapshots().length === 3, theme + ': removing tool preserves snapshots')
      header(withTool[2]).click(); await settle(); assert(!body(withTool[2]) && body(withTool[0]) && body(withTool[3]), theme + ': moved collapse handler targets CODEX')
      await click('Capture Transcript'); assert(copied === serializeTranscript({ theme, blocks: [all[0], all[1], all[2], all[4], all[6]], references: [], observedEventCounts: [], collapsedBlocks: { 2: true } }), theme + ': capture follows filtered indices')
      const link = original[0].querySelector<HTMLAnchorElement>('a')!, count = opened.length; link.click(); await settle(); assert(opened.length === count + 1 && opened.at(-1) === 'https://example.com/docs', theme + ': retained link handler runs once')
      await click('Export Worklog'); assert(exportArgs?.sourcePath === 'session.jsonl' && exportArgs?.parentDirectory === 'synthetic-export' && Object.keys(exportArgs).length === 2, theme + ': export receives original file only')
      await filter(2); assert(sections().every((section, i) => section === original[i]) && body(original[1]), theme + ': original collapse reset policy preserved')
      for (const index of [3, 4, 0, 1]) { await filter(index); await filter(index) }
      assert(sections().map(x => x.dataset.kind).join() === 'you,codex,you,you', theme + ': role filters restore source order'); assert(JSON.stringify(snapshots()) === JSON.stringify(capturedBefore), theme + ': filters preserve snapshots')
      const current = sections(), currentBodies = current.map(body); await click('Refresh Transcript'); resolveLoad(structuredClone(response)); await settle()
      assert(sections().every((section, i) => section === current[i] && body(section) === currentBodies[i]), theme + ': new DTO objects retain DOM on Refresh')
      collect(sections()[1]).click(); await settle(); const oldB = snapshots(), changed = structuredClone(response); changed.parsed_chat_log.transcript_blocks[2].content = 'Updated B'
      await click('Refresh'); resolveLoad(changed); await settle(); assert(body(sections()[1])?.textContent === 'Updated B' && !selected(sections()[1]), theme + ': edited message receives new identity'); assert(JSON.stringify(snapshots()) === JSON.stringify(oldB), theme + ': collected old text remains a snapshot')
      assert(sections()[0] === current[0] && sections()[2] === current[2] && sections()[3] === current[3], theme + ': unchanged neighbours survive edited Refresh')
      await click('Other fixture'); assert(sections().length === 0 && snapshots().length === 0, theme + ': session change clears old state'); resolveLoad(structuredClone(response)); await settle()
    } finally { await unmount(instance); await settle() }
  }
}
;(globalThis as any).__domReady = true
