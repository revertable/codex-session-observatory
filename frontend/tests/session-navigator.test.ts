import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNavigator, matchesSelection, navigatorModePreferenceKey, sessionPathKey, titleWeight } from '../src/lib/session-navigator/state.ts'
import { createStatusController } from '../src/lib/control-room/status-line.ts'
import { sessionTitlePresentation } from '../src/lib/session-navigator/title-presentation.ts'
import type { NavigatorApi, SessionPage, SessionHierarchy, SessionSummary } from '../src/lib/session-navigator/contract.ts'
import { createSearchState } from '../src/lib/search/search-state.ts'
import { literalMatches } from '../src/lib/search/literal-search.ts'

test('literal search maps Unicode expansions, emoji and regex punctuation to original offsets', () => {
  assert.deepEqual(literalMatches('İ emoji😀 한글 [a]. İ', 'i'), [{ start: 0, end: 1 }, { start: 6, end: 7 }, { start: 18, end: 19 }])
  assert.deepEqual(literalMatches('😀😀 [a].', '[a].'), [{ start: 5, end: 9 }])
  assert.deepEqual(literalMatches('AbAB', 'ab'), [{ start: 0, end: 2 }, { start: 2, end: 4 }])
  assert.deepEqual(literalMatches('anything', '   '), [])
})

test('shared draft survives scope changes; only submit updates applied queries and requests', () => {
  const search = createSearchState()
  let state!: Parameters<Parameters<typeof search.subscribe>[0]>[0]
  search.subscribe(value => { state = value })
  search.input('sessions'); search.submit()
  search.summary('Session', '3 sessions')
  search.target('Transcript')
  assert.equal(state.draft, 'sessions')
  assert.deepEqual(state.queries, { Session: 'sessions', Transcript: '' })
  assert.deepEqual(state.requests, { Session: 1, Transcript: 0 })
  search.input('reply'); search.submit(); search.submit()
  search.summary('Transcript', '2 / 4')
  assert.deepEqual(state.requests, { Session: 1, Transcript: 2 })
  assert.deepEqual(state.queries, { Session: 'sessions', Transcript: 'reply' })
  const applied = state.queries, requests = state.requests, summaries = state.summaries
  for (const draft of ['edited', '', '   ']) {
    search.input(draft)
    assert.equal(state.queries, applied)
    assert.equal(state.requests, requests)
    assert.equal(state.summaries, summaries)
  }
  search.target('Session')
  assert.equal(state.draft, '   ')
  assert.equal(state.queries, applied)
  assert.equal(state.requests, requests)
  assert.deepEqual(state.summaries, { Session: '3 sessions', Transcript: '2 / 4' })
  search.submit()
  assert.deepEqual(state.queries, { Session: '', Transcript: 'reply' })
  assert.deepEqual(state.requests, { Session: 2, Transcript: 2 })
  search.target('Transcript'); search.submit()
  assert.deepEqual(state.queries, { Session: '', Transcript: '' })
  assert.deepEqual(state.requests, { Session: 2, Transcript: 3 })
})

const item = (id: number): SessionSummary => ({ entry_key: String(id), thread_id: String(id), path: `/${id}.jsonl`,
  title: `Session ${id}`, title_source: 'thread_id', created_at_ms: 100 - id, created_at_source: 'session_metadata',
  last_conversation_at_ms: null, last_conversation_at_source: 'unavailable', storage_date: '2026-10-23',
  classification: 'interactive', thread_source: 'user' })
const page = (ids = [0], snapshot = 'a', cursor: string | null = null): SessionPage => ({ snapshot_id: snapshot,
  sessions_root: '/sessions', items: ids.map(item), total: 40, next_cursor: cursor, has_more: cursor !== null,
  diagnostics: { discovered_files: 40, guardian_sessions: 0, duplicate_files: 0, unreadable_files: 0, warnings: [] } })
const tree = (snapshot: string): SessionHierarchy => ({ snapshot_id: snapshot, sessions_root: '/sessions', total: 1,
  years: [{ year: 2026, months: [{ month: 10, days: [{ day: 23, items: [item(0)] }] }] }],
  unfiled_items: [], diagnostics: page().diagnostics })
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function setup(overrides: Partial<NavigatorApi> = {}, preferences?: Pick<Storage, 'getItem' | 'setItem'>,
  feedback?: ReturnType<typeof createStatusController>) {
  const api: NavigatorApi = { reload: async () => page(), flat: async () => page([1]), hierarchy: async snapshot => tree(snapshot), ...overrides }
  const navigator = createNavigator(api, feedback, preferences)
  let state!: Parameters<Parameters<typeof navigator.subscribe>[0]>[0]
  navigator.subscribe(value => { state = value })
  return { navigator, get state() { return state } }
}

test('new Session searches and clearing reject stale pages while preserving mode, paging and reload query', async () => {
  const slow = deferred<{ page: SessionPage; scanned: number; unreadable: number }>()
  const requested: string[] = []
  const summaries: string[] = []
  const s = setup({ search: async (query, progress) => {
    requested.push(query); progress({ scanned: 40, total: 40, unreadable: 0 })
    if (query === 'slow') return slow.promise
    return { page: { ...page(query ? [30] : [0], query || 'all'), total: query ? 1 : 40 }, scanned: 40, unreadable: 0 }
  } })
  await s.navigator.reload()
  const pending = s.navigator.search('slow', text => summaries.push(text))
  await s.navigator.search('latest', text => summaries.push(text))
  assert.equal(s.state.page?.items[0].entry_key, '30')
  slow.resolve({ page: page([3], 'slow'), scanned: 40, unreadable: 0 }); await pending
  assert.equal(s.state.page?.snapshot_id, 'latest')
  assert.deepEqual(summaries, ['1 sessions'])
  await s.navigator.reload()
  assert.equal(requested.at(-1), 'latest')
  await s.navigator.search('', text => summaries.push(text))
  assert.equal(s.state.page?.total, 40)
  assert.equal(summaries.at(-1), '')
})

test('Reload supersedes a search progress Toast and initial search first obtains a source snapshot', async () => {
  const status = createStatusController()
  const slow = deferred<{ page: SessionPage; scanned: number; unreadable: number }>()
  let initialized = false
  const s = setup({ reload: async () => { initialized = true; return page() }, search: async () => {
    assert.equal(initialized, true)
    return slow.promise
  } }, undefined, status)
  const pending = s.navigator.search('first', () => {})
  await Promise.resolve()
  assert.equal(status.current().severity, 'progress')
  const reload = s.navigator.reload()
  slow.resolve({ page: page([2]), scanned: 40, unreadable: 0 })
  await pending; await reload
  assert.equal(status.current().message, 'Ready.')
})

test('view preference restores both modes and loads hierarchy on the fresh snapshot', async () => {
  const saved = new Map<string, string>()
  const preferences = { getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value) } }
  const initial = setup({}, preferences)
  assert.equal(initial.state.mode, 'Flat')
  assert.equal(saved.size, 0, 'initialization does not overwrite preferences')
  await initial.navigator.toggle()
  assert.equal(saved.get(navigatorModePreferenceKey), 'Hierarchical')
  initial.navigator.dispose()

  const snapshots: string[] = []
  const restored = setup({ hierarchy: async snapshot => { snapshots.push(snapshot); return tree(snapshot) } }, preferences)
  assert.equal(restored.state.mode, 'Hierarchical')
  await restored.navigator.reload()
  assert.deepEqual(snapshots, ['a'])
  assert.equal(restored.state.hierarchy?.snapshot_id, restored.state.page?.snapshot_id)
  await restored.navigator.toggle()
  assert.equal(saved.get(navigatorModePreferenceKey), 'Flat')
  restored.navigator.dispose()
  assert.equal(setup({}, preferences).state.mode, 'Flat')
})

test('unknown saved modes default to Flat without overwriting storage', () => {
  for (const value of [null, '', 'flat', 'hierarchical', '{invalid', 'Other', '"Hierarchical"']) {
    const s = setup({}, { getItem: () => value,
      setItem: () => { assert.fail('reading preferences must not write') } })
    assert.equal(s.state.mode, 'Flat')
    s.navigator.dispose()
  }
})

test('unavailable preference storage keeps loading and switching with separate warnings', async () => {
  const feedback = createStatusController()
  let failWrite = true
  const preferences = { getItem: () => { throw new Error('Storage denied') },
    setItem: () => { if (failWrite) throw new Error('Storage denied') } }
  const s = setup({}, preferences, feedback)
  assert.equal(s.state.mode, 'Flat')
  assert.match(feedback.current().message, /could not be read/)
  await s.navigator.reload()
  await s.navigator.toggle()
  assert.equal(s.state.mode, 'Hierarchical')
  assert.equal(s.state.hierarchy?.snapshot_id, 'a')
  assert.equal(s.state.error, null)
  assert.equal(feedback.current().severity, 'warning')
  assert.match(feedback.current().message, /could not be saved/)
  failWrite = false
  await s.navigator.toggle()
  assert.equal(s.state.mode, 'Flat')
  assert.equal(feedback.current().severity, 'info')
  s.navigator.dispose()
})

test('conversation emphasis uses elapsed 7/30-day boundaries and never creation dates', () => {
  const now = Date.UTC(2026, 9, 23); const day = 86400000
  for (const [age, expected] of [[0, 600], [7 * day, 600], [7 * day + 1, 500], [30 * day, 500], [30 * day + 1, 400]]) {
    assert.equal(titleWeight(now - age!, now), expected)
  }
  assert.equal(titleWeight(null, now), 400); assert.equal(titleWeight(NaN, now), 400)
})

test('only explicit ID/file fallbacks use Untitled Session and dynamic title information', () => {
  for (const title_source of ['thread_id', 'file_name']) {
    assert.deepEqual(sessionTitlePresentation({ title_source, title: 'original-fallback', thread_id: '01a16795-5f9e-77a0-8cd4-f55361e09cb0' }),
      { title: 'Untitled Session', info: '01a16795 · Title not found on this device.' })
    assert.deepEqual(sessionTitlePresentation({ title_source, title: 'original-fallback', thread_id: '01a16646-4d39-7253-ab9e-ddd4319f20a0' }),
      { title: 'Untitled Session', info: '01a16646 · Title not found on this device.' })
    for (const thread_id of [null, '', '  ']) {
      assert.deepEqual(sessionTitlePresentation({ title_source, title: 'private-name.jsonl', thread_id }),
        { title: 'Untitled Session', info: 'Title not found on this device.' })
    }
  }
})

test('metadata titles stay unchanged even when they look like fallback text', () => {
  for (const title_source of ['database_name', 'session_index', 'database_title', 'future_source']) {
    for (const title of ['Original title', 'Untitled Session', '01a16795', 'a-session.jsonl']) {
      assert.deepEqual(sessionTitlePresentation({ title_source, title, thread_id: '01a16795-full-id' }), { title, info: null })
    }
  }
})

test('selection matches compressed siblings, Windows extended paths and verified thread IDs', () => {
  assert.equal(sessionPathKey('\\\\?\\C:\\sessions\\a.jsonl.zst'), 'C:/sessions/a.jsonl')
  assert.ok(matchesSelection(item(1), '/1.jsonl.zst', null))
  assert.ok(matchesSelection(item(1), '/moved.jsonl', '1'))
  assert.ok(!matchesSelection(item(1), '', '1'))
})

test('Flat preserves backend order, requests one page at a time, deduplicates and stops at end', async () => {
  const pending = deferred<SessionPage>(); let requests = 0
  const s = setup({ reload: async () => page(Array.from({ length: 20 }, (_, i) => i), 'a', '20'),
    flat: async (snapshot, cursor) => { requests++; assert.equal(snapshot, 'a'); assert.equal(cursor, '20'); return pending.promise } })
  await s.navigator.reload(); assert.equal(s.state.page?.items.length, 20)
  const first = s.navigator.more(); await s.navigator.more(); assert.equal(requests, 1)
  pending.resolve(page([19, 20, 21])); await first
  assert.deepEqual(s.state.page?.items.map(i => i.entry_key), Array.from({ length: 22 }, (_, i) => String(i)))
  await s.navigator.more(); assert.equal(requests, 1)
})

test('mode toggles share snapshot and reuse hierarchy; Reload replaces both caches', async () => {
  let reloads = 0; const snapshots: string[] = []
  const s = setup({ reload: async () => page([0], String(++reloads)), hierarchy: async snapshot => { snapshots.push(snapshot); return tree(snapshot) } })
  assert.equal(s.state.mode, 'Flat'); await s.navigator.reload()
  await s.navigator.toggle(); await s.navigator.toggle(); await s.navigator.toggle()
  assert.deepEqual(snapshots, ['1']); assert.equal(s.state.mode, 'Hierarchical')
  await s.navigator.reload(); assert.deepEqual(snapshots, ['1', '2']); assert.equal(s.state.hierarchy?.snapshot_id, '2')
})

test('old page/hierarchy completions and superseded Reload cannot overwrite a newer snapshot', async () => {
  const oldPage = deferred<SessionPage>(); const oldTree = deferred<SessionHierarchy>(); const oldReload = deferred<SessionPage>()
  let reloads = 0
  const s = setup({ reload: async () => { reloads++; return reloads === 1 ? page([0], 'a', '20') : reloads === 2 ? oldReload.promise : page([2], 'b') },
    flat: () => oldPage.promise, hierarchy: snapshot => snapshot === 'a' ? oldTree.promise : Promise.resolve(tree(snapshot)) })
  await s.navigator.reload(); const pendingPage = s.navigator.more(); const pendingTree = s.navigator.toggle()
  const pendingReload = s.navigator.reload(); await s.navigator.reload()
  oldReload.resolve(page([1], 'old')); oldPage.resolve(page([9], 'a')); oldTree.resolve(tree('a'))
  await Promise.all([pendingPage, pendingTree, pendingReload])
  assert.equal(s.state.page?.snapshot_id, 'b'); assert.equal(s.state.hierarchy?.snapshot_id, 'b')
  assert.deepEqual(s.state.page?.items.map(i => i.entry_key), ['2'])
})

test('snapshot expiry offers Reload; failed Reload retains old list and can retry', async () => {
  let fail = false; let reloads = 0
  const s = setup({ reload: async () => { reloads++; if (fail) throw new Error('offline'); return page([0], String(reloads), '20') },
    flat: async () => { throw { code: 'navigator_snapshot_expired', message: 'Expired' } } })
  await s.navigator.reload(); await s.navigator.more()
  assert.equal(s.state.failedAction, 'reload'); await s.navigator.retry(); assert.equal(reloads, 2)
  fail = true; await s.navigator.reload(); assert.equal(s.state.page?.snapshot_id, '2'); assert.equal(s.state.loading, false)
  fail = false; await s.navigator.retry(); assert.equal(s.state.page?.snapshot_id, '4')
})

test('page and hierarchy failures retry their own requests without replacing the snapshot', async () => {
  let fail = true; let reloads = 0
  const s = setup({ reload: async () => { reloads++; return page([0], 'a', '20') },
    flat: async () => { if (fail) throw new Error('page failed'); return page([1]) },
    hierarchy: async snapshot => { if (fail) throw new Error('tree failed'); return tree(snapshot) } })
  await s.navigator.reload(); await s.navigator.more(); assert.equal(s.state.failedAction, 'flat')
  fail = false; await s.navigator.retry(); assert.equal(s.state.page?.items.length, 2)
  fail = true; await s.navigator.toggle(); assert.equal(s.state.failedAction, 'hierarchy')
  fail = false; await s.navigator.retry(); assert.equal(s.state.hierarchy?.snapshot_id, 'a'); assert.equal(reloads, 1)
})

test('invalid pagination cannot loop forever; disposed requests do not publish', async () => {
  const s = setup({ reload: async () => page([0], 'a', '20'), flat: async () => page([1], 'a', '20') })
  await s.navigator.reload(); await s.navigator.more(); assert.ok(s.state.error); assert.equal(s.state.page?.items.length, 1)
  const pending = deferred<SessionPage>(); const disposed = setup({ reload: () => pending.promise })
  const result = disposed.navigator.reload(); disposed.navigator.dispose(); pending.resolve(page()); await result
  assert.equal(disposed.state.page, null)
})

test('retry after switching modes during a failed page request also loads the hierarchy', async () => {
  let fail = true; let trees = 0
  const s = setup({ reload: async () => page([0], 'a', '20'),
    flat: async () => { if (fail) throw new Error('page failed'); return page([1]) },
    hierarchy: async snapshot => { trees++; return tree(snapshot) } })
  await s.navigator.reload(); await s.navigator.more(); await s.navigator.toggle()
  assert.equal(s.state.hierarchy, null)
  fail = false; await s.navigator.retry()
  assert.equal(s.state.mode, 'Hierarchical'); assert.equal(s.state.hierarchy?.snapshot_id, 'a'); assert.equal(trees, 1)
})
