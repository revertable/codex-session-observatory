import { mount, unmount, flushSync, tick } from 'svelte'
import App from '../../src/App.svelte'
import '../../src/app.css'
import type { SessionSummary, SessionPage, SessionHierarchy } from '../../src/lib/session-navigator/contract'
import type { ParseResponseDto } from '../../src/lib/parse-contract'

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const settle = async () => { flushSync(); await tick(); await new Promise(resolve => setTimeout(resolve, 40)); flushSync() }
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
const diagnostics = { discovered_files: 46, guardian_sessions: 3, duplicate_files: 0, unreadable_files: 0, warnings: [] }
const page = (snapshot: string, offset = 0): SessionPage => ({ snapshot_id: snapshot, sessions_root: '/sessions',
  total: items.length, items: items.slice(offset, offset + 20), next_cursor: offset + 20 < items.length ? String(offset + 20) : null,
  has_more: offset + 20 < items.length, diagnostics })
const hierarchy = (snapshot: string): SessionHierarchy => ({ snapshot_id: snapshot, sessions_root: '/sessions', total: items.length,
  years: [{ year: 2026, months: [{ month: 10, days: [{ day: 23, items: items.slice(0, 42) }] }] }],
  unfiled_items: [items[42]], diagnostics })
const response = (path: string): ParseResponseDto => ({
  source: { absolute_path: path, file_name: path.split('/').at(-1)!, session_id: null, resume_command: null },
  session: { classification: 'interactive', identity: null, capabilities: { can_show_transcript: true, can_resume: false,
    can_export_worklog: false, can_open_parent_session: false } },
  parsed_chat_log: { entries: [], referenced_conversations: [], observed_event_counts: [],
    counters: { parsed_candidates: 2, total_entries: 2, visible_entries: 2, ignored_lines: 0, malformed_lines: 0 },
    transcript_blocks: [
      { entry_type: 'you', label: 'YOU', title: 'User', timestamp: null, content: 'First message in ' + path },
      { entry_type: 'codex', label: 'CODEX', title: 'Assistant', timestamp: null, content: 'Reply' },
    ] },
})
let reloads = 0; let flatCalls = 0; let hierarchyCalls = 0; const parses: string[] = []
let failReload = false; let expirePage = false; let failParse = false; let empty = false
let releasePage: (() => void) | null = null; let holdPage = false
let releaseReload: (() => void) | null = null; let holdReload = false
;(window as any).__TAURI_INTERNALS__ = {
  invoke: async (command: string, args?: any) => {
    if (command === 'plugin:app|version') throw new Error('No update check')
    if (command === 'reload_session_navigator') {
      reloads++
      if (holdReload) await new Promise<void>(resolve => { releaseReload = resolve })
      if (failReload) throw { error: { code: 'navigator_task_failed', message: 'Cannot read sessions' } }
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
      return response(args.path)
    }
    if (command === 'resolve_jsonl_initial_directory') return '/sessions'
    if (command === 'plugin:dialog|open') return items[0].path
    throw new Error('Unexpected command: ' + command)
  },
}
const button = (text: string) => Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === text)!
const click = async (element: HTMLElement | null) => { assert(element, 'click target exists'); element!.click(); await settle() }
const row = (index: number) => target.querySelector<HTMLButtonElement>(`.session-entry[data-entry-key="${index}"]`)
const mode = () => target.querySelector('[data-navigator-mode]')?.textContent
const toggle = () => click(target.querySelector('.navigator-mode button'))
const reloadButton = () => target.querySelector<HTMLButtonElement>('[aria-label="Reload Sessions"]')!
const entries = () => Array.from(target.querySelectorAll('.session-entry'))
const scrollBottom = async () => { const list = target.querySelector('.navigator-list')!; list.scrollTop = list.scrollHeight; list.dispatchEvent(new Event('scroll')); await settle() }
const status = () => target.querySelector('[data-status]')?.getAttribute('data-status')

let workspaceInstance: ReturnType<typeof mount> | undefined
let workspaceItems = ''
let workspaceList: Element | null
;(globalThis as any).__workspaceStart = async () => {
  workspaceInstance = mount(App, { target }); await settle()
  await click(target.querySelector('[aria-label="Show Collection"]'))
  const separator = target.querySelector<HTMLElement>('[aria-label="Resize Sessions"]')!
  separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await settle()
  for (const theme of ['DM Style', 'DM Style (Dark)']) {
    const select = target.querySelector('select')!
    select.value = theme; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
    const header = target.querySelector('.chat-transcript-header')!
    const title = header.firstElementChild!.getBoundingClientRect()
    const notice = header.querySelector('.chat-empty-state')!.getBoundingClientRect()
    assert(title.right <= notice.left || title.bottom <= notice.top || notice.right <= title.left, 'idle DM title and notice do not overlap')
  }
  const themeSelect = target.querySelector('select')!
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
  const select = target.querySelector('select')!
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
    assert(target.querySelector('.navigator-count')?.textContent === '43 sessions', 'total session count retained')
    assert(!target.querySelector('.navigator-selected') && !target.querySelector('.session-navigator footer'), 'Navigator omits redundant summary and footer')
    assert(target.querySelector('.navigator-heading h2')?.textContent === 'Codex', 'left region title')
    assert(target.querySelector('#app-title')?.textContent === 'Codex Session Observatory', 'official app title preserved')
    assert(target.querySelector('.terminal-title')?.textContent === 'Session Observatory', 'central region title')
    assert(reloadButton().title === 'Reload Sessions' && reloadButton().textContent?.trim() === '', 'icon has tooltip and accessible name without visible text')
    assert(target.querySelector('.navigator-mode button')?.nextElementSibling === reloadButton(), 'Reload follows mode switch')
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
      assert(target.querySelector('.selection-metadata')?.textContent?.includes('0.jsonl'), label + ': top session information retained')
      assert(target.querySelector('.navigator-count')?.textContent === '43 sessions', label + ': total count retained')
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
    await click(button('Select JSONL')); assert(row(0)?.getAttribute('aria-current') === 'true', 'file picker shares active state')
    for (const theme of ['Terminal Style', 'DM Style (Dark)', 'DM Style', 'Markdown Style']) {
      const select = target.querySelector('select')!
      const option = Array.from(select.options).find(option => option.value === theme)
      if (!option) continue
      select.value = theme; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
      assert(target.querySelector('.session-navigator')?.getAttribute('data-theme') === theme, 'theme forwarded')
      assert(target.querySelector('.terminal-title, .markdown-document-header h2, .chat-transcript-header strong')?.textContent === 'Session Observatory', 'central title in ' + theme)
      assert(target.querySelector('#app-title')?.textContent === 'Codex Session Observatory', 'official title in ' + theme)
      const nav = target.querySelector('.workspace-navigator')!.getBoundingClientRect()
      const transcriptRect = target.querySelector('.workspace-transcript')!.getBoundingClientRect()
      assert(nav.right <= transcriptRect.left, 'Navigator does not overlap transcript')
      const navigator = target.querySelector('.session-navigator')!.getBoundingClientRect()
      const list = target.querySelector('.navigator-list')!.getBoundingClientRect()
      assert(Math.abs(navigator.bottom - list.bottom - 1) < 2, 'Navigator ends at list without footer space in ' + theme)
    }
    empty = true; await click(reloadButton()); assert(target.textContent?.includes('No sessions found.'), 'empty list')
    assert(status() === 'loaded' && target.querySelector('.navigator-count')?.textContent === '0 sessions', 'empty Reload retains loaded transcript and updates count')
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
