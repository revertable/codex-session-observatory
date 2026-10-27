export type Severity = 'info' | 'progress' | 'success' | 'warning' | 'error'
export interface Feedback { message: string; severity: Severity }
export interface StatusToken { scope: string; id: number; sessionBound: boolean }
const priority: Record<Severity, number> = { info: 1, success: 1, progress: 2, warning: 3, error: 4 }

/** One owner per App. Request tokens protect feedback independently of data loading. */
export function createStatusController() {
  let sequence = 0
  let alive = true
  const entries = new Map<string, { token: StatusToken; feedback: Feedback; order: number }>()
  const listeners = new Set<(value: Feedback) => void>()
  const current = (): Feedback => [...entries.values()].filter(e => e.feedback.message)
    .sort((a, b) => priority[b.feedback.severity] - priority[a.feedback.severity] || b.order - a.order)[0]?.feedback
    ?? { message: 'Ready.', severity: 'info' }
  const publish = () => { if (alive) for (const listener of listeners) listener(current()) }
  return {
    current,
    subscribe(listener: (value: Feedback) => void) { listeners.add(listener); listener(current()); return () => { listeners.delete(listener) } },
    begin(scope: string, message = '', sessionBound = false): StatusToken {
      const token = { scope, id: ++sequence, sessionBound }
      if (!alive) return token
      // A new intentional action replaces ordinary results, never another action's warning/error.
      for (const [key, entry] of entries) if (['info', 'success'].includes(entry.feedback.severity)) entries.delete(key)
      entries.set(scope, { token, feedback: { message, severity: 'progress' }, order: sequence })
      publish(); return token
    },
    finish(token: StatusToken | undefined, severity: Severity = 'info', message = '') {
      if (!alive || !token || entries.get(token.scope)?.token !== token) return false
      if (message) entries.set(token.scope, { token, feedback: { message, severity }, order: ++sequence })
      else entries.delete(token.scope)
      publish(); return true
    },
    clear(scope: string) { entries.delete(scope); publish() },
    dismiss(value: Feedback) {
      // A dismissed result must not mask later operations or remove active progress.
      if (!alive || value.severity === 'progress') return false
      for (const [scope, entry] of entries) {
        if (entry.feedback !== value) continue
        entries.delete(scope); publish(); return true
      }
      return false
    },
    invalidateSession() {
      for (const [key, entry] of entries) if (entry.token.sessionBound) entries.delete(key)
      publish()
    },
    dispose() { alive = false; entries.clear(); listeners.clear() },
  }
}
export type StatusController = ReturnType<typeof createStatusController>
