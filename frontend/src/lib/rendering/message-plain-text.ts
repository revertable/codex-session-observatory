import type { TranscriptBlockDto } from '../parse-contract'
import { messageSemantics } from './message-semantics.ts'
import type { MessageNode, MessageSemantics } from './message-semantics.ts'

export function captureMessageContent(block: TranscriptBlockDto): string {
  const semantic = messageSemantics(block)
  return semantic === null ? block.content : messagePlainText(semantic)
}

export function messagePlainText(semantic: MessageSemantics): string {
  return blockText(semantic.nodes)
}

function blockEnd(node: MessageNode): number | undefined {
  if (node.type === 'unordered_list' || node.type === 'ordered_list' || node.type === 'list_item') {
    const last = node.children?.at(-1)
    return last === undefined ? node.lines?.[1] : blockEnd(last)
  }
  return node.lines?.[1]
}

function blockText(nodes: MessageNode[]): string {
  let text = ''
  nodes.forEach((node, index) => {
    if (index > 0) {
      const end = blockEnd(nodes[index - 1])
      const start = node.lines?.[0]
      const newlines = end === undefined || start === undefined ? 1 : Math.max(1, start - end + 1)
      text += '\n'.repeat(newlines)
    }
    text += nodeText(node)
  })
  return text
}

function inlineText(nodes: MessageNode[]): string {
  return nodes.map(nodeText).join('')
}

function nodeText(node: MessageNode): string {
  switch (node.type) {
    case 'text': case 'code_inline': case 'code_block': return node.text ?? ''
    case 'soft_break': case 'hard_break': return '\n'
    case 'paragraph': case 'strong': case 'emphasis': return inlineText(node.children ?? [])
    case 'link': {
      const label = inlineText(node.children ?? [])
      return node.href === null || node.href === undefined || label === node.href ? label : label + ' (' + node.href + ')'
    }
    case 'table': return (node.children ?? []).map(nodeText).join('\n')
    case 'table_head': case 'table_body': return (node.children ?? []).map(nodeText).join('\n')
    case 'table_row': return (node.children ?? []).map(nodeText).join('\t')
    case 'table_header_cell': case 'table_cell': return inlineText(node.children ?? [])
    case 'list_item': return blockText(node.children ?? [])
    case 'unordered_list': case 'ordered_list':
      return (node.children ?? []).map((item, index) => {
        const prefix = node.type === 'ordered_list' ? String((node.start ?? 1) + index) + '. ' : '- '
        const lines = nodeText(item).split('\n')
        return prefix + lines[0] + lines.slice(1).map(line => '\n' + ' '.repeat(prefix.length) + line).join('')
      }).join('\n')
  }
}
