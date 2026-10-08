import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyParseResponse,
  createInitialLoadWorkflowState,
  defaultFilterState,
  loadAllObservations,
  sourceLoadFilterState,
  updateFilter,
} from '../src/lib/load-workflow.ts'
import type { ParseResponseDto } from '../src/lib/parse-contract.ts'

const responseWithToolCall: ParseResponseDto = {
  source: {
    file_name: 'session.jsonl',
    absolute_path: 'C:\\logs\\session.jsonl',
    session_id: 'session-1',
    resume_command: null,
  },
  session: {
    classification: 'interactive',
    identity: null,
    capabilities: {
      can_show_transcript: true,
      can_resume: false,
      can_export_worklog: true,
      can_open_parent_session: false,
    },
  },
  parsed_chat_log: {
    entries: [
      { kind: 'you', label: 'YOU', content: 'Inspect the session.' },
      { kind: 'codex', label: 'CODEX', content: 'Inspecting.' },
      { kind: 'tool_call', label: 'TOOL CALL', content: 'read_file' },
    ],
    transcript_blocks: [
      {
        entry_type: 'you',
        label: 'YOU',
        title: 'User',
        timestamp: '2026-09-18T23:59:58Z',
        content: 'Inspect the session.',
      },
      {
        entry_type: 'codex',
        label: 'CODEX',
        title: 'Assistant',
        timestamp: '2026-09-19T00:00:02Z',
        content: 'Inspecting.',
      },
      {
        entry_type: 'tool_call',
        label: 'TOOL CALL',
        title: 'read_file',
        timestamp: null,
        content: 'read_file',
      },
    ],
    referenced_conversations: [],
    counters: {
      parsed_candidates: 3,
      total_entries: 3,
      visible_entries: 3,
      ignored_lines: 0,
      malformed_lines: 0,
    },
    observed_event_counts: [{ event: 'custom_tool_call', count: 1 }],
  },
}

test('canonical question stays Codex while tool call and user message keep their filters', () => {
  const response: ParseResponseDto = structuredClone(responseWithToolCall)
  const question = 'Choose?\n- a\n- b'
  response.parsed_chat_log.entries[1].content = question
  response.parsed_chat_log.transcript_blocks[1].content = question
  response.parsed_chat_log.entries[0].content = 'a'
  response.parsed_chat_log.transcript_blocks[0].content = 'a'
  response.parsed_chat_log.entries[2].content = 'Function call: request_user_input_async'
  const loaded = applyParseResponse(createInitialLoadWorkflowState(), response)
  assert.deepEqual(loaded.observations.transcript_blocks.map((entry) => [entry.entry_type, entry.content]), [
    ['you', 'a'], ['codex', question],
  ])
  const tools = updateFilter(loaded, 'show_tool_call', true)
  assert.deepEqual(tools.observations.transcript_blocks.map((entry) => entry.entry_type), ['you', 'codex', 'tool_call'])
  const hidden = updateFilter(loaded, 'show_codex', false)
  assert.deepEqual(hidden.observations.transcript_blocks.map((entry) => [entry.entry_type, entry.content]), [['you', 'a']])
})

test('initial load preserves all observations before applying display filters', async () => {
  let requestedPath: string | undefined
  let requestedFilter: typeof sourceLoadFilterState | undefined

  const response = await loadAllObservations('C:\\logs\\session.jsonl', async (path, filter) => {
    requestedPath = path
    requestedFilter = { ...filter }
    return responseWithToolCall
  })

  assert.equal(requestedPath, 'C:\\logs\\session.jsonl')
  assert.deepEqual(requestedFilter, {
    show_you: true,
    show_codex: true,
    show_tool_call: true,
    show_tool_result: true,
    show_meta: true,
  })
  assert.deepEqual(defaultFilterState, {
    show_you: true,
    show_codex: true,
    show_tool_call: false,
    show_tool_result: false,
    show_meta: false,
  })

  const loaded = applyParseResponse(createInitialLoadWorkflowState(), response)

  assert.deepEqual(
    loaded.all_observations.transcript_blocks.map((block) => block.entry_type),
    ['you', 'codex', 'tool_call'],
  )
  assert.deepEqual(
    loaded.observations.transcript_blocks.map((block) => block.entry_type),
    ['you', 'codex'],
  )
  assert.deepEqual(
    loaded.observations.transcript_blocks.map((block) => [block.content, block.timestamp]),
    [
      ['Inspect the session.', '2026-09-18T23:59:58Z'],
      ['Inspecting.', '2026-09-19T00:00:02Z'],
    ],
  )

  const toolCallsVisible = updateFilter(loaded, 'show_tool_call', true)

  assert.deepEqual(
    toolCallsVisible.observations.transcript_blocks.map((block) => block.entry_type),
    ['you', 'codex', 'tool_call'],
  )
  assert.deepEqual(
    toolCallsVisible.observations.transcript_blocks.map((block) => block.timestamp),
    ['2026-09-18T23:59:58Z', '2026-09-19T00:00:02Z', null],
  )
  assert.deepEqual(toolCallsVisible.all_observations, loaded.all_observations)
})
