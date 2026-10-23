import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { ApiErrorDto, ErrorResponseDto, FilterDto, ParseResponseDto } from './parse-contract'
import type { LocateParentSessionResponse } from './parent-session-contract'
import type { ExportWorklogResponse } from './worklog-contract'
import type { NavigatorApi, SessionPage, SessionHierarchy } from './session-navigator/contract'

async function navigatorInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(command, args) }
  catch (error) { throw normalizeApiError(error) }
}

export const sessionNavigatorApi: NavigatorApi = {
  reload: () => navigatorInvoke<SessionPage>('reload_session_navigator'),
  flat: (snapshot_id, cursor) => navigatorInvoke<SessionPage>('list_sessions_flat', { request: { snapshot_id, cursor } }),
  hierarchy: (snapshot_id) => navigatorInvoke<SessionHierarchy>('list_sessions_hierarchy', { request: { snapshot_id } }),
}

let lastSelectedDirectory: string | null = null
let lastWorklogParentDirectory: string | null = null

export function getAppVersion(): Promise<string> {
  return getVersion()
}

export async function selectJsonlPath(): Promise<string | null> {
  const defaultPath = await invoke<string>('resolve_jsonl_initial_directory', {
    rememberedDirectory: lastSelectedDirectory,
  })
  const selected = await open({
    defaultPath,
    multiple: false,
    directory: false,
    filters: [
      {
        name: 'Codex JSONL',
        extensions: ['jsonl', 'jsonl.zst'],
      },
    ],
  })

  if (typeof selected !== 'string') {
    return null
  }

  lastSelectedDirectory = parentDirectory(selected)
  return selected
}

export async function parseSelectedJsonl(
  path: string,
  filter: FilterDto,
): Promise<ParseResponseDto> {
  try {
    return await invoke<ParseResponseDto>('parse_selected_jsonl', { path, filter })
  } catch (error) {
    throw normalizeApiError(error)
  }
}

export async function locateParentSession(
  currentPath: string,
  parentThreadId: string,
): Promise<LocateParentSessionResponse> {
  try {
    return await invoke<LocateParentSessionResponse>('locate_parent_session', {
      currentPath,
      parentThreadId,
    })
  } catch (error) {
    throw normalizeApiError(error)
  }
}

export async function selectWorklogParentDirectory(sourcePath: string): Promise<string | null> {
  const selected = await open({
    defaultPath: lastWorklogParentDirectory ?? parentDirectory(sourcePath) ?? undefined,
    multiple: false,
    directory: true,
    title: 'Select Worklog Export Parent',
  })

  if (typeof selected !== 'string') {
    return null
  }

  lastWorklogParentDirectory = selected
  return selected
}

export async function exportWorklog(
  sourcePath: string,
  parentDirectory: string,
): Promise<ExportWorklogResponse> {
  try {
    return await invoke<ExportWorklogResponse>('export_worklog', {
      sourcePath,
      parentDirectory,
    })
  } catch (error) {
    throw normalizeApiError(error)
  }
}

function normalizeApiError(error: unknown): ApiErrorDto {
  if (isErrorResponse(error)) {
    return error.error
  }

  if (error instanceof Error) {
    return {
      code: 'tauri_command_failed',
      message: error.message,
    }
  }

  return {
    code: 'tauri_command_failed',
    message: String(error),
  }
}

function isErrorResponse(error: unknown): error is ErrorResponseDto {
  const candidate = error as ErrorResponseDto

  return (
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    typeof candidate.error === 'object' &&
    candidate.error !== null &&
    typeof candidate.error.code === 'string' &&
    typeof candidate.error.message === 'string'
  )
}

function parentDirectory(path: string): string | null {
  const normalized = path.replace(/[/\\]+$/, '')
  const lastSeparator = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))

  if (lastSeparator <= 0) {
    return null
  }

  return normalized.slice(0, lastSeparator)
}
