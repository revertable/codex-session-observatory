import { mount, unmount, flushSync, tick } from 'svelte'
import App from '../../src/App.svelte'
import type { ParseResponseDto } from '../../src/lib/parse-contract'
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const settle = async () => { flushSync(); await tick(); await new Promise(resolve => setTimeout(resolve, 0)); flushSync() }
const target = document.querySelector('#target') as HTMLElement
const blocks = () => Array.from(target.querySelectorAll('.terminal-block'))
let resolveLoad: (response: ParseResponseDto) => void
let rejectLoad: (error: Error) => void
let requests = 0
let selectedPath = 'session.jsonl'
let requestedPath = ''
;(window as any).__TAURI_INTERNALS__ = {
  invoke: async (command: string, args?: { path?: string }) => {
    if (command === 'resolve_jsonl_initial_directory') return '.'
    if (command === 'plugin:dialog|open') return selectedPath
    if (command === 'plugin:app|version') throw new Error('No update check in test')
    if (command === 'parse_selected_jsonl') {
      requests++
      requestedPath = args?.path ?? ''
      return new Promise<ParseResponseDto>((resolve, reject) => { resolveLoad = resolve; rejectLoad = reject })
    }
    throw new Error('Unexpected command: ' + command)
  },
}
const click = async (text: string) => {
  const button = Array.from(target.querySelectorAll('button')).find(button => button.textContent?.trim() === text)
  assert(button && !button.disabled, 'enabled action: ' + text)
  button!.click(); await settle()
}
const status = () => target.querySelector('[data-status]')?.getAttribute('data-status')
const response: ParseResponseDto = {
  source: { file_name: 'session.jsonl', absolute_path: 'session.jsonl', session_id: 'test', resume_command: null },
  session: { classification: 'interactive', identity: null, capabilities: { can_show_transcript: true, can_resume: false, can_export_worklog: false, can_open_parent_session: false } },
  parsed_chat_log: {
    entries: [], referenced_conversations: [], observed_event_counts: [],
    counters: { parsed_candidates: 2, total_entries: 2, visible_entries: 2, ignored_lines: 0, malformed_lines: 0 },
    transcript_blocks: [
      { entry_type: 'you', label: 'YOU', title: 'User', timestamp: null, content: '**First** message' },
      { entry_type: 'codex', label: 'CODEX', title: 'Assistant', timestamp: null, content: 'Second message' },
    ],
  },
}
;(globalThis as any).__refreshCase = async () => {
  const instance = mount(App, { target })
  try {
    await settle()
    assert(status() === 'idle' && blocks().length === 0, 'initial idle')
    await click('Select JSONL')
    assert(status() === 'loading' && requests === 1 && blocks().length === 0, 'initial pending: ' + status())
    rejectLoad(new Error('Test initial failure')); await settle()
    assert(status() === 'error' && blocks().length === 0, 'initial failure has no transcript')
    await click('Refresh')
    resolveLoad(structuredClone(response)); await settle()
    assert(status() === 'loaded' && blocks().length === 2, 'initial successful load')
    const original = blocks()
    const host = original[0].querySelector('.message-content')!
    const bodyNodes = Array.from(host.childNodes)
    const secondToggle = original[1].querySelector('button')!
    secondToggle.click(); await settle()
    assert(secondToggle.getAttribute('aria-expanded') === 'false', 'collapse seeded')
    const retained = (phase: string) => {
      assert(blocks()[0] === original[0] && blocks()[1] === original[1], phase + ': wrappers retained')
      assert(original[0].querySelector('.message-content') === host, phase + ': host retained')
      assert(bodyNodes.length === host.childNodes.length && bodyNodes.every((node, index) => host.childNodes[index] === node), phase + ': subtree retained')
      assert(secondToggle.getAttribute('aria-expanded') === 'false', phase + ': collapse retained')
    }
    await click('Refresh')
    assert(status() === 'loading', 'refresh pending status'); retained('pending')
    resolveLoad(structuredClone(response)); await settle()
    assert(status() === 'loaded', 'refresh completed'); retained('identical result')
    const appended = structuredClone(response)
    appended.parsed_chat_log.transcript_blocks.push({ entry_type: 'codex', label: 'CODEX', title: 'Assistant', timestamp: null, content: 'New message' })
    await click('Refresh'); retained('append pending')
    resolveLoad(appended); await settle()
    retained('append completed')
    assert(blocks().length === 3 && blocks()[2].textContent?.includes('New message'), 'only new message appended')
    const added = blocks()[2]
    await click('Refresh'); retained('failure pending')
    rejectLoad(new Error('Test refresh failure')); await settle()
    assert(status() === 'error' && target.textContent?.includes('Test refresh failure'), 'refresh error visible')
    retained('failure completed')
    assert(blocks()[2] === added, 'failure retains appended message')
    await click('Refresh'); resolveLoad(structuredClone(appended)); await settle()
    retained('retry completed'); assert(blocks()[2] === added && status() === 'loaded', 'retry retained')
    await click('Select JSONL')
    assert(blocks().length === 0 && status() === 'loading', 'new selection resets transcript')
    rejectLoad(new Error('Test selection failure')); await settle()
    assert(blocks().length === 0 && status() === 'error', 'selection failure has no old transcript')
  } finally { await unmount(instance) }
}
;(globalThis as any).__domReady = true

;(globalThis as any).__refreshButtonsCase = async () => {
  for (const path of ['session.jsonl', 'session.jsonl.zst']) {
    selectedPath = path
    const instance = mount(App, { target })
    const refreshButtons = () => Array.from(target.querySelectorAll('button'))
      .filter(button => button.textContent?.trim() === 'Refresh' || button.getAttribute('aria-label') === 'Refresh Transcript')
    const panel = () => target.querySelector<HTMLElement>('#collection-panel')!
    const collectionBodies = () => Array.from(panel().querySelectorAll('article pre')).map(node => node.textContent)
    const resolve = async (physicalPath = path) => {
      const result = structuredClone(response)
      result.source.absolute_path = physicalPath
      result.source.file_name = physicalPath
      resolveLoad(result); await settle()
    }
    try {
      await settle()
      assert(refreshButtons().length === 2 && refreshButtons().every(button => button.disabled), 'both Refresh buttons disabled initially')
      await click('Select JSONL')
      assert(refreshButtons().every(button => !button.disabled), 'both Refresh buttons react to selected path: ' + path)
      await resolve()
      const toggles = target.querySelectorAll<HTMLButtonElement>('.terminal-block .collection-toggle')
      for (const index of [1, 0]) { toggles[index].click(); await settle() }
      const expected = collectionBodies()
      assert(expected.join('|') === response.parsed_chat_log.transcript_blocks.map(block => block.content).join('|'), 'collection uses source order')
      assert(!panel().hidden, 'collection opens on first add')
      for (const index of [0, 1]) {
        for (const fail of [false, true]) {
          const count = requests
          refreshButtons()[index].click(); await settle()
          assert(requests === count + 1 && requestedPath === path && status() === 'loading', 'same loading command and selected path for both buttons')
          assert(JSON.stringify(collectionBodies()) === JSON.stringify(expected), 'collection retained while pending')
          if (fail) { rejectLoad(new Error('Refresh failure')); await settle() }
          else await resolve(path.endsWith('.zst') ? 'session.jsonl' : 'session.jsonl.zst')
          assert(JSON.stringify(collectionBodies()) === JSON.stringify(expected), 'collection contents and order retained after refresh')
          assert(panel().hidden === (index === 1), 'panel state retained after refresh')
          assert(Array.from(target.querySelectorAll('.terminal-block .collection-toggle')).every(button => button.getAttribute('aria-pressed') === 'true'), 'collected indicators retained after physical format change')
        }
        if (index === 0) {
          target.querySelector<HTMLButtonElement>('[aria-label="Hide Collection"]')!.click(); await settle()
        }
      }
      refreshButtons()[1].click(); await settle(); await resolve()
      assert(status() === 'loaded' && panel().hidden, 'Transcript header Refresh retries after failure with closed panel preserved')
    } finally { await unmount(instance) }
  }
  selectedPath = 'session.jsonl'
}
