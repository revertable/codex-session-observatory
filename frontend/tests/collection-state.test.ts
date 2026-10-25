import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { formatEntryTimestamp } from '../src/lib/rendering/entry-timestamp.ts'
import {
  clearCollection,
  collectionForSelectedPath,
  createCollectionState,
  identifyMessages,
  createMessageIdentifier,
  serializeCollection,
  toggleCollectedMessage,
} from '../src/lib/collection/collection-state.ts'
import {
  applyParseResponse, beginLoad, createInitialLoadWorkflowState, failLoad,
  selectPath, updateFilter,
} from '../src/lib/load-workflow.ts'
import type { ParseResponseDto, TranscriptBlockDto } from '../src/lib/parse-contract.ts'

const message = (content = 'Original message'): TranscriptBlockDto => ({
  entry_type: 'you', label: '[YOU]', title: '[YOU]',
  timestamp: '2026-10-23T12:00:00Z', content,
})

test('current message identifier reuses only an unchanged source array and path', () => {
  const identifyCurrent = createMessageIdentifier()
  const all = [message('A'), message('Duplicate'), message('Duplicate')]
  const first = identifyCurrent('one.jsonl', all)
  assert.equal(identifyCurrent('one.jsonl', all), first)
  assert.notEqual(first.get(all[1]), first.get(all[2]))
  const state = { ...createInitialLoadWorkflowState(), all_observations: { transcript_blocks: all, referenced_conversations: [] } }
  const filtered = updateFilter(state, 'show_you', false)
  assert.equal(identifyCurrent('one.jsonl', filtered.all_observations.transcript_blocks), first)
  const refreshed = structuredClone(all)
  const next = identifyCurrent('one.jsonl', refreshed)
  assert.notEqual(next, first)
  assert.deepEqual([...next.values()], [...first.values()])
  assert.equal(next.get(all[0]), undefined, 'new map does not keep old DTO keys')
  const other = identifyCurrent('other.jsonl', refreshed)
  assert.notDeepEqual([...other.values()], [...next.values()])
  assert.notEqual(identifyCurrent('one.jsonl', all), first, 'past sources are not cached')
  const empty: TranscriptBlockDto[] = []
  assert.equal(identifyCurrent('', empty).size, 0)
  assert.equal(identifyCurrent('', empty), identifyCurrent('', empty))
})

test('refreshed duplicate occurrences keep existing keys and append a distinct key', () => {
  const identifyCurrent = createMessageIdentifier()
  const original = [message('Duplicate'), message('Duplicate')]
  const keys = [...identifyCurrent('session.jsonl', original).values()]
  const refreshed = [...structuredClone(original), message('Duplicate')]
  const next = [...identifyCurrent('session.jsonl', refreshed).values()]
  assert.deepEqual(next.slice(0, 2), keys)
  assert.equal(new Set(next).size, 3)
})

test('collection restores source order when a middle message is removed and reselected', () => {
  const first = message('First')
  const second = message('Second')
  const third = message('Third')
  let state = createCollectionState()
  assert.equal(state.isOpen, false)
  state = toggleCollectedMessage(state, 'first', first, 0)
  assert.equal(state.isOpen, true)
  state = { ...state, isOpen: false }
  state = toggleCollectedMessage(state, 'second', second, 1)
  assert.equal(state.isOpen, false, 'later additions preserve a manually closed panel')
  assert.deepEqual(state.items.map(item => item.id), ['first', 'second'])
  state = toggleCollectedMessage(state, 'third', third, 2)
  state = toggleCollectedMessage(state, 'second', second, 1)
  assert.deepEqual(state.items.map(item => item.id), ['first', 'third'])
  state = toggleCollectedMessage(state, 'second', second, 1)
  assert.deepEqual(state.items.map(item => item.id), ['first', 'second', 'third'])
  assert.equal(new Set(state.items.map(item => item.id)).size, state.items.length)
  const cleared = clearCollection(state)
  assert.deepEqual(cleared.items, [])
  assert.equal(cleared.isOpen, state.isOpen)
})

test('C, A, B selection follows unfiltered source order in both panel data and copy', () => {
  // Deliberately reverse chronological order and omit one timestamp.
  const blocks = [
    { ...message('A'), timestamp: '2026-10-23T14:00:00Z' },
    { ...message('Hidden tool'), entry_type: 'tool_call' as const },
    { ...message('B'), timestamp: null },
    { ...message('C'), timestamp: '2026-10-23T10:00:00Z' },
  ]
  const ids = identifyMessages('one.jsonl', blocks)
  let state = createCollectionState()
  for (const sourceIndex of [3, 0, 2]) {
    const block = blocks[sourceIndex]
    state = toggleCollectedMessage(state, ids.get(block)!, block, sourceIndex)
  }
  assert.deepEqual(state.items.map(item => item.block.content), ['A', 'B', 'C'])
  assert.deepEqual(state.items.map(item => item.sourceIndex), [0, 2, 3])
  assert.equal(serializeCollection(state.items),
    `[YOU] · ${formatEntryTimestamp(blocks[0].timestamp)!.label}\nA\n\n---\n\n[YOU]\nB\n\n---\n\n[YOU] · ${formatEntryTimestamp(blocks[3].timestamp)!.label}\nC`)
  // Selecting an item exposed by a role filter still uses its original index.
  state = toggleCollectedMessage(state, ids.get(blocks[1])!, blocks[1], 1)
  assert.deepEqual(state.items.map(item => item.block.content), ['A', 'Hidden tool', 'B', 'C'])
})

test('message keys isolate source files, repeated messages, roles and raw timestamps', () => {
  const blocks = [message(), message(), { ...message(), entry_type: 'codex' as const },
    { ...message(), timestamp: null }]
  const keys = identifyMessages('one.jsonl', blocks)
  assert.equal(new Set(keys.values()).size, blocks.length)
  const reloaded = structuredClone(blocks)
  const reloadedKeys = identifyMessages('one.jsonl', reloaded)
  assert.deepEqual([...keys.values()], [...reloadedKeys.values()])
  const otherFileKeys = identifyMessages('two.jsonl', reloaded)
  assert.equal([...otherFileKeys.values()].some(key => [...keys.values()].includes(key)), false)
  const appended = [...reloaded, message('Appended')]
  assert.deepEqual([...identifyMessages('one.jsonl', appended).values()].slice(0, 4), [...keys.values()])
})

test('Refresh pending, failure and append retain collection and selection through filters', () => {
  const first = message()
  const tool = { ...message('command'), entry_type: 'tool_call' as const }
  const response: ParseResponseDto = {
    source: { absolute_path: 'one.jsonl', file_name: 'one.jsonl', session_id: null, resume_command: null },
    session: { classification: 'interactive', identity: null, capabilities: {
      can_show_transcript: true, can_resume: false, can_export_worklog: false, can_open_parent_session: false,
    } },
    parsed_chat_log: { entries: [], transcript_blocks: [first, tool], referenced_conversations: [],
      observed_event_counts: [], counters: {
        parsed_candidates: 2, total_entries: 2, visible_entries: 2, ignored_lines: 0, malformed_lines: 0,
      } },
  }
  let workflow = applyParseResponse(selectPath(createInitialLoadWorkflowState(), 'one.jsonl'), response)
  const keys = identifyMessages('one.jsonl', workflow.all_observations.transcript_blocks)
  let collection = toggleCollectedMessage(createCollectionState(), keys.get(tool)!, tool, 1)
  collection = toggleCollectedMessage(collection, keys.get(first)!, first, 0)
  collection = { ...collection, isOpen: false }
  const snapshot = collection
  workflow = beginLoad(workflow)
  workflow = failLoad(workflow, { code: 'failed', message: 'test' })
  const refreshed = structuredClone(response)
  refreshed.parsed_chat_log.transcript_blocks.push(message('Appended'))
  workflow = applyParseResponse(beginLoad(workflow), refreshed)
  workflow = updateFilter(workflow, 'show_tool_call', true)
  const refreshedKeys = identifyMessages('one.jsonl', workflow.all_observations.transcript_blocks)
  const selected = new Set(collection.items.map(item => item.id))
  assert.deepEqual(workflow.observations.transcript_blocks.map(block => selected.has(refreshedKeys.get(block)!)),
    [true, true, false])
  assert.strictEqual(collectionForSelectedPath(collection, 'one.jsonl', 'one.jsonl'), snapshot)
  assert.equal(collection.isOpen, false)
  assert.deepEqual(collection.items.map(item => item.block.content), ['Original message', 'command'])
  assert.deepEqual(collection.items.map(item => item.sourceIndex), [0, 1])
  const appended = workflow.all_observations.transcript_blocks[2]
  collection = toggleCollectedMessage(collection, refreshedKeys.get(appended)!, appended, 2)
  assert.deepEqual(collection.items.map(item => item.block.content), ['Original message', 'command', 'Appended'])
  assert.equal(collection.isOpen, false)
  collection = collectionForSelectedPath(collection, 'one.jsonl', 'two.jsonl')
  assert.deepEqual(collection, createCollectionState())
  collection = collectionForSelectedPath(collection, 'two.jsonl', 'one.jsonl')
  assert.deepEqual(collection, createCollectionState(), 'returning never restores the old collection')
})

test('collection snapshots and serialization preserve source text without editing or trimming', () => {
  const content = '  **original**\r\n\r\n```ts\r\nconst x = "<script>";\r\n```\r\n\tend  '
  const block = message(content)
  const state = toggleCollectedMessage(createCollectionState(), 'one', block, 0)
  block.content = 'Replaced by a later parse'
  assert.equal(state.items[0].block.content, content)
  const timestamp = formatEntryTimestamp(block.timestamp)!.label
  assert.equal(serializeCollection(state.items), `[YOU] · ${timestamp}\n${content}`)
  const second = toggleCollectedMessage(state, 'two', { ...message('tool raw'), entry_type: 'tool_result', timestamp: null }, 1)
  assert.equal(serializeCollection(second.items), `[YOU] · ${timestamp}\n${content}\n\n---\n\n[RESULT]\ntool raw`)
  assert.equal(serializeCollection([]), '')
  assert.equal(second.items.length, 2, 'copy serialization does not clear the collection')
})

test('collection copies local time across timezones without changing the captured timestamp or text', () => {
  const moduleUrl = new URL('../src/lib/collection/collection-state.ts', import.meta.url).href
  const script = `
    import assert from 'node:assert/strict';
    import { createCollectionState, toggleCollectedMessage, serializeCollection } from ${JSON.stringify(moduleUrl)};
    const block = { entry_type: 'you', label: '[YOU]', title: '[YOU]',
      timestamp: '2026-10-22T23:33:48.799Z', content: '  original\\r\\n\\tcode  ' };
    const state = toggleCollectedMessage(createCollectionState(), 'one', block, 0);
    const before = JSON.stringify(state);
    process.stdout.write(serializeCollection(state.items));
    assert.equal(JSON.stringify(state), before);
    assert.equal(state.items[0].block.timestamp, block.timestamp);
  `
  for (const [timezone, label] of [
    ['UTC', '2026-10-22 23:33:48'],
    ['Asia/Seoul', '2026-10-23 08:33:48'],
  ]) {
    const copied = execFileSync(process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', script],
      { encoding: 'utf8', env: { ...process.env, TZ: timezone } })
    assert.equal(copied, `[YOU] · ${label}\n  original\r\n\tcode  `)
  }
})

test('collection headers reuse Transcript roles while keeping raw labels and content unchanged', () => {
  for (const [kind, label] of [
    ['you', 'YOU'], ['codex', 'CODEX'], ['tool_call', 'TOOL'],
    ['tool_result', 'RESULT'], ['task', 'META'], ['system', 'SYSTEM'],
    ['context', 'CONTEXT'],
  ] as const) {
    const block = { ...message('  **raw**\n```ts\n\tcode\n```  '), entry_type: kind,
      label: 'Unchanged source label', timestamp: null }
    const state = toggleCollectedMessage(createCollectionState(), 'one', block, 0)
    assert.equal(serializeCollection(state.items), `[${label}]\n${block.content}`)
    assert.equal(state.items[0].block.label, 'Unchanged source label')
  }
})

test('missing and invalid timestamps match Transcript omission; same-second messages retain distinct keys', () => {
  for (const timestamp of [null, '', 'invalid', '2026-10-22T10:33:48']) {
    const block = { ...message('Unchanged'), timestamp }
    const state = toggleCollectedMessage(createCollectionState(), 'one', block, 0)
    assert.equal(serializeCollection(state.items), '[YOU]\nUnchanged')
    assert.equal(state.items[0].block.timestamp, timestamp)
  }
  const blocks = [
    { ...message(), timestamp: '2026-10-22T01:33:48.100Z' },
    { ...message(), timestamp: '2026-10-22T01:33:48.900Z' },
  ]
  assert.equal(formatEntryTimestamp(blocks[0].timestamp)!.label, formatEntryTimestamp(blocks[1].timestamp)!.label)
  const ids = [...identifyMessages('one.jsonl', blocks).values()]
  assert.notEqual(ids[0], ids[1])
})
