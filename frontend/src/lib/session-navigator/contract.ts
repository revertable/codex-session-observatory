export interface SessionSummary {
  entry_key: string
  thread_id: string | null
  path: string
  title: string
  title_source: string
  created_at_ms: number | null
  created_at_source: string
  last_conversation_at_ms: number | null
  last_conversation_at_source: string
  storage_date: string | null
  classification: string
  thread_source: string | null
}

export interface NavigatorDiagnostics {
  discovered_files: number
  guardian_sessions: number
  duplicate_files: number
  unreadable_files: number
  warnings: string[]
}

export interface SessionPage {
  snapshot_id: string
  sessions_root: string
  total: number
  items: SessionSummary[]
  next_cursor: string | null
  has_more: boolean
  diagnostics: NavigatorDiagnostics
}

export interface SessionHierarchy {
  snapshot_id: string
  sessions_root: string
  total: number
  years: { year: number; months: { month: number; days: { day: number; items: SessionSummary[] }[] }[] }[]
  unfiled_items: SessionSummary[]
  diagnostics: NavigatorDiagnostics
}

export interface NavigatorApi {
  reload(): Promise<SessionPage>
  flat(snapshot: string, cursor: string): Promise<SessionPage>
  hierarchy(snapshot: string): Promise<SessionHierarchy>
  search?(query: string, progress: (value: SearchProgress) => void): Promise<SessionSearchResult>
}

export interface SearchProgress { scanned: number; total: number; unreadable: number }
export interface SessionSearchResult { page: SessionPage; scanned: number; unreadable: number }

export interface NavigatorTarget { snapshot_id: string; entry_key: string }
