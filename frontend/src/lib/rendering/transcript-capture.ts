import type {
  EntryKind,
  ObservedEventCountDto,
  ReferencedConversationDto,
  TranscriptBlockDto,
} from '../parse-contract'
import type { TranscriptThemeName } from './transcript-themes'
import { captureMessageContent } from './message-plain-text.ts'
import { formatEntryTimestamp } from './entry-timestamp.ts'

export interface TranscriptCaptureInput {
  theme: TranscriptThemeName
  blocks: TranscriptBlockDto[]
  references: ReferencedConversationDto[]
  observedEventCounts: ObservedEventCountDto[]
  collapsedBlocks: Readonly<Record<number, boolean>>
}

const TERMINAL_SEPARATOR = '========================================================================'

export function serializeTranscript(input: TranscriptCaptureInput): string {
  switch (input.theme) {
    case 'Terminal Style':
      return serializeTerminalTranscript(input)
    case 'Markdown Style':
      return serializeMarkdownTranscript(input)
    case 'DM Style':
    case 'DM Style (Dark)':
      return serializeChatTranscript(input)
  }
}

function serializeTerminalTranscript(input: TranscriptCaptureInput): string {
  // The terminal renderer uses `white-space: pre-wrap`, so its structural
  // whitespace is observable through innerText. Preserve that shape here.
  const lines = ['Codex Session Observatory', ' ', ' ', TERMINAL_SEPARATOR, ' ']

  if (input.references.length > 0) {
    lines.push(' ', '')
    appendReferences(lines, input.references)
    lines.push(' ', ' ')
  } else {
    lines.push('  ')
  }

  if (input.blocks.length === 0) {
    lines.push('No renderable chat messages found in this JSONL file.')
    const eventCounts = displayedEventCounts(input.observedEventCounts)
    if (eventCounts.length > 0) {
      lines.push(' ', ' ', 'Observed event types:', ' ')
      lines.push(...eventCounts.map((eventCount) => `- ${eventCount.event}: ${eventCount.count}`))
    }
    lines.push(' ', ' ')
  } else {
    input.blocks.forEach((block, index) => {
      const isCollapsed = input.collapsedBlocks[index] ?? false
      const timestamp = capturedTimestamp(block)
      lines.push(
        `${isCollapsed ? '[>]' : '[v]'} ${terminalDisplayLabel(block)}${timestamp === null ? '' : ` · ${timestamp}`}`,
      )
      if (!isCollapsed) {
        lines.push(' ', captureMessageContent(block))
      } else {
        lines.push(' ')
      }
      if (index === input.blocks.length - 1) {
        lines.push('  ', ' ')
      } else {
        lines.push(' ')
      }
    })
  }

  lines.push(TERMINAL_SEPARATOR)
  return lines.join('\n')
}

function serializeMarkdownTranscript(input: TranscriptCaptureInput): string {
  const lines = ['MARKDOWN STYLE', '', 'Codex Session Observatory']
  if (input.references.length > 0) {
    lines.push('')
    appendReferences(lines, input.references)
  }

  if (input.blocks.length === 0) {
    lines.push('', 'No renderable chat messages found in this JSONL file.')
    const eventCounts = displayedEventCounts(input.observedEventCounts)
    if (eventCounts.length > 0) {
      lines.push('', 'Observed event types')
      lines.push(...eventCounts.map((eventCount) => `${eventCount.event}: ${eventCount.count}`))
    }
  } else {
    appendComponentBlocks(lines, input.blocks, input.collapsedBlocks)
  }

  return lines.join('\n')
}

function serializeChatTranscript(input: TranscriptCaptureInput): string {
  const lines = ['Codex Session Observatory', input.theme]
  if (input.references.length > 0) {
    lines.push('')
    appendReferences(lines, input.references)
  }

  if (input.blocks.length === 0) {
    lines.push('', 'No renderable chat messages found in this JSONL file.')
    const eventCounts = displayedEventCounts(input.observedEventCounts)
    if (eventCounts.length > 0) {
      lines.push('', 'Observed event types:', '')
      lines.push(...eventCounts.map((eventCount) => `${eventCount.event}: ${eventCount.count}`))
    }
  } else {
    appendComponentBlocks(lines, input.blocks, input.collapsedBlocks)
  }

  return lines.join('\n')
}

function appendComponentBlocks(
  lines: string[],
  blocks: TranscriptBlockDto[],
  collapsedBlocks: Readonly<Record<number, boolean>>,
) {
  blocks.forEach((block, index) => {
    const isCollapsed = collapsedBlocks[index] ?? false
    lines.push(isCollapsed ? '>' : 'v', `[${captureLabel(block.entry_type)}]`)
    const timestamp = capturedTimestamp(block)
    if (timestamp !== null) {
      lines.push(timestamp)
    }
    if (!isCollapsed) {
      lines.push(captureMessageContent(block))
    }
  })
}

function appendReferences(lines: string[], references: ReferencedConversationDto[]) {
  references.forEach((reference) => {
    lines.push(
      'REFERENCED CHATGPT CONVERSATION',
      '',
      'TITLE',
      reference.title ?? 'Not provided',
      'CONVERSATION ID',
      reference.conversation_id ?? 'Not provided',
    )
  })
}

function terminalDisplayLabel(block: TranscriptBlockDto): string {
  const sourceLabel = block.label.trim()
  return sourceLabel !== '' ? sourceLabel : `[${captureLabel(block.entry_type)}]`
}

function capturedTimestamp(block: TranscriptBlockDto): string | null {
  return formatEntryTimestamp(block.timestamp)?.label ?? null
}

function displayedEventCounts(eventCounts: ObservedEventCountDto[]): ObservedEventCountDto[] {
  return [...eventCounts].sort((left, right) => right.count - left.count).slice(0, 8)
}

function captureLabel(kind: EntryKind): string {
  // These labels reproduce the renderer text that defined the capture
  // contract. Keep them explicit instead of coupling capture to styling data.
  switch (kind) {
    case 'you':
      return 'YOU'
    case 'codex':
      return 'CODEX'
    case 'system':
      return 'SYSTEM'
    case 'context':
      return 'CONTEXT'
    case 'task':
      return 'META'
    case 'tool_call':
      return 'TOOL'
    case 'tool_result':
      return 'RESULT'
  }
}
