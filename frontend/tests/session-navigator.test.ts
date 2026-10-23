import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNavigator, matchesSelection, sessionPathKey, titleWeight } from '../src/lib/session-navigator/state.ts'
import { sessionTitlePresentation } from '../src/lib/session-navigator/title-presentation.ts'
import type { NavigatorApi, SessionPage, SessionHierarchy, SessionSummary } from '../src/lib/session-navigator/contract.ts'

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
function setup(overrides: Partial<NavigatorApi> = {}) {
  const api: NavigatorApi = { reload: async () => page(), flat: async () => page([1]), hierarchy: async snapshot => tree(snapshot), ...overrides }
  const navigator = createNavigator(api)
  let state!: Parameters<Parameters<typeof navigator.subscribe>[0]>[0]
  navigator.subscribe(value => { state = value })
  return { navigator, get state() { return state } }
}

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
