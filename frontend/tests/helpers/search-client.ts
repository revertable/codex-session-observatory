import './navigator-client'
import { mount, unmount, flushSync, tick } from 'svelte'
import App from '../../src/App.svelte'
import { renderedMatches } from '../../src/lib/search/transcript-search'

const target = document.querySelector('#target') as HTMLElement
const internal = (window as any).__TAURI_INTERNALS__
const original = internal.invoke
let sourceSnapshot = '', sequence = 0, release: (() => void) | undefined
let filtered: any[] | undefined, searchSnapshot = ''
const queries: string[] = []
internal.transformCallback = () => ++sequence
internal.unregisterCallback = () => {}
internal.invoke = async (command: string, args: any) => {
  if (command === 'reload_session_navigator') {
    const result = await original(command, args); sourceSnapshot = result.snapshot_id; return result
  }
  if (command === 'search_sessions') {
    queries.push(args.query)
    args.progress.onmessage({ scanned: 1, total: 43, unreadable: 0 })
    if (args.query === 'slow') await new Promise<void>(resolve => { release = resolve })
    if (args.query === 'fail') throw { error: { code: 'search_failed', message: 'Synthetic search failure' } }
    const tree = await original('list_sessions_hierarchy', { request: { snapshot_id: sourceSnapshot } })
    const all = [...tree.years.flatMap((y: any) => y.months.flatMap((m: any) => m.days.flatMap((d: any) => d.items))), ...tree.unfiled_items]
    filtered = args.query ? all.filter((item: any) => item.entry_key === '42') : all
    searchSnapshot = 'search-' + ++sequence
    return { page: { ...tree, snapshot_id: searchSnapshot, items: filtered!.slice(0, 20), total: filtered!.length,
      has_more: filtered!.length > 20, next_cursor: filtered!.length > 20 ? '20' : null }, scanned: all.length, unreadable: 0 }
  }
  if (command === 'list_sessions_hierarchy' && args.request.snapshot_id === searchSnapshot) {
    return { snapshot_id: searchSnapshot, total: filtered!.length, years: [], unfiled_items: filtered, diagnostics: {}, sessions_root: '/sessions' }
  }
  if (command === 'list_sessions_flat' && args.request.snapshot_id === searchSnapshot) {
    const offset = Number(args.request.cursor), end = offset + 20
    return { snapshot_id: searchSnapshot, total: filtered!.length, items: filtered!.slice(offset, end),
      has_more: end < filtered!.length, next_cursor: end < filtered!.length ? String(end) : null, diagnostics: {}, sessions_root: '/sessions' }
  }
  const result = await original(command, args)
  if (command === 'parse_selected_jsonl') result.parsed_chat_log.transcript_blocks = [
    { entry_type: 'you', label: 'YOU', title: 'YOU', timestamp: null, content: 'Needle **across** emphasis & entities 😀 한글' },
    { entry_type: 'codex', label: 'CODEX', title: 'CODEX', timestamp: null, content: 'Start\n\n' + 'Filler paragraph without a match.\n\n'.repeat(70) + 'needle at the end' },
    { entry_type: 'tool_result', label: 'RESULT', title: 'RESULT', timestamp: null, content: 'needle tool result' },
  ]
  return result
}
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const settle = async () => { flushSync(); await tick(); await new Promise(resolve => setTimeout(resolve, 100)); flushSync() }
const click = async (selector: string) => { target.querySelector<HTMLButtonElement>(selector)!.click(); await settle() }
const scope = async (name: string) => {
  const select = target.querySelector<HTMLSelectElement>('[aria-label="Search target"]')!
  select.value = name; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
}
const input = async (text: string, submit = true) => {
  const field = target.querySelector<HTMLInputElement>('[aria-label="Search query"]')!
  field.value = text; field.dispatchEvent(new Event('input', { bubbles: true })); await settle()
  if (submit) { target.querySelector<HTMLFormElement>('.search-row')!.requestSubmit(); await settle() }
}
const summary = () => target.querySelector('[aria-label="Search results"]')?.textContent ?? ''
const matches = () => [...(CSS.highlights.get('observatory-search') ?? [])]
let instance: ReturnType<typeof mount>
Object.assign(globalThis, {
  __searchStart: async () => { instance = mount(App, { target }); await settle(); await click('[data-entry-key="0"]'); await click('[aria-label="Add to Collection"]') },
  __searchWidthCase: async () => {
    const select = target.querySelector<HTMLSelectElement>('.theme-selector select')!
    const originalTheme = select.value
    const output = target.querySelector<HTMLOutputElement>('.search-summary')!
    const textNode = output.firstChild as Text
    assert(textNode instanceof Text, 'result slot retains its reactive text node')
    const originalText = textNode.data
    const geometry = () => ['.search-row', '[aria-label="Search query"]', '.search-summary', '[aria-label="Search"]', '.observatory-workspace']
      .map(selector => { const r = target.querySelector(selector)!.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })
    try {
      let baseline = ''
      for (const theme of ['Terminal Style', 'Markdown Style', 'DM Style', 'DM Style (Dark)']) {
        select.value = theme; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
        for (const text of ['', '1 / 10', '10 / 10', '999 / 999', '999 sessions', 'Search failed']) {
          // Vary only the displayed text to exercise layout without creating hundreds of fake matches.
          textNode.data = text; await settle()
          const actual = JSON.stringify(geometry())
          if (!baseline) baseline = actual
          assert(actual === baseline, 'search geometry stays fixed: ' + JSON.stringify({ theme, text, expected: baseline, actual }))
          assert(output.getBoundingClientRect().width === 104, 'result slot reserves 104px even when empty')
          assert(output.scrollWidth <= output.clientWidth, 'result text fits without clipping: ' + text)
          assert(target.querySelector('.search-row')!.getBoundingClientRect().height === 44, 'search row retains 44px height')
          assert(document.documentElement.scrollWidth <= innerWidth, 'search controls stay inside the window')
        }
      }
    } finally {
      textNode.data = originalText
      select.value = originalTheme; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
    }
  },
  __sessionSearchCase: async () => {
    const body = target.querySelector('.message-content'), collection = target.querySelector('.collection-panel')!.textContent
    await input('needle')
    assert(queries.at(-1) === 'needle' && summary() === '1 sessions', 'Session submit reaches backend search and result count')
    assert(target.querySelector('.navigator-heading h2')!.textContent === 'Sessions (1)' && target.querySelectorAll('.session-entry').length === 1 && target.querySelector('[data-entry-key="42"]'), 'match outside the first page is displayed')
    await click('[aria-label="Switch to Hierarchical mode"]')
    assert(target.querySelector('[data-entry-key="42"]'), 'hierarchical mode retains search membership')
    await click('[aria-label="Switch to Flat mode"]')
    assert(target.querySelector('.message-content') === body && target.querySelector('.collection-panel')!.textContent === collection, 'Session search preserves loaded transcript and Collection')
    const calls = queries.length
    await input('edited draft', false)
    await scope('Transcript')
    assert(target.querySelector<HTMLInputElement>('[aria-label="Search query"]')!.value === 'edited draft', 'scope change retains the shared input')
    await scope('Session')
    await input('', false)
    assert(queries.length === calls && target.querySelector('.navigator-heading h2')!.textContent === 'Sessions (1)' && summary() === '1 sessions', 'editing, clearing and switching scopes leave the applied Session results unchanged')
    await click('[aria-label="Search"]')
    assert(queries.length === calls + 1 && target.querySelector('.navigator-heading h2')!.textContent === 'Sessions (43)' && summary() === '', 'explicit empty Session search restores the full list')
    await input('slow'); await input('needle'); release!(); await settle()
    assert(summary() === '1 sessions', 'superseded search cannot replace the latest view')
    await input('fail')
    assert(target.querySelector('.toast-message')!.textContent?.includes('Synthetic search failure'), 'search errors reach Toast')
    await input('needle'); await click('[data-entry-key="42"]')
    assert(target.querySelector('.selected-path-row')!.textContent?.includes('42.jsonl'), 'search result selection opens its session')
    await input('')
  },
  __transcriptSearchCase: async () => {
    await scope('Transcript')
    await click('[aria-label="Add to Collection"]')
    assert(target.querySelectorAll('.collection-panel article').length === 1, 'Transcript search starts with a nonempty Collection')
    const viewport = target.querySelector<HTMLElement>('.transcript-viewport')!
    const body = target.querySelector('.message-content')!, collection = target.querySelector('.collection-panel')!.textContent
    const filters = [...target.querySelectorAll<HTMLInputElement>('.filter-bar input')].map(e => e.checked).join()
    for (const theme of ['Terminal Style', 'Markdown Style', 'DM Style', 'DM Style (Dark)']) {
      const select = target.querySelector<HTMLSelectElement>('.theme-selector select')!
      select.value = theme; select.dispatchEvent(new Event('change', { bubbles: true })); await settle()
      await input('needle')
      assert(summary() === '1 / 2' && matches().length === 2, 'only filtered visible bodies are searched in ' + theme)
      await click('[aria-label="Search"]')
      assert(summary() === '2 / 2' && viewport.scrollTop > 500, 'next result scrolls inside Transcript')
      const active = [...CSS.highlights.get('observatory-search-current')!][0].getBoundingClientRect(), frame = viewport.getBoundingClientRect()
      assert(active.top >= frame.top && active.bottom <= frame.bottom, 'active result is in the visible viewport')
      await click('[aria-label="Search"]'); assert(summary() === '1 / 2', 'navigation wraps to the first result')
      await input('needle across'); assert(summary() === '1 / 1', 'matching spans formatted nodes')
      const highlight = CSS.highlights.get('observatory-search'), calls = queries.length
      await input('edited draft', false)
      await scope('Session')
      assert(target.querySelector<HTMLInputElement>('[aria-label="Search query"]')!.value === 'edited draft' && CSS.highlights.get('observatory-search') === highlight, 'scope switch preserves the input and applied Transcript highlight')
      await scope('Transcript')
      await input('', false)
      assert(queries.length === calls && CSS.highlights.get('observatory-search') === highlight && summary() === '1 / 1', 'edits and deletion leave Transcript results and highlights unchanged')
      await click('[aria-label="Search"]')
      assert(!CSS.highlights.has('observatory-search') && summary() === '', 'explicit empty Transcript search removes highlight and search position')
    }
    await input('needle')
    await input('unsubmitted draft', false)
    const tool = [...target.querySelectorAll('label')].find(label => label.textContent?.trim() === 'Tool results')!.querySelector('input')!
    tool.checked = true; tool.dispatchEvent(new Event('change', { bubbles: true })); await settle()
    assert(summary() === '1 / 3', 'filter change uses the last submitted query rather than the edited draft')
    tool.checked = false; tool.dispatchEvent(new Event('change', { bubbles: true })); await settle()
    await input('')
    assert([...target.querySelectorAll<HTMLInputElement>('.filter-bar input')].map(e => e.checked).join() === filters && target.querySelector('.collection-panel')!.textContent === collection, 'Transcript search never changes filters or Collection')
    assert(body.isConnected === false || target.querySelector('.message-content'), 'theme replacement remains functional')
    const stable = target.querySelector('.message-content')!
    await input('needle'); await click('[aria-label="Search"]'); assert(target.querySelector('.message-content') === stable, 'search preserves semantic DOM identity')
    await click('[data-entry-key="1"]'); assert(summary() === '1 / 2', 'session switch resets position for the new transcript')
    const expanded = target.querySelector<HTMLButtonElement>('.chat-block-toggle,.terminal-block-toggle,.markdown-block-toggle')!
    expanded.click(); await settle(); assert(summary() === '1 / 1', 'collapsed bodies are excluded from visible content')
    await input('')
    const host = document.createElement('div'); host.innerHTML = '<div class="message-content"><p>one<br>two</p><p>three</p></div>'
    target.append(host)
    assert(renderedMatches(host, 'onetwo').length === 0 && renderedMatches(host, 'twothree').length === 0, 'line and paragraph boundaries do not concatenate')
    host.remove()
  },
  __searchFocusSetup: async () => { await scope('Transcript'); await input('needle'); target.querySelector<HTMLElement>('.transcript-viewport')!.focus(); await settle() },
  __searchFocusCheck: () => {
    const field = target.querySelector<HTMLInputElement>('[aria-label="Search query"]')!
    assert(document.activeElement === field && field.selectionStart === 0 && field.selectionEnd === field.value.length, 'Ctrl+F focuses and selects the Observatory search query')
    assert(target.querySelector<HTMLSelectElement>('[aria-label="Search target"]')!.value === 'Transcript', 'Ctrl+F retains the selected search scope')
  },
  __searchStop: async () => { await unmount(instance) },
})
