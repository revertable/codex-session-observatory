import type { SessionSummary } from './contract'

export function sessionTitlePresentation(item: Pick<SessionSummary, 'title' | 'title_source' | 'thread_id'>) {
  const missing = item.title_source === 'thread_id' || item.title_source === 'file_name'
  const id = item.thread_id?.trim()
  return {
    title: missing ? 'Untitled Session' : item.title,
    info: missing ? `${id ? id.slice(0, 8) + ' · ' : ''}Title not found on this device.` : null,
  }
}
