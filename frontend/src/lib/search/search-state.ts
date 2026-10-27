export type SearchTarget = 'Session' | 'Transcript'
export interface SearchState {
  target: SearchTarget
  draft: string
  queries: Record<SearchTarget, string>
  requests: Record<SearchTarget, number>
  summaries: Record<SearchTarget, string>
}

/** Search scope and requests stay independent of filters and Collection. */
export function createSearchState() {
  let state: SearchState = { target: 'Session', draft: '',
    queries: { Session: '', Transcript: '' }, requests: { Session: 0, Transcript: 0 }, summaries: { Session: '', Transcript: '' } }
  const listeners = new Set<(state: SearchState) => void>()
  const publish = (next: SearchState) => { state = next; for (const listener of listeners) listener(state) }
  const execute = () => publish({ ...state, queries: { ...state.queries, [state.target]: state.draft.trim() },
    requests: { ...state.requests, [state.target]: state.requests[state.target] + 1 } })
  return {
    subscribe(listener: (value: SearchState) => void) { listeners.add(listener); listener(state); return () => { listeners.delete(listener) } },
    target(target: SearchTarget) { publish({ ...state, target }) },
    input(draft: string) { publish({ ...state, draft }) },
    submit: execute,
    summary(target: SearchTarget, text: string) {
      if (state.summaries[target] !== text) publish({ ...state, summaries: { ...state.summaries, [target]: text } })
    },
  }
}
export type SearchController = ReturnType<typeof createSearchState>
