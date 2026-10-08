import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyParseResponse,
  beginLoad,
  createInitialLoadWorkflowState,
  updateFilter,
} from '../src/lib/load-workflow.ts'
import type {
  ParseResponseDto,
  TranscriptBlockDto,
} from '../src/lib/parse-contract.ts'
import { serializeTranscript } from '../src/lib/rendering/transcript-capture.ts'
import { formatEntryTimestamp } from '../src/lib/rendering/entry-timestamp.ts'
import { transcriptScopeChanged } from '../src/lib/rendering/transcript-scope.ts'

const blocks: TranscriptBlockDto[] = [
  {
    entry_type: 'you',
    label: '[YOU]',
    title: '[YOU]',
    timestamp: null,
    content: 'First line\nSecond line',
  },
  {
    entry_type: 'codex',
    label: '[CODEX]',
    title: '[CODEX]',
    timestamp: null,
    content: 'Answer',
  },
]

const references = [
  {
    conversation_id: 'conversation-1',
    title: 'Reference title',
    preview_available: false,
  },
]

const observedEventCounts = [
  { event: 'event_b', count: 1 },
  { event: 'event_a', count: 2 },
]

test('question text and ordered options survive every capture presentation', () => {
  const content = 'Choose?\n- second\n- first'
  const question: TranscriptBlockDto = {
    entry_type: 'codex', label: '[CODEX]', title: '[CODEX]', timestamp: null, content,
  }
  for (const theme of ['Terminal Style', 'Markdown Style', 'DM Style', 'DM Style (Dark)'] as const) {
    const captured = serializeTranscript({
      theme, blocks: [question], references: [], observedEventCounts: [], collapsedBlocks: {},
    })
    assert.ok(captured.includes(content))
    assert.equal(captured.split(content).length - 1, 1)
    const collapsed = serializeTranscript({
      theme, blocks: [question], references: [], observedEventCounts: [], collapsedBlocks: { 0: true },
    })
    assert.ok(!collapsed.includes(content))
  }
})

test('Terminal capture includes references, separators, expanded content, and collapsed headers', () => {
  const transcript = serializeTranscript({
    theme: 'Terminal Style',
    blocks,
    references,
    observedEventCounts,
    collapsedBlocks: { 1: true },
  })

  assert.equal(
    transcript,
    [
      'Codex Session Observatory',
      ' ',
      ' ',
      '========================================================================',
      ' ',
      ' ',
      '',
      'REFERENCED CHATGPT CONVERSATION',
      '',
      'TITLE',
      'Reference title',
      'CONVERSATION ID',
      'conversation-1',
      ' ',
      ' ',
      '[v] [YOU]',
      ' ',
      'First line',
      'Second line',
      ' ',
      '[>] [CODEX]',
      ' ',
      '  ',
      ' ',
      '========================================================================',
    ].join('\n'),
  )
})

test('Markdown capture follows the component text order and omits collapsed content', () => {
  const transcript = serializeTranscript({
    theme: 'Markdown Style',
    blocks,
    references,
    observedEventCounts,
    collapsedBlocks: { 1: true },
  })

  assert.equal(
    transcript,
    [
      'MARKDOWN STYLE',
      '',
      'Codex Session Observatory',
      '',
      'REFERENCED CHATGPT CONVERSATION',
      '',
      'TITLE',
      'Reference title',
      'CONVERSATION ID',
      'conversation-1',
      'v',
      '[YOU]',
      'First line',
      'Second line',
      '>',
      '[CODEX]',
    ].join('\n'),
  )
})

test('DM and DM Dark capture preserve their selected theme labels', () => {
  const common = {
    blocks,
    references: [],
    observedEventCounts: [],
    collapsedBlocks: {},
  }

  assert.equal(
    serializeTranscript({ theme: 'DM Style', ...common }),
    [
      'Codex Session Observatory',
      'DM Style',
      'v',
      '[YOU]',
      'First line',
      'Second line',
      'v',
      '[CODEX]',
      'Answer',
    ].join('\n'),
  )
  assert.equal(
    serializeTranscript({ theme: 'DM Style (Dark)', ...common }),
    [
      'Codex Session Observatory',
      'DM Style (Dark)',
      'v',
      '[YOU]',
      'First line',
      'Second line',
      'v',
      '[CODEX]',
      'Answer',
    ].join('\n'),
  )
})

test('empty capture preserves each renderer empty state and sorted event counts', () => {
  const common = {
    blocks: [],
    references: [],
    observedEventCounts,
    collapsedBlocks: {},
  }

  assert.equal(
    serializeTranscript({ theme: 'Terminal Style', ...common }),
    [
      'Codex Session Observatory',
      ' ',
      ' ',
      '========================================================================',
      ' ',
      '  ',
      'No renderable chat messages found in this JSONL file.',
      ' ',
      ' ',
      'Observed event types:',
      ' ',
      '- event_a: 2',
      '- event_b: 1',
      ' ',
      ' ',
      '========================================================================',
    ].join('\n'),
  )
  assert.equal(
    serializeTranscript({ theme: 'Markdown Style', ...common }),
    [
      'MARKDOWN STYLE',
      '',
      'Codex Session Observatory',
      '',
      'No renderable chat messages found in this JSONL file.',
      '',
      'Observed event types',
      'event_a: 2',
      'event_b: 1',
    ].join('\n'),
  )
  assert.equal(
    serializeTranscript({ theme: 'DM Style', ...common }),
    [
      'Codex Session Observatory',
      'DM Style',
      '',
      'No renderable chat messages found in this JSONL file.',
      '',
      'Observed event types:',
      '',
      'event_a: 2',
      'event_b: 1',
    ].join('\n'),
  )
})

test('capture uses the current frontend filter projection without changing block order', () => {
  const loaded = applyParseResponse(createInitialLoadWorkflowState(), responseFixture())
  const withToolResults = updateFilter(loaded, 'show_tool_result', true)
  const codexHidden = updateFilter(withToolResults, 'show_codex', false)

  assert.equal(
    serializeTranscript({
      theme: 'DM Style',
      blocks: codexHidden.observations.transcript_blocks,
      references: codexHidden.observations.referenced_conversations,
      observedEventCounts: codexHidden.loaded_file.observed_event_counts,
      collapsedBlocks: {},
    }),
    [
      'Codex Session Observatory',
      'DM Style',
      'v',
      '[YOU]',
      'request',
      'v',
      '[RESULT]',
      'tool output',
    ].join('\n'),
  )
})

test('all frontend filter combinations preserve the selected block order in capture', () => {
  const allKinds: TranscriptBlockDto[] = [
    { entry_type: 'you', label: '[YOU]', title: '[YOU]', timestamp: null, content: 'content-you' },
    { entry_type: 'codex', label: '[CODEX]', title: '[CODEX]', timestamp: null, content: 'content-codex' },
    {
      entry_type: 'tool_call',
      label: '[TOOL CALL]',
      title: '[TOOL CALL]',
      timestamp: null,
      content: 'content-tool-call',
    },
    {
      entry_type: 'tool_result',
      label: '[TOOL RESULT]',
      title: '[TOOL RESULT]',
      timestamp: null,
      content: 'content-tool-result',
    },
    { entry_type: 'context', label: '[CONTEXT]', title: '[CONTEXT]', timestamp: null, content: 'content-context' },
    { entry_type: 'task', label: '[TASK]', title: '[TASK]', timestamp: null, content: 'content-task' },
    { entry_type: 'system', label: '[SYSTEM]', title: '[SYSTEM]', timestamp: null, content: 'content-system' },
  ]
  const response = responseFixture()
  response.parsed_chat_log.transcript_blocks = allKinds
  const loaded = applyParseResponse(createInitialLoadWorkflowState(), response)
  const filterKeys = [
    'show_you',
    'show_codex',
    'show_tool_call',
    'show_tool_result',
    'show_meta',
  ] as const

  for (let mask = 0; mask < 32; mask += 1) {
    let filtered = loaded
    filterKeys.forEach((key, index) => {
      filtered = updateFilter(filtered, key, (mask & (1 << index)) !== 0)
    })
    const capturedContents = serializeTranscript({
      theme: 'DM Style',
      blocks: filtered.observations.transcript_blocks,
      references: [],
      observedEventCounts: [],
      collapsedBlocks: {},
    })
      .split('\n')
      .filter((line) => line.startsWith('content-'))
    const expectedContents = allKinds
      .filter((block) => {
        switch (block.entry_type) {
          case 'you':
            return (mask & 1) !== 0
          case 'codex':
            return (mask & 2) !== 0
          case 'tool_call':
            return (mask & 4) !== 0
          case 'tool_result':
            return (mask & 8) !== 0
          case 'context':
          case 'task':
          case 'system':
            return (mask & 16) !== 0
        }
      })
      .map((block) => block.content)

    assert.deepEqual(capturedContents, expectedContents, `filter mask ${mask}`)
  }
})

test('entry timestamps use local calendar fields and reject missing or invalid values', () => {
  const source = '2026-09-19T00:00:02Z'
  const instant = new Date(source)
  const twoDigits = (value: number) => value.toString().padStart(2, '0')
  const expected = `${instant.getFullYear()}-${twoDigits(instant.getMonth() + 1)}-${twoDigits(instant.getDate())} ${twoDigits(instant.getHours())}:${twoDigits(instant.getMinutes())}:${twoDigits(instant.getSeconds())}`

  assert.deepEqual(formatEntryTimestamp(source), { datetime: source, label: expected })
  assert.equal(formatEntryTimestamp(null), null)
  assert.equal(formatEntryTimestamp(''), null)
  assert.equal(formatEntryTimestamp('not-a-timestamp'), null)
  assert.equal(formatEntryTimestamp('2026-09-19T00:00:02'), null)
})

test('all themes capture each available local timestamp with its original block', () => {
  const timestampedBlocks: TranscriptBlockDto[] = [
    {
      entry_type: 'you',
      label: '[YOU]',
      title: '[YOU]',
      timestamp: '2026-09-18T23:59:58Z',
      content: 'before resume',
    },
    {
      entry_type: 'codex',
      label: '[CODEX]',
      title: '[CODEX]',
      timestamp: '2026-09-20T08:15:00+09:00',
      content: 'after resume',
    },
    {
      entry_type: 'tool_result',
      label: '[TOOL RESULT]',
      title: '[TOOL RESULT]',
      timestamp: null,
      content: 'without timestamp',
    },
  ]
  const expectedLabels = timestampedBlocks
    .map((block) => formatEntryTimestamp(block.timestamp)?.label ?? null)
    .filter((label): label is string => label !== null)
  const themes = ['Terminal Style', 'Markdown Style', 'DM Style', 'DM Style (Dark)'] as const

  themes.forEach((theme) => {
    const transcript = serializeTranscript({
      theme,
      blocks: timestampedBlocks,
      references: [],
      observedEventCounts: [],
      collapsedBlocks: { 1: true },
    })

    expectedLabels.forEach((label) => {
      assert.equal(transcript.split(label).length - 1, 1, `${theme}: ${label}`)
    })
    assert.equal(transcript.includes('null'), false)
    assert.equal(transcript.includes('Invalid Date'), false)
  })
})

test('transcript scope preserves refresh state but resets collapse when its identity changes', () => {
  const idle = createInitialLoadWorkflowState()
  const loading = beginLoad(idle)
  const loaded = applyParseResponse(loading, responseFixture())
  const refreshed = applyParseResponse(beginLoad(loaded), responseFixture())

  assert.equal(transcriptScopeChanged(idle, 'Terminal Style', loading, 'Terminal Style'), false)
  assert.equal(transcriptScopeChanged(loaded, 'Terminal Style', refreshed, 'Terminal Style'), false)
  assert.equal(
    transcriptScopeChanged(
      loaded,
      'Terminal Style',
      updateFilter(loaded, 'show_tool_result', true),
      'Terminal Style',
    ),
    true,
  )
  assert.equal(transcriptScopeChanged(loaded, 'Terminal Style', loaded, 'Markdown Style'), true)
  assert.equal(transcriptScopeChanged(idle, 'Terminal Style', loaded, 'Terminal Style'), true)
})

function responseFixture(): ParseResponseDto {
  return {
    source: {
      file_name: 'fixture.jsonl',
      absolute_path: 'C:\\fixtures\\fixture.jsonl',
      session_id: 'session-1',
      resume_command: null,
    },
    session: {
      classification: 'interactive',
      identity: {
        thread_id: 'thread-1',
        session_id: 'session-1',
        parent_thread_id: null,
        originator: null,
        thread_source: null,
        source: { kind: 'cli', value: null },
        history_mode: null,
        subagent_history_start_ordinal: null,
      },
      capabilities: {
        can_show_transcript: true,
        can_resume: true,
        can_export_worklog: true,
        can_open_parent_session: false,
      },
    },
    parsed_chat_log: {
      entries: [],
      transcript_blocks: [
        { entry_type: 'you', label: '[YOU]', title: '[YOU]', timestamp: null, content: 'request' },
        { entry_type: 'codex', label: '[CODEX]', title: '[CODEX]', timestamp: null, content: 'answer' },
        {
          entry_type: 'tool_result',
          label: '[TOOL RESULT]',
          title: '[TOOL RESULT]',
          timestamp: null,
          content: 'tool output',
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
      observed_event_counts: [],
    },
  }
}
