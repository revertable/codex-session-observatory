import type { StatusController, StatusToken } from '../control-room/status-line'
import type { ApiErrorDto } from '../parse-contract'
import type { NavigatorApi, SessionHierarchy, SessionPage, SessionSummary } from './contract'

export type NavigatorMode = 'Flat' | 'Hierarchical'
export const navigatorModePreferenceKey = 'observatory.navigator-mode.v1'
export interface NavigatorState {
  mode: NavigatorMode
  page: SessionPage | null
  hierarchy: SessionHierarchy | null
  loading: boolean
  loadingMore: boolean
  loadingHierarchy: boolean
  error: ApiErrorDto | null
  failedAction: 'reload' | 'flat' | 'hierarchy' | null
}

export function titleWeight(timestamp: number | null, now: number): 400 | 500 | 600 {
  if (timestamp === null || !Number.isFinite(timestamp)) return 400
  const age = Math.max(0, now - timestamp)
  return age <= 7 * 86400000 ? 600 : age <= 30 * 86400000 ? 500 : 400
}

// A restored/plain file and its compressed sibling represent the same selection.
export function sessionPathKey(path: string): string {
  return path.replace(/^\\\\\?\\/, '').replaceAll('\\', '/').replace(/\.jsonl\.zst$/, '.jsonl')
}

export function matchesSelection(item: SessionSummary, path: string, threadId: string | null): boolean {
  return path !== '' && (sessionPathKey(item.path) === sessionPathKey(path) ||
    (threadId !== null && item.thread_id === threadId))
}

function asError(error: unknown): ApiErrorDto {
  const value = error as Partial<ApiErrorDto> | null
  return { code: typeof value?.code === 'string' ? value.code : 'navigator_request_failed',
    message: typeof value?.message === 'string' ? value.message : String(error) }
}

/** Independent from transcript state. A generation owns all requests on a snapshot. */
export function createNavigator(api: NavigatorApi, feedback?: StatusController,
  preferences?: Pick<Storage, 'getItem' | 'setItem'>) {
  let mode: NavigatorMode = 'Flat'
  try {
    if (preferences?.getItem(navigatorModePreferenceKey) === 'Hierarchical') mode = 'Hierarchical'
  } catch {
    const token = feedback?.begin('navigator-mode')
    feedback?.finish(token, 'warning', 'Saved session view could not be read. Using Flat.')
  }
  let state: NavigatorState = { mode, page: null, hierarchy: null, loading: false,
    loadingMore: false, loadingHierarchy: false, error: null, failedAction: null }
  let generation = 0
  const listeners = new Set<(state: NavigatorState) => void>()
  let feedbackToken: StatusToken | undefined
  const publish = (patch: Partial<NavigatorState>) => {
    const wasBusy = state.loading || state.loadingMore || state.loadingHierarchy
    const previousError = state.error
    state = { ...state, ...patch }
    const busy = state.loading || state.loadingMore || state.loadingHierarchy
    if (busy && (!wasBusy || patch.loading === true)) {
      feedbackToken = feedback?.begin('sessions', state.loading ? 'Loading sessions…'
        : state.loadingHierarchy ? 'Loading hierarchy…' : 'Loading more sessions…')
    }
    if (state.error && state.error !== previousError) {
      feedbackToken ??= feedback?.begin('sessions')
      feedback?.finish(feedbackToken, 'error', state.error.message + (state.error.code === 'navigator_snapshot_expired'
        ? ' The session list has expired. Reload Sessions to retry.' : ''))
    } else if (wasBusy && !busy && !state.error) feedback?.finish(feedbackToken)
    for (const listener of listeners) listener(state)
  }
  function fail(error: unknown, action: NonNullable<NavigatorState['failedAction']>) {
    const normalized = asError(error)
    publish({ error: normalized, failedAction: normalized.code === 'navigator_snapshot_expired' ? 'reload' : action })
  }
  async function hierarchy() {
    if (!state.page || state.loading || state.loadingHierarchy || state.hierarchy) return
    const token = generation
    const snapshot = state.page.snapshot_id
    publish({ loadingHierarchy: true, error: null, failedAction: null })
    try {
      const result = await api.hierarchy(snapshot)
      if (token !== generation) return
      if (result.snapshot_id !== snapshot) throw new Error('Session snapshot changed. Reload Sessions to retry.')
      publish({ hierarchy: result })
    } catch (error) { if (token === generation) fail(error, 'hierarchy') }
    finally { if (token === generation) publish({ loadingHierarchy: false }) }
  }
  async function reload() {
    const token = ++generation
    publish({ loading: true, loadingMore: false, loadingHierarchy: false, error: null, failedAction: null })
    try {
      const page = await api.reload()
      if (token !== generation) return
      publish({ page, hierarchy: null })
    } catch (error) { if (token === generation) fail(error, 'reload') }
    finally {
      if (token === generation) {
        publish({ loading: false })
        if (state.mode === 'Hierarchical' && !state.error) await hierarchy()
      }
    }
  }
  async function more() {
    const page = state.page
    if (!page || !page.has_more || !page.next_cursor || state.loading || state.loadingMore || state.error) return
    const token = generation
    publish({ loadingMore: true })
    try {
      const next = await api.flat(page.snapshot_id, page.next_cursor)
      if (token !== generation) return
      if (next.snapshot_id !== page.snapshot_id || (next.has_more && (!next.next_cursor || next.next_cursor === page.next_cursor))) {
        throw new Error('Invalid session page. Reload Sessions to retry.')
      }
      const seen = new Set(page.items.map(item => item.entry_key))
      const added = next.items.filter(item => { if (seen.has(item.entry_key)) return false; seen.add(item.entry_key); return true })
      publish({ page: { ...next, items: [...page.items, ...added] } })
    } catch (error) { if (token === generation) fail(error, 'flat') }
    finally { if (token === generation) publish({ loadingMore: false }) }
  }
  return {
    subscribe(listener: (state: NavigatorState) => void) {
      listeners.add(listener); listener(state); return () => { listeners.delete(listener) }
    },
    reload, more,
    async toggle() {
      publish({ mode: state.mode === 'Flat' ? 'Hierarchical' : 'Flat' })
      const token = feedback?.begin('navigator-mode')
      try {
        preferences?.setItem(navigatorModePreferenceKey, state.mode)
        feedback?.finish(token)
      } catch {
        feedback?.finish(token, 'warning', 'Session view applies for this session, but could not be saved.')
      }
      if (state.mode === 'Hierarchical' && !state.error) await hierarchy()
    },
    async retry() {
      const action = state.failedAction
      publish({ error: null, failedAction: null })
      if (action === 'flat') await more()
      else if (action === 'hierarchy') await hierarchy()
      else await reload()
      if (state.mode === 'Hierarchical' && !state.error) await hierarchy()
    },
    dispose() { generation++; listeners.clear() },
  }
}
