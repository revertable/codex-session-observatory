import type {
  ApiErrorDto,
  FilterDto,
  LoadedFileMetadataDto,
  ObservedEventCountDto,
  ParseResponseDto,
  ReferencedConversationDto,
  SessionDescriptorDto,
  TranscriptBlockDto,
} from './parse-contract'

export type LoadStatus = 'idle' | 'selected' | 'loading' | 'loaded' | 'error'

export interface SelectedFileState {
  path: string
}

export interface LoadedFileState {
  metadata: LoadedFileMetadataDto | null
  session: SessionDescriptorDto | null
  observed_event_counts: ObservedEventCountDto[]
}

export interface ParsedObservationState {
  transcript_blocks: TranscriptBlockDto[]
  referenced_conversations: ReferencedConversationDto[]
}

export interface LoadWorkflowState {
  status: LoadStatus
  selected_file: SelectedFileState
  loaded_file: LoadedFileState
  all_observations: ParsedObservationState
  observations: ParsedObservationState
  filter: FilterDto
  error: ApiErrorDto | null
}

export const defaultFilterState: FilterDto = {
  show_you: true,
  show_codex: true,
  show_tool_call: false,
  show_tool_result: false,
  show_meta: false,
}

export const sourceLoadFilterState: FilterDto = {
  show_you: true,
  show_codex: true,
  show_tool_call: true,
  show_tool_result: true,
  show_meta: true,
}

type ParseJsonl = (path: string, filter: FilterDto) => Promise<ParseResponseDto>

export function loadAllObservations(
  path: string,
  parseJsonl: ParseJsonl,
): Promise<ParseResponseDto> {
  return parseJsonl(path, { ...sourceLoadFilterState })
}

export function createInitialLoadWorkflowState(): LoadWorkflowState {
  return {
    status: 'idle',
    selected_file: {
      path: '',
    },
    loaded_file: {
      metadata: null,
      session: null,
      observed_event_counts: [],
    },
    all_observations: emptyObservations(),
    observations: emptyObservations(),
    filter: { ...defaultFilterState },
    error: null,
  }
}

export function selectPath(state: LoadWorkflowState, path: string): LoadWorkflowState {
  return {
    ...clearLoadedResult(state),
    status: path.trim() === '' ? 'idle' : 'selected',
    selected_file: {
      path,
    },
  }
}

export function beginLoad(state: LoadWorkflowState): LoadWorkflowState {
  return {
    ...state,
    status: 'loading',
    error: null,
  }
}

export function applyParseResponse(
  state: LoadWorkflowState,
  response: ParseResponseDto,
): LoadWorkflowState {
  const allObservations = {
    transcript_blocks: response.parsed_chat_log.transcript_blocks,
    referenced_conversations: response.parsed_chat_log.referenced_conversations,
  }
  const observations = projectObservations(allObservations, state.filter)

  return {
    ...state,
    status: 'loaded',
    loaded_file: {
      metadata: response.source,
      session: response.session,
      observed_event_counts: response.parsed_chat_log.observed_event_counts,
    },
    all_observations: allObservations,
    observations,
    error: null,
  }
}

export function failLoad(state: LoadWorkflowState, error: ApiErrorDto): LoadWorkflowState {
  // Request failure does not invalidate the last successful load.
  return {
    ...state,
    status: 'error',
    error,
  }
}

export function updateFilter(
  state: LoadWorkflowState,
  key: keyof FilterDto,
  value: boolean,
): LoadWorkflowState {
  const filter = {
    ...state.filter,
    [key]: value,
  }
  const observations = projectObservations(state.all_observations, filter)

  return {
    ...state,
    observations,
    filter,
  }
}

function projectObservations(
  observations: ParsedObservationState,
  filter: FilterDto,
): ParsedObservationState {
  return {
    transcript_blocks: observations.transcript_blocks.filter((block) =>
      filterAllowsKind(block.entry_type, filter),
    ),
    referenced_conversations: observations.referenced_conversations,
  }
}

function filterAllowsKind(kind: TranscriptBlockDto['entry_type'], filter: FilterDto): boolean {
  switch (kind) {
    case 'you':
      return filter.show_you
    case 'codex':
      return filter.show_codex
    case 'tool_call':
      return filter.show_tool_call
    case 'tool_result':
      return filter.show_tool_result
    case 'context':
    case 'task':
    case 'system':
      return filter.show_meta
  }
}

function clearLoadedResult(state: LoadWorkflowState): LoadWorkflowState {
  return {
    ...state,
    loaded_file: {
      metadata: null,
      session: null,
      observed_event_counts: [],
    },
    all_observations: emptyObservations(),
    observations: emptyObservations(),
    error: null,
  }
}

function emptyObservations(): ParsedObservationState {
  return {
    transcript_blocks: [],
    referenced_conversations: [],
  }
}
