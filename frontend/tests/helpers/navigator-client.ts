import { mount, unmount, flushSync, tick } from 'svelte'
import App from '../../src/App.svelte'
import '../../src/app.css'
import '../../src/lib/rendering/transcript.css'
import type { SessionSummary, SessionPage, SessionHierarchy } from '../../src/lib/session-navigator/contract'
import { navigatorModePreferenceKey } from '../../src/lib/session-navigator/state'
import type { ParseResponseDto, TranscriptBlockDto } from '../../src/lib/parse-contract'

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const settle = async () => {
  flushSync(); await tick()
  void document.body.offsetHeight
  await document.fonts.ready
  await new Promise(resolve => setTimeout(resolve, 40)); flushSync()
}
const target = document.querySelector('#target') as HTMLElement
const now = Date.now()
const items: SessionSummary[] = Array.from({ length: 43 }, (_, index) => ({
  entry_key: String(index), thread_id: String(index), path: `/sessions/${index}.jsonl${index === 1 ? '.zst' : ''}`,
  title: `Session ${String(index).padStart(2, '0')}${index === 0 ? ' — a long title that must remain available in full even when truncated' : ''}`,
  title_source: 'database_name', created_at_ms: now - index * 86400000, created_at_source: 'database_created_at_ms',
  last_conversation_at_ms: index === 0 ? now - 100 * 86400000 : index === 1 ? now - 10 * 86400000 : index === 2 ? now : null,
  last_conversation_at_source: 'conversation_message', storage_date: index === 42 ? null : '2026-10-23',
  classification: index === 1 ? 'chatgpt_handoff' : 'interactive', thread_source: index === 1 ? 'chatgpt_handoff' : 'user',
}))
Object.assign(items[3], { title: '01a16795', title_source: 'thread_id', thread_id: '01a16795-5f9e-77a0-8cd4-f55361e09cb0' })
Object.assign(items[4], { title: '01a16646', title_source: 'thread_id', thread_id: '01a16646-4d39-7253-ab9e-ddd4319f20a0' })
Object.assign(items[5], { title: 'imported-session.jsonl', title_source: 'file_name', thread_id: null })
Object.assign(items[6], { title: 'Untitled Session', title_source: 'database_name' })
Object.assign(items[42], { title: 'unfiled-session.jsonl', title_source: 'file_name', thread_id: null })
const diagnostics = { discovered_files: 46, guardian_sessions: 3, duplicate_files: 0, unreadable_files: 0, warnings: ['database_unavailable'] }
const page = (snapshot: string, offset = 0): SessionPage => ({ snapshot_id: snapshot, sessions_root: '/sessions',
  total: items.length, items: items.slice(offset, offset + 20), next_cursor: offset + 20 < items.length ? String(offset + 20) : null,
  has_more: offset + 20 < items.length, diagnostics })
const hierarchy = (snapshot: string): SessionHierarchy => ({ snapshot_id: snapshot, sessions_root: '/sessions', total: items.length,
  years: [{ year: 2026, months: [{ month: 10, days: [{ day: 23, items: items.slice(0, 42) }] }] }],
  unfiled_items: [items[42]], diagnostics })
let longMessages = false
let widthFixture = false
let longHeaderFixture = false
let specializedFixture = false
const widthCode = 'const value = "' + 'code'.repeat(180) + '";\n  preserve indentation'
const widthFence = String.fromCharCode(96).repeat(3)
const widthBlocks: TranscriptBlockDto[] = [
  { entry_type:'you',label:'YOU',title:'User',timestamp:null,content:'Short message' },
  { entry_type:'codex',label:'CODEX',title:'Assistant',timestamp:null,content:'# Width fixture\n\n' + 'A natural paragraph with several words. '.repeat(60) + '\n\n- First item\n- Second item\n\n' + widthFence + 'js\n' + widthCode + '\n' + widthFence + '\n\nhttps://example.com/' + 'long-path'.repeat(100) + '\n\n| Column | Wide value |\n| --- | --- |\n| Cell | ' + 'table-cell'.repeat(70) + ' |' },
  { entry_type:'tool_result',label:'RESULT',title:'Tool result',timestamp:null,content:'Technical output ' + 'unbroken'.repeat(160) },
]
const response = (path: string): ParseResponseDto => ({
  source: { absolute_path: path, file_name: path.split('/').at(-1)!, session_id: null, resume_command: null },
  session: { classification: 'interactive', identity: null, capabilities: { can_show_transcript: true, can_resume: false,
    can_export_worklog: true, can_open_parent_session: false } },
  parsed_chat_log: { entries: [], referenced_conversations: [], observed_event_counts: [],
    counters: { parsed_candidates: 2, total_entries: 2, visible_entries: 2, ignored_lines: 0, malformed_lines: 0 },
    transcript_blocks: [
      { entry_type: 'you', label: 'YOU', title: 'User', timestamp: null, content: 'First message in ' + path + (longMessages ? '\nLong message'.repeat(120) : '') },
      { entry_type: 'codex', label: 'CODEX', title: 'Assistant', timestamp: null, content: 'Reply' },
    ] },
})
let failFonts = false
let reloads = 0; let flatCalls = 0; let hierarchyCalls = 0; const parses: string[] = []
let reloadErrorMessage = 'Cannot read sessions'
let failReload = false; let expirePage = false; let failParse = false; let empty = false
let releasePage: (() => void) | null = null; let holdPage = false
let releaseReload: (() => void) | null = null; let holdReload = false
const folderTargets: string[] = []; const exportedTargets: string[] = []
let cancelExport = false; let failAction = ''; let failExport = false; let failFolderAfterExport = false; let holdExport = false; let releaseExport: (() => void) | null = null
;(window as any).__TAURI_INTERNALS__ = {
  invoke: async (command: string, args?: any) => {
    if (command === 'list_system_fonts') {
      if (failFonts) throw new Error('Synthetic enumeration failure')
      return [{ family: 'Arial', display_name: 'Arial' }, { family: 'Consolas', display_name: 'Consolas' }, { family: 'Malgun Gothic', display_name: '맑은 고딕' }]
    }
    if (command === 'plugin:app|version') throw new Error('No update check')
    if (command === 'reload_session_navigator') {
      reloads++
      if (holdReload) await new Promise<void>(resolve => { releaseReload = resolve })
      if (failReload) throw { error: { code: 'navigator_task_failed', message: reloadErrorMessage } }
      return empty ? { ...page(String(reloads)), items: [], total: 0, next_cursor: null, has_more: false } : page(String(reloads))
    }
    if (command === 'list_sessions_flat') {
      flatCalls++
      if (holdPage) await new Promise<void>(resolve => { releasePage = resolve })
      if (expirePage) throw { error: { code: 'navigator_snapshot_expired', message: 'Expired snapshot' } }
      assert(args.request.snapshot_id === String(reloads), 'flat request uses current snapshot')
      return page(args.request.snapshot_id, Number(args.request.cursor))
    }
    if (command === 'list_sessions_hierarchy') {
      hierarchyCalls++; assert(args.request.snapshot_id === String(reloads), 'tree uses current snapshot'); return hierarchy(args.request.snapshot_id)
    }
    if (command === 'parse_selected_jsonl') {
      parses.push(args.path)
      if (failParse) throw { error: { code: 'read_failed', message: 'Session cannot be read' } }
      const result = response(args.path)
      if (longHeaderFixture) {
        result.source.session_id = 'session-' + 'long-한글-'.repeat(30)
        result.source.resume_command = 'codex resume ' + result.source.session_id
        result.session.capabilities.can_resume = true
      }
      if (widthFixture) result.parsed_chat_log.transcript_blocks = widthBlocks
      if (specializedFixture) result.session = { classification:'guardian_review', identity: {
        thread_id:'synthetic-thread-' + 'x'.repeat(120),session_id:null,parent_thread_id:null,originator:null,thread_source:null,
        source:{kind:'subagent',value:'guardian'},history_mode:null,subagent_history_start_ordinal:null },
        capabilities:{can_show_transcript:false,can_resume:false,can_export_worklog:false,can_open_parent_session:false} }
      return result
    }
    if (command === 'resolve_jsonl_initial_directory') return '/sessions'
    if (command === 'export_worklog') {
      if (failExport) throw { error: { code: 'target_not_safe_to_overwrite', message: 'Synthetic unsafe target' } }
      return { status: 'exported', bundle_path: '/output/codex-worklog/bundle', generated_files: ['index.md'], refreshed: false, folder_opened: !failFolderAfterExport, folder_open_error: failFolderAfterExport ? 'Synthetic folder failure' : null }
    }
    if (['resolve_navigator_session', 'open_navigator_containing_folder', 'export_navigator_worklog'].includes(command)) {
      assert(args.request.snapshot_id === String(reloads), 'context action keeps its snapshot')
      const item = items.find(item => item.entry_key === args.request.entry_key)!
      assert(item, 'action targets snapshot entry')
      if (failAction) throw { error: { code: failAction, message: 'Synthetic action failure' } }
      if (command === 'resolve_navigator_session') return item.path
      if (command === 'open_navigator_containing_folder') { folderTargets.push(item.path); return }
      if (failExport) throw { error: { code: 'target_not_safe_to_overwrite', message: 'Synthetic unsafe target' } }
      assert(!('filter' in args) && !('collection' in args), 'export receives no filtered or collected subset')
      exportedTargets.push(item.path)
      if (holdExport) await new Promise<void>(resolve => { releaseExport = resolve })
      return { status: 'exported', bundle_path: '/output/codex-worklog/bundle', generated_files: ['index.md'], refreshed: false, folder_opened: !failFolderAfterExport, folder_open_error: failFolderAfterExport ? 'Synthetic folder failure' : null }
    }
    if (command === 'plugin:dialog|open') return args?.options?.directory ? (cancelExport ? null : '/output') : items[0].path
    throw new Error('Unexpected command: ' + command)
  },
}
const button = (text: string) => Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)!
const click = async (element: HTMLElement | null) => { assert(element, 'click target exists'); element!.click(); await settle() }
const row = (index: number) => target.querySelector<HTMLButtonElement>(`.session-entry[data-entry-key="${index}"]`)
const mode = () => target.querySelector('[data-navigator-mode]')?.textContent
const toggle = async () => { await click(target.querySelector('.navigator-mode button')); verifyNavigatorHeader() }
const reloadButton = () => target.querySelector<HTMLButtonElement>('[aria-label="Reload Sessions"]')!
const entries = () => Array.from(target.querySelectorAll('.session-entry'))
const scrollBottom = async () => { const list = target.querySelector('.navigator-list')!; list.scrollTop = list.scrollHeight; list.dispatchEvent(new Event('scroll')); await settle() }
const status = () => target.querySelector('[data-status]')?.getAttribute('data-status')

function verifyNavigatorHeader() {
  const heading = target.querySelector('.navigator-heading')!
  const footer = target.querySelector('[aria-label="Sessions scroll actions"]')!
  const badge = footer.querySelector<HTMLElement>('[data-navigator-mode]')!
  const title = heading.querySelector('h2')!
  const switcher = heading.querySelector<HTMLButtonElement>('.navigator-mode button')!
  const nextMode = mode() === 'Flat' ? 'Hierarchical' : 'Flat'
  assert(!target.querySelector('.navigator-summary, .navigator-count'), 'second header row and separate count removed')
  assert(badge && !heading.querySelector('[data-navigator-mode]'), 'mode badge only appears in footer')
  const first = heading.getBoundingClientRect(), bottom = footer.getBoundingClientRect()
  const label = badge.getBoundingClientRect(), text = title.getBoundingClientRect()
  const icons = heading.querySelector('.navigator-mode')!.getBoundingClientRect()
  const top = footer.querySelector('button')!.getBoundingClientRect()
  assert(text.right <= icons.left && text.height <= first.height && title.scrollWidth <= title.clientWidth, 'single-row title fits beside icons')
  assert(Math.abs(icons.right - first.right) < 1 && heading.querySelectorAll('button').length === 2, 'header icons stay right aligned')
  assert(Math.abs(label.left - bottom.left - 8) < 1 && label.right <= top.left && label.top >= bottom.top && label.bottom <= bottom.bottom, 'badge aligns left in footer without overlap')
  assert(badge.scrollWidth <= badge.clientWidth, 'complete mode name is visible')
  assert(switcher.title === `Switch to ${nextMode} mode` && switcher.getAttribute('aria-label') === switcher.title, 'mode action explains destination')
  assert(switcher.querySelectorAll('rect').length === (mode() === 'Flat' ? 0 : 3), 'mode icon reflects current list or hierarchy')
}

function verifyHeaderAlignment() {
  const content = ['.selected-path-row strong', '.selection-metadata dd', '.appearance-controls', '.filter-group[data-filter-layer="core"]', '.status-line-text']
    .map(q => target.querySelector(q)!.getBoundingClientRect().left)
  assert(Math.max(...content) - Math.min(...content) < 0.02, 'metadata, Resume, Filters and Status share the content start')
  const labels = ['.selected-path-row > span', '.selection-metadata dt', '.style-label', '.filter-bar h2', '.status-line-label']
    .map(q => target.querySelector(q)!.getBoundingClientRect().left)
  assert(Math.max(...labels) - Math.min(...labels) < 0.02, 'upper row labels share the title start')
  const rows = ['.filter-bar', '.status-line'].map(q => target.querySelector(q)!.getBoundingClientRect())
  assert(rows.every(r => Math.abs(r.height - 44) < 0.02), 'both control rows have the same compact height')
  const session = target.querySelector('.selection-metadata')!.getBoundingClientRect()
  const resume = target.querySelector('.resume-row')!.getBoundingClientRect()
  const copy = target.querySelector('.resume-row button')!.getBoundingClientRect()
  const resumeLabel = target.querySelector<HTMLElement>('.resume-row > span')!
  assert(getComputedStyle(resumeLabel).whiteSpace === 'nowrap' && resumeLabel.getBoundingClientRect().height <= 16, 'Resume command label fits one line')
  assert(Math.abs(session.width - resume.width) < 0.02 && Math.abs(session.top - resume.top) < 0.02, 'Session ID and Resume use equal half columns')
  assert(Math.abs(copy.right - resume.right) < 0.02, 'Resume copy stays at the right edge')
  for (const label of target.querySelectorAll('.header-selector > span:first-child')) {
    const style = getComputedStyle(label)
    assert(style.fontSize === '9px' && style.fontWeight === '600', 'appearance sublabels are smaller and lighter than Style')
  }
  const selects = [...target.querySelectorAll<HTMLSelectElement>('.appearance-row select')]
  assert(selects.length === 3 && target.querySelectorAll('.app-header select').length === 3, 'exactly three selectors in one row')
  const selectRects = selects.map(e => e.getBoundingClientRect())
  assert(selectRects.every(r => Math.abs(r.top - selectRects[0].top) < 0.02 && r.height === 28), 'selectors share height and alignment')
  for (const select of selects) {
    const style = getComputedStyle(select)
    const field = select.parentElement!
    const label = field.previousElementSibling!.getBoundingClientRect()
    assert(Math.abs(select.getBoundingClientRect().left - label.right - 6) < 0.02, 'labels stay close to selects')
    assert(select.getBoundingClientRect().width === 180, 'selects stay compact instead of filling row thirds')
    const arrow = field.querySelector('.select-chevron')!.getBoundingClientRect()
    assert(parseFloat(style.paddingRight) >= 36 && style.appearance === 'none', 'shared text reserve and explicit arrow')
    assert(Math.abs(select.getBoundingClientRect().right - arrow.right - 12) < 0.02, 'arrow has consistent inset')
  }
  const pixels = rows.map(r => Math.round(r.bottom * devicePixelRatio) - Math.round(r.top * devicePixelRatio))
  assert(pixels[0] === pixels[1], 'physical pixel row heights agree at the active DPI')
}

function verifyOuterBackgrounds() {
  verifyHeaderAlignment()
  const grid = target.querySelector('.observatory-workspace')!.getBoundingClientRect()
  const panels = [target.querySelector('.workspace-transcript')!, ...['#sessions-panel', '#collection-panel'].map(id => target.querySelector<HTMLElement>(id)!).filter(e => !e.hidden).map(e => e.firstElementChild!)]
  for (const panel of panels) {
    const box = panel.getBoundingClientRect()
    assert(Math.abs(box.top - grid.top) < 1 && Math.abs(box.bottom - grid.bottom) < 1, 'all visible panel frames share Grid boundaries')
    assert(getComputedStyle(panel).position !== 'sticky', 'panel has no sticky correction')
    assert(getComputedStyle(panel).overflow === 'hidden', 'frame clips scrollbars within rounded corners')
  }
  assert(document.documentElement.scrollHeight <= innerHeight + 1 && scrollY === 0, 'conversation content never scrolls the page')
  for (const element of target.querySelectorAll<HTMLElement>('.panel-scroll')) {
    if (!element.getClientRects().length) continue
    assert(getComputedStyle(element).overflowY === 'auto' && element.tabIndex === 0, 'each scroll body supports keyboard and independent scrolling')
  }
  assert(!target.querySelector('[aria-label="Scroll to Bottom"]'), 'global Bottom control removed')
  assert(target.querySelector('.navigator-heading h2')?.textContent?.startsWith('Sessions (') && target.querySelector('.transcript-heading h2')?.textContent === 'Transcript', 'workspace titles are consistent')
  assert(!target.querySelector('.terminal-title, .markdown-document-header h2, .chat-transcript-header strong'), 'no duplicate renderer title')
  for (const footer of target.querySelectorAll<HTMLElement>('.panel-scroll-actions')) {
    if (!footer.getClientRects().length) continue
    const buttons = [...footer.querySelectorAll('button')]
    assert(buttons.length === 2 && buttons.every(button => button.textContent?.trim() === '' && button.querySelector('svg')), 'footers contain only two icon controls')
    const boxes = buttons.map(button => button.getBoundingClientRect())
    const box = footer.getBoundingClientRect()
    assert(boxes.every(rect => rect.width === 28 && rect.height === 28) && Math.abs(boxes[1].left - boxes[0].right - 6) < 1 && Math.abs(box.right - boxes[1].right - 8) < 1, 'footer size, gap and right alignment are uniform')
  }
  for (const button of target.querySelectorAll<HTMLButtonElement>('.observatory-workspace .panel-icon-button')) {
    assert(button.title && button.title === button.getAttribute('aria-label'), 'icon tooltip and accessible name explain the action')
  }
  const heading = target.querySelector('.transcript-heading')!
  const title = heading.querySelector('h2')!.getBoundingClientRect()
  const actions = heading.querySelector('.transcript-actions')!.getBoundingClientRect()
  assert(title.right <= actions.left && Math.abs(heading.getBoundingClientRect().right - actions.right) < 1, 'Transcript header actions align right without overlap')
}

let workspaceInstance: ReturnType<typeof mount> | undefined
let workspaceItems = ''
let workspaceList: Element | null
;(globalThis as any).__workspaceStart = async () => {
  workspaceInstance = mount(App, { target }); await settle()
  await click(target.querySelector('[aria-label="Show Collection"]'))
  const separator = target.querySelector<HTMLElement>('[aria-label="Resize Sessions"]')!
  separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await settle()
  for (const theme of ['DM Style', 'DM Style (Dark)']) {
    const select = target.querySelector('.theme-selector select')!
    select.value = theme; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
    const header = target.querySelector('.chat-transcript-header')!
    const title = header.firstElementChild!.getBoundingClientRect()
    const notice = header.querySelector('.chat-empty-state')!.getBoundingClientRect()
    assert(title.right <= notice.left || title.bottom <= notice.top || notice.right <= title.left, 'idle DM title and notice do not overlap')
  }
  const themeSelect = target.querySelector('.theme-selector select')!
  themeSelect.value = 'Terminal Style'; themeSelect.dispatchEvent(new Event('change', { bubbles: true })); await settle()
  separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); await settle()
  for (let step = 0; step < 4; step++) {
    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await settle()
  }
  await scrollBottom(); await scrollBottom()
  await click(row(0))
  await click(target.querySelector('.terminal-block [aria-label="Add to Collection"]'))
  workspaceItems = target.querySelector('#collection-panel')!.textContent!
  workspaceList = target.querySelector('.navigator-list')
}
;(globalThis as any).__workspaceCombination = async (left: boolean, right: boolean, theme: string) => {
  const before = target.querySelector('.workspace-transcript')!.firstElementChild
  const block = target.querySelector('.terminal-block, .chat-block, .markdown-block')
  for (const [id, open, name] of [['sessions-panel', left, 'Sessions'], ['collection-panel', right, 'Collection']] as const) {
    const panel = target.querySelector<HTMLElement>('#' + id)!
    if (panel.hidden === open) await click(target.querySelector(`[aria-label="${open ? 'Show' : 'Hide'} ${name}"]`))
  }
  assert(target.querySelector('.workspace-transcript')!.firstElementChild === before && (!block || target.contains(block)), 'Transcript survives toggles')
  const select = target.querySelector('.theme-selector select')!
  select.value = theme; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
  const transcript = target.querySelector('.workspace-transcript')!.getBoundingClientRect()
  const workspace = target.querySelector('.observatory-workspace')!.getBoundingClientRect()
  assert(transcript.width >= 359, 'Transcript minimum at ' + innerWidth)
  assert(target.querySelectorAll('[role="separator"]').length === Number(left) + Number(right), 'visible boundaries only')
  assert(target.querySelector('.navigator-list') === workspaceList && entries().length === 43, 'Navigator stays mounted with pages')
  assert(target.querySelector('#collection-panel')!.textContent === workspaceItems, 'collection snapshots preserved')
  assert(row(0)?.getAttribute('aria-current') === 'true', 'selected session preserved')
  if (!left && !right) assert(Math.abs(transcript.width - workspace.width) < 1, 'Transcript expands to full workspace')
  assert(document.documentElement.scrollWidth <= innerWidth, 'no page horizontal overflow')
  verifyOuterBackgrounds()
  return { transcript: transcript.width, workspace: workspace.width }
}
;(globalThis as any).__workspaceTree = async () => {
  await toggle()
  const day = target.querySelector<HTMLDetailsElement>('.navigator-day')!
  day.open = false
  const list = target.querySelector<HTMLElement>('.navigator-list')!
  list.scrollTop = 40
  const scroll = list.scrollTop
  const counts = [reloads, flatCalls, hierarchyCalls]
  await click(target.querySelector('[aria-label="Hide Sessions"]'))
  await click(target.querySelector('[aria-label="Show Sessions"]'))
  assert(day === target.querySelector('.navigator-day') && !day.open, 'tree expansion survives hiding')
  assert(list.scrollTop === scroll && mode() === 'Hierarchical', 'mode and scroll retained')
  assert(JSON.stringify(counts) === JSON.stringify([reloads, flatCalls, hierarchyCalls]), 'toggle does not fetch')
  day.open = true
  await click(button('Refresh'))
  assert(target.querySelector('#collection-panel')!.textContent === workspaceItems, 'Refresh preserves Collection')
  await click(reloadButton())
  assert(target.querySelector('#collection-panel')!.textContent === workspaceItems, 'Reload preserves Collection')
  await click(row(1))
  assert((target.querySelector('#collection-panel') as HTMLElement).hidden && !target.querySelector('#collection-panel article'), 'session change still clears and closes')
}
;(globalThis as any).__workspaceStop = async () => { await unmount(workspaceInstance!); workspaceInstance = undefined }

;(globalThis as any).__heightStart = async () => {
  workspaceInstance = mount(App, { target }); await settle()
  await click(target.querySelector('[aria-label="Show Collection"]'))
}
;(globalThis as any).__widthStart = async () => {
  await (globalThis as any).__heightStart()
  widthFixture = true
}
;(globalThis as any).__widthLoad = async (specialized = false) => {
  specializedFixture = specialized
  await click(row(0))
  for (const checkbox of target.querySelectorAll<HTMLInputElement>('.filter-bar input')) {
    if (!checkbox.checked) { checkbox.checked = true; checkbox.dispatchEvent(new Event('change',{bubbles:true})) }
  }
  await settle()
}
;(globalThis as any).__widthCheck = async (theme: string, left: boolean, right: boolean) => {
  await (globalThis as any).__heightCheck(theme,left,right)
  const frame = target.querySelector<HTMLElement>('.workspace-transcript')!
  const viewport = target.querySelector<HTMLElement>('.transcript-viewport')!
  const root = viewport.querySelector<HTMLElement>('.transcript-presentation,.specialized-session')!
  const style = getComputedStyle(root)
  assert(style.paddingLeft === '18px' && style.paddingRight === '18px', 'all presentations share the horizontal inset')
  assert(viewport.scrollWidth <= viewport.clientWidth && document.documentElement.scrollWidth <= innerWidth, 'long content never widens viewport or page')
  const inner = root.clientWidth - 36
  for (const column of root.querySelectorAll<HTMLElement>('.markdown-document-header,.markdown-blocks,.markdown-notice,.chat-transcript-header,.chat-blocks,.chat-notice,.specialized-session-description,.specialized-session-identity')) {
    assert(Math.abs(column.getBoundingClientRect().width-inner) < 1, 'content uses full allocated track: ' + column.className)
  }
  for (const bubble of root.querySelectorAll<HTMLElement>('.chat-block')) {
    const narrow = target.querySelector<HTMLElement>('.transcript-content')!.clientWidth <= 680
    const technical = ['meta','tool','result','unknown'].includes(bubble.dataset.family!)
    const ratio = narrow ? 0.92 : technical ? 0.82 : 0.72
    assert(Math.abs(bubble.getBoundingClientRect().width-inner*ratio)<1, 'bubbles scale with the track without a pixel cap')
  }
  if (root.querySelector('.message-content')) {
    assert(root.querySelector('.message-code-block code')?.textContent === widthCode + '\n', 'code source and indentation preserved')
    assert(root.querySelector('.message-table-scroll'), 'wide Markdown table keeps its own scroll container')
    for (const table of root.querySelectorAll<HTMLElement>('.message-table-scroll')) {
      assert(table.scrollWidth > table.clientWidth, 'wide table scrolls locally')
      assert(table.getBoundingClientRect().right <= viewport.getBoundingClientRect().right, 'table stays inside viewport')
    }
  }
  return {frame:[frame.getBoundingClientRect().x,frame.getBoundingClientRect().width],viewport:[viewport.getBoundingClientRect().x,viewport.getBoundingClientRect().width],track:inner}
}
;(globalThis as any).__widthStop = async () => {
  widthFixture = false; specializedFixture = false
  await (globalThis as any).__workspaceStop()
}
;(globalThis as any).__heightLoad = async () => {
  await click(row(0)); await click(target.querySelector('[aria-label="Add to Collection"]'))
}
;(globalThis as any).__heightCheck = async (theme: string, left: boolean, right: boolean, empty = false) => {
  window.scrollTo(0, 0)
  for (const [id, open, name] of [['sessions-panel', left, 'Sessions'], ['collection-panel', right, 'Collection']] as const) {
    if ((target.querySelector('#' + id) as HTMLElement).hidden === open) await click(target.querySelector(`[aria-label="${open ? 'Show' : 'Hide'} ${name}"]`))
  }
  const select = target.querySelector('.theme-selector select')!
  select.value = theme; select.dispatchEvent(new Event('change', { bubbles: true })); await settle(); await settle()
  verifyOuterBackgrounds()
  assert(target.querySelector('.collection-panel [aria-label="Collection scroll actions"]'), 'Collection keeps local scroll actions inside frame')
}
;(globalThis as any).__heightLong = async () => {
  const select = target.querySelector('.theme-selector select')!
  select.value = 'Terminal Style'; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
  longMessages = true; await click(button('Refresh')); await click(button('Clear Collection'))
  await click(target.querySelector('[aria-label="Add to Collection"]'))
  const transcript = target.querySelector<HTMLElement>('.transcript-viewport')!
  const collection = target.querySelector<HTMLElement>('.collection-body')!
  const list = target.querySelector<HTMLElement>('.navigator-list')!
  assert(transcript.scrollHeight > transcript.clientHeight * 2 && collection.scrollHeight > collection.clientHeight * 2, 'long content stays inside bounded bodies')
  transcript.scrollTop = 180; collection.scrollTop = 140; list.scrollTop = 80
  await settle()
  const retained = [transcript.scrollTop, collection.scrollTop, list.scrollTop]
  await click(button('Refresh'))
  assert(JSON.stringify(retained) === JSON.stringify([transcript.scrollTop, collection.scrollTop, list.scrollTop]), 'same-session Refresh preserves all scroll offsets')
  for (const name of ['Sessions','Collection']) {
    await click(target.querySelector(`[aria-label="Hide ${name}"]`)); await click(target.querySelector(`[aria-label="Show ${name}"]`))
  }
  assert(JSON.stringify(retained) === JSON.stringify([transcript.scrollTop, collection.scrollTop, list.scrollTop]), 'hide and restore preserves scroll positions')
  await scrollBottom(); await scrollBottom()
  assert(entries().length === 43, 'independent Navigator retains pagination')
  verifyOuterBackgrounds()
}
;(globalThis as any).__independentScrollActions = async () => {
  const selectors = ['.navigator-list', '.transcript-viewport', '.collection-body']
  const names = ['Sessions','Transcript','Collection']
  for (let index = 0; index < selectors.length; index++) {
    const bodies = selectors.map(selector => target.querySelector<HTMLElement>(selector)!)
    bodies.forEach(body => { body.scrollTop = 80 })
    const original = bodies.map(body => body.scrollTop)
    for (const edge of ['Bottom','Top']) {
      await click(target.querySelector(`[aria-label="Scroll ${names[index]} to ${edge}"]`))
      await new Promise(resolve => setTimeout(resolve, 260)); await settle()
      const expected = edge === 'Top' ? 0 : bodies[index].scrollHeight - bodies[index].clientHeight
      assert(Math.abs(bodies[index].scrollTop - expected) < 2, 'local ' + names[index] + ' ' + edge + ' reaches destination')
      assert(bodies.every((body, i) => i === index || body.scrollTop === original[i]), 'local navigation preserves other panel offsets')
      verifyOuterBackgrounds()
    }
  }
  assert(!target.querySelector('[aria-label="Scroll to Bottom"]'), 'global Bottom removed')
}
;(globalThis as any).__backgroundCollectionLong = async () => {
  const retained = target.querySelector('#collection-panel')!.textContent
  longMessages = false; await click(button('Refresh')); await settle()
  const body = target.querySelector<HTMLElement>('.collection-body')!
  assert(target.querySelector('#collection-panel')!.textContent === retained && body.scrollHeight > body.clientHeight, 'long Collection survives Refresh to short Transcript')
  verifyOuterBackgrounds()
}
;(globalThis as any).__verifyOuterBackgrounds = verifyOuterBackgrounds

;(globalThis as any).__contextCase = async () => {
  const instance = mount(App, { target }); await settle()
  const menu = () => document.querySelector<HTMLElement>('[role="menu"]')
  const openMenu = async (index: number, x = innerWidth - 1, y = innerHeight - 1) => {
    row(index)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })); await settle()
    assert(menu(), 'individual session opens menu')
    const box = menu()!.getBoundingClientRect()
    assert(box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, 'menu clamps to viewport')
    assert(menu()!.parentElement === document.body && getComputedStyle(menu()!).position === 'fixed', 'menu escapes panel overflow')
    assert([...menu()!.querySelectorAll('button')].map(b => b.textContent).join('|') === 'Open|Open Containing Folder|Export Worklog', 'exact menu order')
  }
  const choose = async (label: string) => click([...menu()!.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)!)
  try {
    await click(row(0)); await click(target.querySelector('[aria-label="Add to Collection"]'))
    const transcript = target.querySelector('.terminal-block')
    const collected = target.querySelector('#collection-panel')!.textContent
    const preserved = () => {
      assert(target.querySelector('.terminal-block') === transcript, 'context action preserves Transcript DOM')
      assert(target.querySelector('#collection-panel')!.textContent === collected && !(target.querySelector('#collection-panel') as HTMLElement).hidden, 'context action preserves Collection')
      assert(row(0)!.getAttribute('aria-current') === 'true' && status() === 'loaded', 'context action preserves selected session')
    }
    assert(row(0)!.getAttribute('aria-haspopup') === 'menu', 'session advertises its context menu')
    assert(!target.textContent?.includes('Session list warnings') && !target.textContent?.includes('database_unavailable'), 'internal diagnostics are not rendered')
    const info = row(3)!.closest('.session-entry-row')!.querySelector('.session-info-button')!
    info.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 })); await settle()
    assert(menu(), 'Info is also inside the individual session context target'); preserved()
    menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle()
    for (const hierarchical of [false, true]) {
      if (hierarchical) await toggle()
      for (const index of [1,2]) {
        await openMenu(index); preserved()
        await choose('Open Containing Folder'); preserved()
        assert(!target.textContent?.includes('Session folder opened.'), 'folder success is silent')
        assert(folderTargets.at(-1) === items[index].path && !menu(), 'folder uses right-clicked plain/compressed session')
        await openMenu(index); await choose('Export Worklog'); preserved()
        assert(exportedTargets.at(-1) === items[index].path && target.querySelector('.status-line-text')?.textContent?.startsWith('Worklog exported successfully:'), 'export uses unselected session and shared success feedback')
      }
      await openMenu(1)
      menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle()
      assert(!menu() && document.activeElement === row(1), 'Escape closes and restores anchor focus')
      row(1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })); await settle()
      assert(menu() && document.activeElement === menu()!.querySelector('button'), 'Shift F10 opens focused menu')
      menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await settle()
      assert(document.activeElement?.textContent === 'Export Worklog', 'End selects final action')
      menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await settle()
      assert(document.activeElement?.textContent === 'Open', 'ArrowDown wraps')
      menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle()
      if (hierarchical) {
        target.querySelector('.navigator-day summary')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await settle()
        assert(!menu(), 'date group has no session menu')
      }
    }
    await openMenu(1)
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await settle(); assert(!menu(), 'outside click dismisses')
    await openMenu(1); window.dispatchEvent(new Event('resize')); await settle(); assert(!menu(), 'resize dismisses')
    await openMenu(1); target.querySelector('.navigator-list')!.dispatchEvent(new Event('scroll')); await settle(); assert(!menu(), 'scroll dismisses')
    await openMenu(1); await click(target.querySelector('[aria-label="Hide Sessions"]')); assert(!menu(), 'hidden panel dismisses portal menu')
    await click(target.querySelector('[aria-label="Show Sessions"]'))
    await openMenu(1); await click(reloadButton()); assert(!menu(), 'Reload dismisses old menu')
    const count = exportedTargets.length
    cancelExport = true; await openMenu(1); await choose('Export Worklog'); preserved()
    assert(exportedTargets.length === count && target.querySelector('.status-line-text')?.textContent === 'Worklog export cancelled.', 'cancel does not export and reports no success')
    cancelExport = false
    failExport = true; await openMenu(1); await choose('Export Worklog'); preserved()
    assert(target.querySelector('.status-line')?.textContent?.includes('Target not safe to overwrite.'), 'export failure after directory selection is visible')
    failExport = false
    failFolderAfterExport = true; await openMenu(1); await choose('Export Worklog'); preserved()
    assert(target.querySelector('.status-line')?.textContent?.includes('folder could not be opened'), 'folder failure after export remains visible')
    failFolderAfterExport = false
    failAction = 'navigator_snapshot_expired'; await openMenu(1); await choose('Open Containing Folder'); preserved()
    assert(target.querySelector('.status-line')?.textContent?.includes('Reload Sessions'), 'expiry gives reload recovery')
    failAction = 'navigator_source_changed'; await openMenu(1); await choose('Open'); preserved()
    assert(target.querySelector('.status-line')?.textContent?.includes('Synthetic action failure'), 'changed identity does not load')
    failAction = ''; holdExport = true; await openMenu(1); await choose('Export Worklog')
    assert(reloadButton().disabled && row(2)!.disabled, 'pending export blocks conflicting navigator actions')
    assert(!/Preparing Worklog export|Opening…|Exporting worklog/.test(target.textContent ?? ''), 'context progress is silent throughout the app')
    row(2)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await settle(); assert(!menu(), 'no second action while busy')
    holdExport = false; releaseExport!(); await settle(); preserved()
    await openMenu(1); await choose('Open')
    assert(parses.at(-1) === items[1].path && row(1)!.getAttribute('aria-current') === 'true', 'Open follows existing selection')
    assert((target.querySelector('#collection-panel') as HTMLElement).hidden && !target.querySelector('#collection-panel article'), 'Open resets Collection on session change')
    await click(target.querySelector('[aria-label="Add to Collection"]'))
    const sameSessionCollection = target.querySelector('#collection-panel')!.textContent
    await openMenu(1); await choose('Open')
    assert(!(target.querySelector('#collection-panel') as HTMLElement).hidden && target.querySelector('#collection-panel')!.textContent === sameSessionCollection, 'Open same session preserves Collection like Refresh')
    for (const theme of ['Terminal Style','DM Style (Dark)','DM Style','Markdown Style']) {
      const select = target.querySelector('.theme-selector select')!
      select.value = theme; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
      await openMenu(2)
      assert(menu()!.dataset.theme === theme, 'menu follows theme')
      const box = menu()!.getBoundingClientRect()
      const label = menu()!.querySelectorAll('button')[1]
      assert(getComputedStyle(label).fontSize === '12px' && label.getBoundingClientRect().height === 24, 'compact font and item height')
      assert(label.scrollWidth <= label.clientWidth && getComputedStyle(label).whiteSpace === 'nowrap', 'long label fits on one line')
      menu()!.style.font = '16px/24px var(--sans)'; menu()!.style.padding = '4px'
      for (const button of menu()!.querySelectorAll('button')) button.style.padding = '8px 12px'
      const original = menu()!.getBoundingClientRect()
      assert(box.width / original.width >= .5 && box.width / original.width <= .75 && box.height / original.height >= .5 && box.height / original.height <= .75, 'menu dimensions are 50–75 percent of original')
      ;(globalThis as any).__menuMeasurements = { width: box.width, height: box.height, originalWidth: original.width, originalHeight: original.height }
      menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle()
    }
    cancelExport = true; await click(button('Export Worklog'))
    assert(target.querySelector('.status-line-text')?.textContent === 'Worklog export cancelled.', 'existing top Export keeps cancellation status')
    cancelExport = false; await click(button('Export Worklog'))
    const topStatus = target.querySelector('.status-line-text')!.textContent
    assert(topStatus?.includes('Worklog exported successfully:'), 'existing top Export keeps success status')
    await openMenu(2); await choose('Export Worklog')
    assert(target.querySelector('.status-line-text')!.textContent === topStatus, 'context and toolbar Export share the common success feedback')
  } finally { await unmount(instance) }
  assert(!menu(), 'portal menu removed on unmount')
}

async function verifyUntitled() {
  const originalParses = parses.length
  const originalStatus = status()
  const active = target.querySelector('.session-entry.active')?.getAttribute('data-entry-key')
  const originalTranscript = target.querySelector('.terminal-block')
  const collection = target.querySelector('#collection-panel') as HTMLElement
  const collectionHidden = collection.hidden
  const collectionText = collection.textContent
  const ids: string[] = []
  for (const [index, text] of [[3, '01a16795 · Title not found on this device.'], [4, '01a16646 · Title not found on this device.'], [5, 'Title not found on this device.']] as const) {
    const select = row(index)!
    const group = select.closest('.session-entry-row')!
    const info = group.querySelector<HTMLButtonElement>('.session-info-button')!
    const wrapper = group.querySelector<HTMLElement>('.session-title-info')!
    const id = info.getAttribute('aria-describedby')!
    const tooltip = document.getElementById(id)!
    info.scrollIntoView({ block: 'nearest' }); await settle()
    ids.push(id)
    assert(select.querySelector('.session-title')?.textContent === 'Untitled Session' && select.title === 'Untitled Session', 'missing title display ' + index)
    assert(!select.contains(info) && tooltip.getAttribute('role') === 'tooltip', 'Info is independent and described by tooltip')
    assert(tooltip.textContent === text, 'exact dynamic tooltip ' + index)
    assert(getComputedStyle(tooltip).visibility === 'hidden', 'tooltip starts hidden')
    wrapper.dispatchEvent(new MouseEvent('mouseenter')); await settle()
    assert(getComputedStyle(tooltip).visibility === 'visible', 'hover opens tooltip')
    const bounds = tooltip.getBoundingClientRect()
    assert(bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight, 'tooltip stays in viewport')
    wrapper.dispatchEvent(new MouseEvent('mouseleave')); await settle()
    assert(getComputedStyle(tooltip).visibility === 'hidden', 'mouse leave closes tooltip')
    info.focus(); await settle()
    assert(document.activeElement === info && getComputedStyle(tooltip).visibility === 'visible', 'keyboard focus opens tooltip ' + index + ': ' + JSON.stringify({focused:document.activeElement === info,visibility:getComputedStyle(tooltip).visibility,anchor:info.getBoundingClientRect().toJSON(),list:target.querySelector('.navigator-list')!.getBoundingClientRect().toJSON()}))
    for (const key of ['Enter', ' ']) {
      info.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      info.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
      await click(info)
    }
    info.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle()
    assert(getComputedStyle(tooltip).visibility === 'hidden' && document.activeElement === info, 'Escape dismisses without moving focus')
    info.blur(); await settle()
  }
  assert(new Set(ids).size === ids.length, 'duplicate titles keep unique tooltip IDs')
  assert(!row(6)!.closest('.session-entry-row')!.querySelector('.session-info-button'), 'real metadata title named Untitled Session has no Info')
  assert(parses.length === originalParses && status() === originalStatus, 'Info never loads a transcript')
  assert(target.querySelector('.session-entry.active')?.getAttribute('data-entry-key') === active && target.querySelector('.terminal-block') === originalTranscript, 'Info preserves selection and transcript')
  assert(collection.hidden === collectionHidden && collection.textContent === collectionText, 'Info preserves Collection')
}

async function verifyDuplicateSelection() {
  for (const index of [3, 4]) {
    await click(row(index))
    assert(parses.at(-1) === items[index].path && row(index)?.getAttribute('aria-current') === 'true', 'same display title selects its own file ' + index)
    assert(target.querySelectorAll('.session-entry.active').length === 1, 'only one duplicate title is selected')
    assert(!target.querySelector('.navigator-selected') && !target.querySelector('.session-navigator')!.textContent?.includes('Selected:'), 'selection uses list highlight without a duplicate summary')
  }
}

;(globalThis as any).__navigatorCase = async () => {
  const instance = mount(App, { target })
  try {
    await settle()
    assert(reloads === 1 && entries().length === 20, 'automatic first 20')
    assert(mode() === 'Flat' && status() === 'idle', 'separate initial mode and load badges')
    assert(target.querySelector('.navigator-heading h2')?.textContent === 'Sessions (43)', 'total session count retained')
    assert(!target.querySelector('.navigator-selected') && !target.textContent?.includes('Archived sessions are not shown.'), 'removed redundant summary and notice stay absent')
    assert(target.querySelector('.navigator-heading h2')?.textContent?.startsWith('Sessions ('), 'left region title')
    assert(target.querySelector('#app-title')?.textContent === 'Codex Session Observatory', 'official app title preserved')
    assert(target.querySelector('.transcript-heading h2')?.textContent === 'Transcript', 'central region title')
    assert(reloadButton().title === 'Reload Sessions' && reloadButton().textContent?.trim() === '', 'icon has tooltip and accessible name without visible text')
    assert(target.querySelector('.navigator-mode button')?.nextElementSibling === reloadButton(), 'Reload follows mode switch')
    target.querySelector('[aria-label="Resize Sessions"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); await settle()
    verifyNavigatorHeader()
    assert(reloadButton().getBoundingClientRect().width <= 32, 'Reload remains compact')
    assert(entries().every((entry, i) => entry.getAttribute('data-entry-key') === String(i)), 'creation order preserved')
    assert(row(0)?.title === items[0].title, 'full long title available')
    await verifyUntitled()
    for (const [index, weight] of [[0, '400'], [1, '500'], [2, '600'], [3, '400']] as const) {
      assert(getComputedStyle(row(index)!.querySelector('.session-title')!).fontWeight === weight, 'conversation weight ' + index)
    }
    holdPage = true
    await scrollBottom(); await scrollBottom()
    assert(flatCalls === 1, 'duplicate scrolling shares in-flight page')
    holdPage = false; releasePage!(); await settle()
    assert(entries().length === 40, 'second 20 appended')
    await scrollBottom(); assert(entries().length === 43 && flatCalls === 2, 'last partial page')
    await scrollBottom(); assert(flatCalls === 2, 'stop at end')

    await click(row(0)); assert(status() === 'loaded' && parses.at(-1) === items[0].path, 'plain selection uses transcript flow')
    await click(target.querySelector('.terminal-block [aria-label="Add to Collection"]'))
    const collection = target.querySelector('#collection-panel') as HTMLElement
    const preservedText = collection.textContent
    const transcript = target.querySelector('.terminal-block')
    const verifyRetained = (label: string) => {
      assert(!collection.hidden && collection.textContent === preservedText, label + ': collection retained')
      assert(target.querySelector('.terminal-block') === transcript, label + ': transcript DOM retained')
      assert(row(0)?.getAttribute('aria-current') === 'true', label + ': selection retained')
      assert(status() === 'loaded', label + ': loaded badge retained')
      assert(target.querySelector('.selected-path-row')?.textContent?.includes('0.jsonl'), label + ': top session information retained')
      assert(target.querySelector('.navigator-heading h2')?.textContent === 'Sessions (43)', label + ': total count retained')
      assert(!target.querySelector('.navigator-selected'), label + ': no redundant selected summary')
    }
    await toggle(); assert(mode() === 'Hierarchical' && hierarchyCalls === 1, 'tree mode')
    assert(entries().length === 43 && target.querySelectorAll('.navigator-unfiled .session-entry').length === 1, 'unfiled preserved')
    await verifyUntitled()
    assert(row(42)?.querySelector('.session-title')?.textContent === 'Untitled Session' && row(42)?.closest('.session-entry-row')?.querySelector('[role="tooltip"]')?.textContent === 'Title not found on this device.', 'unfiled fallback uses same presentation')
    verifyRetained('mode switch')
    for (const selector of ['.navigator-year', '.navigator-month', '.navigator-day']) {
      const details = target.querySelector<HTMLDetailsElement>(selector)!
      await click(details.querySelector('summary')); assert(!details.open, selector + ' collapses')
      await click(details.querySelector('summary')); assert(details.open, selector + ' expands')
    }
    await toggle(); verifyRetained('back to Flat'); assert(parses.length === 1, 'mode does not parse transcript')
    holdReload = true; await click(reloadButton())
    assert(reloadButton().disabled && target.textContent?.includes('Loading sessions'), 'Reload loading state and disabled icon')
    assert(target.querySelector('.terminal-block') === transcript && collection.textContent === preservedText, 'pending Reload preserves workspace')
    holdReload = false; releaseReload!(); await settle()
    verifyRetained('Reload'); assert(!reloadButton().disabled && entries().length === 20, 'Reload resets pages and enables icon')
    await toggle(); assert(hierarchyCalls === 2, 'new hierarchy after Reload'); verifyRetained('reloaded hierarchy')
    await click(button('Refresh')); verifyRetained('Refresh'); assert(reloads === 2, 'Refresh does not Reload list')
    await click(row(1)); assert(parses.at(-1)?.endsWith('.jsonl.zst') && collection.hidden, 'compressed selection resets and closes collection')
    assert(collection.querySelectorAll('article').length === 0, 'old selection cleared')
    await verifyDuplicateSelection()
    failParse = true; await click(row(2)); assert(status() === 'error' && target.textContent?.includes('Session cannot be read'), 'parse error shown')
    failParse = false; await click(button('Refresh')); assert(status() === 'loaded', 'parse retry')
    await toggle()
    await verifyDuplicateSelection()
    failReload = true; await click(reloadButton())
    assert(target.textContent?.includes('Cannot read sessions') && status() === 'loaded', 'list error independent')
    failReload = false; await click(button('Retry Sessions')); assert(entries().length === 20, 'Reload retry')
    expirePage = true; await scrollBottom(); assert(target.textContent?.includes('session list has expired'), 'expiry shown')
    expirePage = false; const prior = reloads; await click(button('Retry Sessions')); assert(reloads === prior + 1, 'expiry retry creates snapshot')
    await click(row(0)); assert(row(0)?.getAttribute('aria-current') === 'true', 'file picker shares active state')
    for (const theme of ['Terminal Style', 'DM Style (Dark)', 'DM Style', 'Markdown Style']) {
      const select = target.querySelector('.theme-selector select')!
      const option = Array.from(select.options).find(option => option.value === theme)
      if (!option) continue
      select.value = theme; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
      assert(target.querySelector('.session-navigator')?.getAttribute('data-theme') === theme, 'theme forwarded')
      verifyNavigatorHeader()
      await toggle(); verifyNavigatorHeader(); await toggle()
      assert(target.querySelector('.transcript-heading h2')?.textContent === 'Transcript', 'central title in ' + theme)
      assert(target.querySelector('#app-title')?.textContent === 'Codex Session Observatory', 'official title in ' + theme)
      const nav = target.querySelector('.workspace-navigator')!.getBoundingClientRect()
      const transcriptRect = target.querySelector('.workspace-transcript')!.getBoundingClientRect()
      assert(nav.right <= transcriptRect.left, 'Navigator does not overlap transcript')
      const navigator = target.querySelector('.session-navigator')!.getBoundingClientRect()
      const list = target.querySelector('.navigator-list')!.getBoundingClientRect()
      assert(list.bottom < navigator.bottom && target.querySelector('[aria-label="Sessions scroll actions"]'), 'local actions remain inside Navigator frame in ' + theme)
    }
    empty = true; await click(reloadButton()); assert(target.textContent?.includes('No sessions found.'), 'empty list')
    assert(status() === 'loaded' && target.querySelector('.navigator-heading h2')?.textContent === 'Sessions (0)', 'empty Reload retains loaded transcript and updates count')
    assert(!target.querySelector('.navigator-selected') && !target.querySelector('.session-navigator')!.textContent?.includes('Archived sessions are not shown.'), 'removed notices stay absent after selection and Reload')
    return { reloads, flatCalls, hierarchyCalls, selections: parses.length }
  } finally { await unmount(instance) }
}
let infoInstance: ReturnType<typeof mount> | undefined
let infoClickCount = 0
let infoBaseline: { parses: number; block: Element | null; collection: string | null } | undefined
;(globalThis as any).__startInfoInputCase = async () => {
  empty = false
  infoInstance = mount(App, { target })
  await settle()
  await click(row(0))
  await click(target.querySelector('.terminal-block [aria-label="Add to Collection"]'))
  infoBaseline = { parses: parses.length, block: target.querySelector('.terminal-block'), collection: target.querySelector('#collection-panel')!.textContent }
  const info = row(3)!.closest('.session-entry-row')!.querySelector<HTMLButtonElement>('.session-info-button')!
  infoClickCount = 0
  info.addEventListener('click', () => { infoClickCount++ })
  info.scrollIntoView({ block: 'center' }); info.focus(); await settle()
  const rect = info.getBoundingClientRect()
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}
;(globalThis as any).__assertInfoInputCase = async (clicks: number) => {
  await settle()
  assert(infoClickCount === clicks, 'real browser activation reached Info: ' + infoClickCount + ' vs ' + clicks)
  assert(parses.length === infoBaseline!.parses && status() === 'loaded', 'real Info activation cannot parse a session')
  assert(row(0)?.getAttribute('aria-current') === 'true' && target.querySelector('.terminal-block') === infoBaseline!.block, 'real Info activation preserves selection and transcript')
  assert(!(target.querySelector('#collection-panel') as HTMLElement).hidden && target.querySelector('#collection-panel')!.textContent === infoBaseline!.collection, 'real Info activation preserves Collection')
}
;(globalThis as any).__duplicateRowInputPoint = async () => {
  const date = row(4)!.closest('.session-entry-row')!.querySelector<HTMLElement>('.session-date')!
  date.scrollIntoView({ block: 'center' }); await settle()
  const rect = date.getBoundingClientRect()
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}
;(globalThis as any).__assertDuplicateRowInput = async () => {
  await settle()
  assert(parses.length === infoBaseline!.parses + 1 && parses.at(-1) === items[4].path && row(4)?.getAttribute('aria-current') === 'true', 'clicking the date selects the correct duplicate-title session: ' + JSON.stringify({parses:parses.length,baseline:infoBaseline!.parses,path:parses.at(-1),active:target.querySelector('.session-entry.active')?.getAttribute('data-entry-key')}))
  assert((target.querySelector('#collection-panel') as HTMLElement).hidden && target.querySelectorAll('#collection-panel article').length === 0, 'different session clears and closes Collection')
}
;(globalThis as any).__stopInfoInputCase = async () => { if (infoInstance) await unmount(infoInstance) }
;(globalThis as any).__domReady = true

// The common scroll boundary must remain invariant as presentations change.
;(globalThis as any).__themeSurfaceCase = async () => {
  await (globalThis as any).__heightStart()
  try {
    const rect = (element: Element) => {
      const r = element.getBoundingClientRect()
      return [r.x, r.y, r.width, r.height].map(value => Math.round(value * 100) / 100)
    }
    for (const state of ['idle', 'short', 'long']) {
      if (state === 'short') await (globalThis as any).__heightLoad()
      if (state === 'long') await (globalThis as any).__heightLong()
      let baseline = ''
      for (const theme of ['Terminal Style', 'Markdown Style', 'DM Style', 'DM Style (Dark)']) {
        await (globalThis as any).__heightCheck(theme, true, true)
        const viewport = target.querySelector<HTMLElement>('.transcript-viewport')!
        const content = target.querySelector<HTMLElement>('.transcript-content')!
        const renderer = target.querySelector<HTMLElement>('.transcript-presentation')!
        const style = getComputedStyle(viewport)
        const dimensions = JSON.stringify(['.session-navigator', '.workspace-transcript', '.collection-panel', '.transcript-viewport'].map(selector => rect(target.querySelector(selector)!)))
        if (!baseline) baseline = dimensions
        assert(dimensions === baseline, state + ': all frame and scroll coordinates remain equal across themes')
        for (const heading of target.querySelectorAll('.navigator-heading h2, .transcript-heading h2, .collection-panel-header h2')) {
          const typography = getComputedStyle(heading)
          assert(typography.fontSize === '14px' && typography.fontWeight === '650', 'panel titles share typography')
        }
        for (const label of target.querySelectorAll('.selected-path-row > span, .selection-metadata dt, .resume-row > span:first-child, .filter-bar > h2, .style-label, .status-line-label')) {
          const typography = getComputedStyle(label)
          assert(typography.fontSize === '11px' && typography.fontWeight === '650', 'header labels share typography')
        }
        const filters = target.querySelector('.filter-list')!.getBoundingClientRect()
        const statusContent = target.querySelector('.status-announcement')!.getBoundingClientRect()
        assert(Math.abs(filters.left - statusContent.left) < 1, 'Filters and Status content start aligned')
        assert(target.querySelector('.filter-bar')!.getBoundingClientRect().height === target.querySelector('.status-line')!.getBoundingClientRect().height, 'Filters and Status row heights retained')
        assert(style.backgroundColor === getComputedStyle(renderer).backgroundColor && style.backgroundColor === getComputedStyle(viewport, '::-webkit-scrollbar-track').backgroundColor, 'renderer, gutter and scrollbar track share a surface')
        assert(style.borderWidth === '0px' && style.padding === '0px' && style.boxSizing === 'border-box', 'viewport geometry belongs to the common structure')
        assert(getComputedStyle(renderer).overflow === 'visible' && getComputedStyle(content).minHeight === '100%', 'only viewport owns vertical scrolling')
        assert(viewport.scrollWidth <= viewport.clientWidth && document.documentElement.scrollWidth <= innerWidth, 'no horizontal overflow')
        assert(getComputedStyle(renderer).minHeight === '0px', 'presentation has no independent height floor')
        const controls = [...target.querySelectorAll<HTMLElement>('.panel-icon-button:not(:disabled), [data-navigator-mode]')]
        const backgrounds = controls.map(e => getComputedStyle(e).backgroundColor)
        assert(backgrounds.every(value => value === backgrounds[0]) && backgrounds[0] !== 'rgba(0, 0, 0, 0)', 'all enabled panel controls and badge share the theme palette')
        const frame = target.querySelector<HTMLElement>('.workspace-transcript')!
        frame.style.setProperty('--transcript-surface', '#123456')
        assert(getComputedStyle(viewport).backgroundColor === getComputedStyle(renderer).backgroundColor && getComputedStyle(viewport).backgroundColor === getComputedStyle(viewport, '::-webkit-scrollbar-track').backgroundColor, 'a future surface token change reaches content, gutter and track together')
        frame.style.removeProperty('--transcript-surface')
        if (state === 'long') assert(Math.abs(viewport.scrollTop - 180) < 1, 'theme switch preserves Transcript offset')
      }
    }
  } finally { await (globalThis as any).__workspaceStop() }
}

;(globalThis as any).__feedbackCase = async () => {
  const instance = mount(App, { target })
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  let failCopy = false
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { if (failCopy) throw new Error('Clipboard denied') } } })
  const message = () => target.querySelector('.status-line-text')!.textContent!
  const severity = () => target.querySelector('.status-line')!.getAttribute('data-severity')
  const statusBackground = () => getComputedStyle(target.querySelector('.status-line-text')!).backgroundColor
  const checkHeaderRows = () => {
    verifyHeaderAlignment()
    assert(getComputedStyle(target.querySelector('.status-line')!).backgroundColor === 'rgb(255, 255, 255)', 'status row stays neutral outside the badge')
  }
  const bounds = () => ['.app-header','.observatory-workspace','.status-line'].map(q => {
    const r = target.querySelector(q)!.getBoundingClientRect(); return [r.y,r.height]
  })
  try {
    await settle()
    const header = target.querySelector('.app-header')!.getBoundingClientRect()
    const work = target.querySelector('.observatory-workspace')!.getBoundingClientRect()
    assert(header.height < 262 && work.height > 454, 'removed upper UI returns space to all panels at 1360x760')
    assert(Math.abs((262 - header.height) - (work.height - 454)) < 1, 'workspace gains exactly the height removed from the upper area')
    assert(!target.querySelector('.selected-path-field,.resume-actions') && !target.textContent?.includes('Select JSONL'), 'direct selection UI removed')
    assert([...target.querySelectorAll('.selection-metadata dt')].map(e => e.textContent).join() === 'Session ID', 'only Session ID metadata remains')
    assert(message() === 'Ready.' && target.querySelector('.transcript-viewport')!.textContent?.includes('Select a session from Sessions to begin.') && !target.querySelector('.transcript-viewport')!.textContent?.includes('Ready.'), 'base feedback and selection guidance are separate')
    assert(target.querySelector('.load-state')!.textContent === 'Idle' && (target.querySelector('[aria-label="Reset loaded session"]') as HTMLButtonElement).disabled, 'initial neutral state and Reset condition')
    checkHeaderRows()
    assert(statusBackground() === 'rgb(226, 244, 232)', 'normal feedback has a green background')
    assert(target.querySelector('.status-line-text')!.getBoundingClientRect().width < 100, 'short feedback is a content sized badge')
    await click(row(0)); await click(target.querySelector('[aria-label="Add to Collection"]'))
    const stable = JSON.stringify(bounds())
    assert(target.querySelector('.load-state')!.textContent === 'Loaded' && target.querySelector('.load-state')!.tagName === 'SPAN', 'Loaded badge is display only')
    assert([...target.querySelector('.header-controls')!.children].map(e => e.classList.contains('load-state') ? 'badge' : e.getAttribute('aria-label')).join() === 'badge,Refresh,Reset loaded session', 'header order is badge, Refresh, Reset')
    const resetButton = target.querySelector<HTMLButtonElement>('.reset-session-button')!
    const resetTooltip = document.getElementById(resetButton.getAttribute('aria-describedby')!)!
    assert(resetTooltip.textContent === 'Reset to idle' && getComputedStyle(resetTooltip).visibility === 'hidden', 'Reset tooltip is described and initially hidden')
    resetButton.dispatchEvent(new MouseEvent('mouseenter')); await settle()
    assert(getComputedStyle(resetTooltip).visibility === 'visible', 'Reset hover shows tooltip')
    assert(resetTooltip.getBoundingClientRect().right <= innerWidth, 'Reset tooltip stays inside the right edge')
    resetButton.dispatchEvent(new MouseEvent('mouseleave')); await settle()
    resetButton.focus(); await settle()
    assert(getComputedStyle(resetTooltip).visibility === 'visible', 'Reset keyboard focus shows tooltip: ' + JSON.stringify({focused:document.activeElement === resetButton,visibility:getComputedStyle(resetTooltip).visibility}))
    resetButton.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await settle()
    assert(getComputedStyle(resetTooltip).visibility === 'hidden' && document.activeElement === resetButton, 'Escape hides tooltip without invoking Reset')
    resetButton.blur()
    const exportButton = target.querySelector('[aria-label="Export Worklog"]')!
    assert(exportButton.closest('.filter-bar') && !exportButton.previousElementSibling, 'Export remains first in Filters actions')
    assert(target.querySelector('.resume-row button')?.getAttribute('aria-label') === 'Copy Resume Command', 'Resume copy remains available at the right edge')
    holdReload = true; await click(reloadButton()); assert(message() === 'Loading sessions…', 'list progress reaches common status')
    failCopy = true; await click(button('Capture Transcript'))
    assert(message() === 'Capture failed.' && severity() === 'error' && target.querySelector('.load-state')!.textContent === 'Loaded', 'execution error is separate from successful session load')
    assert(statusBackground() === 'rgb(253, 232, 231)', 'error feedback has a red background')
    releaseReload!(); holdReload = false; await settle()
    assert(message() === 'Capture failed.', 'list completion cannot hide Capture failure')
    failCopy = false; await click(button('Copy All')); assert(message() === 'Capture failed.', 'unrelated clipboard success cannot hide failure')
    await click(button('Capture Transcript')); assert(message() === 'Transcript copied to clipboard.' && severity() === 'success', 'same action recovery replaces its error')
    assert(statusBackground() === 'rgb(226, 244, 232)', 'successful feedback has a green background')
    assert(JSON.stringify(bounds()) === stable, 'progress, errors and copy results do not change any upper or workspace height')
    cancelExport = true; await click(button('Export Worklog')); assert(message() === 'Worklog export cancelled.' && severity() === 'info', 'cancel is not success')
    cancelExport = false; await click(button('Export Worklog')); assert(message().startsWith('Worklog exported successfully:') && severity() === 'success', 'confirmed export succeeds')
    failFolderAfterExport = true; await click(button('Export Worklog')); assert(severity() === 'warning' && message().includes('folder could not be opened'), 'successful file export with folder failure is warning')
    assert(statusBackground() === 'rgb(255, 244, 206)', 'warning feedback has a yellow background')
    await click(button('Copy All')); assert(severity() === 'warning', 'copy cannot hide Export warning')
    failFolderAfterExport = false; failExport = true; await click(button('Export Worklog')); assert(severity() === 'error' && message() === 'Target not safe to overwrite.', 'unsafe export has no false success')
    failExport = false; await click(button('Export Worklog'))
    reloadErrorMessage = 'Cannot read sessions: ' + 'long actionable error '.repeat(80); failReload = true; await click(reloadButton())
    assert(message() === reloadErrorMessage && severity() === 'error', 'full failure reaches one common location')
    const text = target.querySelector<HTMLElement>('.status-line-text')!
    text.focus(); await settle()
    assert(text.scrollWidth > text.clientWidth && getComputedStyle(text).whiteSpace === 'nowrap', 'long status remains a single truncated line')
    assert(getComputedStyle(target.querySelector('.status-line-tooltip')!).visibility === 'visible' && target.querySelector('.status-line-tooltip')!.textContent === message(), 'keyboard focus reveals full error')
    assert(!target.querySelector('.navigator-messages,.action-status,.collection-copy-status,.transcript-action-status,.message-link-error'), 'local runtime feedback containers removed')
    for (const theme of ['Terminal Style','Markdown Style','DM Style','DM Style (Dark)']) {
      const select = target.querySelector('.theme-selector select')!; select.value = theme; select.dispatchEvent(new Event('change',{bubbles:true})); await settle()
      assert(JSON.stringify(bounds()) === stable, 'four themes keep fixed status and workspace heights: ' + JSON.stringify({ theme, expected: stable, actual: bounds() }))
      assert(message() === reloadErrorMessage, 'theme change preserves errors')
      checkHeaderRows()
      assert(statusBackground() === 'rgb(253, 232, 231)', 'theme changes preserve the error background')
      const reset = target.querySelector<HTMLButtonElement>('[aria-label="Reset loaded session"]')!
      assert(!reset.disabled && getComputedStyle(reset).color === 'rgb(180, 35, 24)', 'enabled Reset remains red in every theme')
    }
    failReload = false; await click(button('Retry Sessions')); assert(message() === 'Ready.', 'existing recovery returns to Ready')
    await click(button('Reset loaded session')); assert(status() === 'idle' && (target.querySelector('#collection-panel') as HTMLElement).hidden, 'Reset retains its lifecycle behavior')
    return { headerHeight: header.height, workspaceHeight: work.height, gained: work.height - 454 }
  } finally {
    failReload = false; holdReload = false; failExport = false; failFolderAfterExport = false; cancelExport = false
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
    else delete (navigator as any).clipboard
    await unmount(instance)
  }
}


;(globalThis as any).__navigatorModePreferenceCase = async () => {
  localStorage.removeItem(navigatorModePreferenceKey)
  let instance = mount(App, { target }); await settle()
  try {
    assert(mode() === 'Flat', 'missing preference defaults to Flat')
    await toggle()
    assert(mode() === 'Hierarchical', 'switch to Hierarchical')
    assert(localStorage.getItem(navigatorModePreferenceKey) === 'Hierarchical', 'hierarchical choice saved')
    await unmount(instance)
    const trees = hierarchyCalls
    instance = mount(App, { target }); await settle()
    assert(mode() === 'Hierarchical', 'hierarchical choice restored on remount')
    assert(hierarchyCalls === trees + 1 && row(42), 'restored view loads hierarchy from the new snapshot')
    verifyNavigatorHeader()
    await toggle()
    assert(localStorage.getItem(navigatorModePreferenceKey) === 'Flat', 'flat choice saved')
    await unmount(instance)
    instance = mount(App, { target }); await settle()
    assert(mode() === 'Flat', 'flat choice restored on remount')
    await unmount(instance)
    localStorage.setItem(navigatorModePreferenceKey, 'unknown')
    instance = mount(App, { target }); await settle()
    assert(mode() === 'Flat', 'invalid choice defaults to Flat')
    const originalSet = Storage.prototype.setItem
    try {
      Storage.prototype.setItem = () => { throw new Error('Synthetic storage denial') }
      await toggle()
      assert(mode() === 'Hierarchical' && row(42), 'storage denial preserves view switch and loading')
      assert(target.querySelector('.status-line-text')!.textContent!.includes('could not be saved'), 'storage warning is visible')
    } finally { Storage.prototype.setItem = originalSet }
  } finally {
    await unmount(instance)
    localStorage.removeItem(navigatorModePreferenceKey)
  }
}

;(globalThis as any).__fontCase = async () => {
  const key = 'observatory.fonts.v1'
  const selectFont = async (kind: string, value: string) => {
    const e = target.querySelector<HTMLSelectElement>('[aria-label="' + kind + ' font"]')!
    e.value = value; e.dispatchEvent(new Event('change', { bubbles:true })); await settle()
  }
  const family = (selector: string) => getComputedStyle(target.querySelector(selector)!).fontFamily
  const theme = async (value: string) => {
    const e = target.querySelector<HTMLSelectElement>('.theme-selector select')!
    e.value = value; e.dispatchEvent(new Event('change', {bubbles:true})); await settle()
  }
  localStorage.removeItem(key)
  widthFixture = true
  let instance = mount(App, {target}); await settle()
  try {
    assert(target.querySelector<HTMLSelectElement>('[aria-label="Text font"]')!.value === '', 'initial Default')
    await click(row(0))
    await click(target.querySelectorAll<HTMLElement>('[aria-label="Add to Collection"]')[1])
    const original = target.querySelector('.collection-message pre')!.textContent
    for (const name of ['Terminal Style','Markdown Style','DM Style','DM Style (Dark)']) {
      await theme(name)
      const baseline = {text:family('.message-content p'),code:family('.message-code-block'),meta:family('.selection-metadata dd')}
      await selectFont('Text','Arial')
      assert(family('.message-content p').includes('Arial') && family('.selection-metadata dd').includes('Arial'), 'Text includes prose and metadata in ' + name)
      assert(family('.message-code-block') === baseline.code, 'Text does not alter Default code')
      assert(family('.collection-message pre > span:not(.collection-code)').includes('Arial'), 'Collection prose uses Text')
      await selectFont('Code','Consolas')
      assert(family('.message-inline-code,.message-code-block').includes('Consolas') && family('.collection-code').includes('Consolas'), 'Code applies to code and Collection ranges')
      assert(family('.selected-path-row strong').includes('Consolas'), 'technical path uses Code')
      assert(family('.message-content p').includes('Arial'), 'Code does not alter Text')
      assert(target.querySelector('.collection-message pre')!.textContent === original, 'typography preserves raw Collection')
      await click(button('Refresh Transcript'))
      assert(target.querySelector('.collection-message pre')!.textContent === original, 'Refresh retains collection')
      await selectFont('Code','Arial')
      assert(family('.message-code-block').includes('Arial'), 'proportional Code choice is respected')
      await selectFont('Text','')
      assert(family('.message-content p') === baseline.text && family('.selection-metadata dd') === baseline.meta, 'Text Default restores legacy rules')
      await selectFont('Code','')
      assert(family('.message-code-block') === baseline.code, 'both Default restore legacy code')
    }
    await selectFont('Text','Malgun Gothic'); await selectFont('Code','Consolas')
    for (const label of ['Hide Sessions','Hide Collection','Show Sessions','Show Collection']) await click(button(label))
    await click(row(1))
    assert(target.querySelector<HTMLSelectElement>('[aria-label="Text font"]')!.value === 'Malgun Gothic', 'selection survives session switch')
    await unmount(instance)
    instance = mount(App,{target}); await settle()
    assert(target.querySelector<HTMLSelectElement>('[aria-label="Code font"]')!.value === 'Consolas', 'saved Code restores on mount')
    assert(family('#app-title').includes('Malgun Gothic'), 'saved Text applies on mount')
    await unmount(instance)
    localStorage.setItem(key, JSON.stringify({text:'Removed font',code:'Consolas'}))
    instance = mount(App,{target}); await settle()
    assert(target.querySelector<HTMLSelectElement>('[aria-label="Text font"]')!.value === '' && target.querySelector<HTMLSelectElement>('[aria-label="Code font"]')!.value === 'Consolas', 'missing font defaults independently')
    assert(target.querySelector('.status-line-text')!.textContent!.includes('not installed'), 'missing font warning')
    await unmount(instance)
    localStorage.setItem(key, '{invalid')
    instance = mount(App,{target}); await settle()
    assert(target.querySelector('.status-line-text')!.textContent!.includes('could not be read'), 'invalid saved setting warning')
    const originalSet = Storage.prototype.setItem
    try {
      Storage.prototype.setItem = () => { throw new Error('Synthetic storage denial') }
      await selectFont('Text','Arial')
      assert(family('#app-title').includes('Arial') && target.querySelector('.status-line-text')!.textContent!.includes('could not be saved'), 'storage failure retains effective choice with warning')
    } finally { Storage.prototype.setItem = originalSet }
    await unmount(instance)
    failFonts = true
    instance = mount(App,{target}); await settle()
    assert(target.querySelector('.status-line-text')!.textContent!.includes('could not be listed'), 'font enumeration failure reported')
    assert(!target.querySelector<HTMLSelectElement>('[aria-label="Text font"]')!.disabled, 'Default remains available after failure')
  } finally {
    await unmount(instance); localStorage.removeItem(key); failFonts = false; widthFixture = false
  }
}

;(globalThis as any).__headerLayoutCase = async () => {
  longHeaderFixture = true
  let copied = ''
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText:async (text:string)=>{copied=text} } })
  const instance = mount(App,{target}); await settle()
  try {
    verifyHeaderAlignment()
    assert(button('Copy Resume Command').disabled, 'Resume copy initially disabled')
    await click(row(0))
    for (const theme of ['Terminal Style','Markdown Style','DM Style','DM Style (Dark)']) {
      const select = target.querySelector<HTMLSelectElement>('.theme-selector select')!
      select.value = theme; select.dispatchEvent(new Event('change',{bubbles:true})); await settle()
      verifyHeaderAlignment()
      for (const selector of ['.selection-metadata dd','.resume-row code']) {
        const e = target.querySelector<HTMLElement>(selector)!
        const half = e.closest('.selection-metadata,.resume-row')!.getBoundingClientRect()
        assert(e.scrollWidth > e.clientWidth && e.title === e.textContent, 'long value is ellipsized with full tooltip')
        assert(e.getBoundingClientRect().right <= half.right, 'long values stay in their half')
      }
      assert(document.documentElement.scrollWidth <= innerWidth, 'header does not create horizontal overflow')
      await click(button('Copy Resume Command'))
      assert(copied === 'codex resume session-' + 'long-한글-'.repeat(30), 'copy uses complete command, not truncated display')
    }
  } finally {
    await unmount(instance); longHeaderFixture = false
    if (originalClipboard) Object.defineProperty(navigator,'clipboard',originalClipboard)
    else delete (navigator as any).clipboard
  }
}
