export const panelLimits = { sessions: 220, transcript: 360, collection: 260, separator: 8 } as const
export const initialWidths = { sessions: 260, collection: 300 }
export type Side = 'sessions' | 'collection'

/** Desired widths survive temporary constraints and hidden panels. */
export function fitWorkspace(width: number, desired: Record<Side, number>, sessionsOpen: boolean, collectionOpen: boolean) {
  const available = Math.max(0, width - panelLimits.separator * (Number(sessionsOpen) + Number(collectionOpen)))
  const left = sessionsOpen ? Math.max(panelLimits.sessions, desired.sessions) : 0
  const right = collectionOpen ? Math.max(panelLimits.collection, desired.collection) : 0
  const minimumLeft = sessionsOpen ? panelLimits.sessions : 0
  const minimumRight = collectionOpen ? panelLimits.collection : 0
  const extras = left + right - minimumLeft - minimumRight
  const room = Math.max(0, available - panelLimits.transcript - minimumLeft - minimumRight)
  const ratio = extras > 0 ? Math.min(1, room / extras) : 0
  const sessions = minimumLeft + (left - minimumLeft) * ratio
  const collection = minimumRight + (right - minimumRight) * ratio
  return { sessions, collection, transcript: Math.max(0, available - sessions - collection) }
}
