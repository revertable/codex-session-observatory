import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'
import type { TranscriptBlockDto } from '../parse-contract'
import { validatedExternalUrl } from './external-links.ts'

export type MessageNodeType =
  | 'text' | 'strong' | 'emphasis' | 'code_inline' | 'code_block'
  | 'paragraph' | 'soft_break' | 'hard_break' | 'unordered_list'
  | 'ordered_list' | 'list_item' | 'link'
  | 'table' | 'table_head' | 'table_body' | 'table_row'
  | 'table_header_cell' | 'table_cell'

export interface MessageNode {
  type: MessageNodeType
  text?: string
  children?: MessageNode[]
  href?: string | null
  start?: number
  tight?: boolean
  lines?: [number, number]
  alignment?: 'left' | 'center' | 'right'
}

export interface MessageSemantics {
  nodes: MessageNode[]
}

const parser = new MarkdownIt({ html: false, linkify: false, typographer: false })
parser.disable(['image', 'heading', 'lheading', 'blockquote', 'hr', 'strikethrough'])
const cache = new WeakMap<TranscriptBlockDto, { content: string; kind: string; value: MessageSemantics }>()

export function isMarkdownMessage(block: TranscriptBlockDto): boolean {
  return block.entry_type === 'you' || block.entry_type === 'codex'
}

export function messageSemantics(block: TranscriptBlockDto): MessageSemantics | null {
  if (!isMarkdownMessage(block)) return null
  const previous = cache.get(block)
  if (previous?.content === block.content && previous.kind === block.entry_type) return previous.value
  const value = parseMessageMarkdown(block.content)
  cache.set(block, { content: block.content, kind: block.entry_type, value })
  return value
}

export function parseMessageMarkdown(content: string): MessageSemantics {
  return { nodes: convertTokens(parser.parse(content, {})) }
}

function convertTokens(tokens: Token[]): MessageNode[] {
  const roots: MessageNode[] = []
  const stack: MessageNode[][] = [roots]
  for (const token of tokens) {
    if (token.nesting === -1) {
      if (stack.length > 1) stack.pop()
      continue
    }
    if (token.type === 'inline') {
      stack[stack.length - 1].push(...convertTokens(token.children ?? []))
      continue
    }
    const types: Record<string, MessageNodeType> = {
      paragraph_open: 'paragraph', strong_open: 'strong', em_open: 'emphasis',
      bullet_list_open: 'unordered_list', ordered_list_open: 'ordered_list',
      list_item_open: 'list_item', link_open: 'link', text: 'text', text_special: 'text',
      code_inline: 'code_inline', code_block: 'code_block', fence: 'code_block',
      softbreak: 'soft_break', hardbreak: 'hard_break',
      table_open: 'table', thead_open: 'table_head', tbody_open: 'table_body',
      tr_open: 'table_row', th_open: 'table_header_cell', td_open: 'table_cell',
    }
    const type = types[token.type]
    if (type === undefined) {
      if (token.content) stack[stack.length - 1].push({ type: 'text', text: token.content })
      continue
    }
    const node: MessageNode = { type }
    if (token.map !== null) node.lines = [token.map[0], token.map[1]]
    if (token.nesting === 1) node.children = []
    else if (type === 'text' || type === 'code_inline' || type === 'code_block') node.text = token.content
    if (type === 'paragraph') node.tight = token.hidden
    if (type === 'ordered_list') node.start = Number(token.attrGet('start') ?? 1)
    if (type === 'table_header_cell' || type === 'table_cell') {
      // Interpret only the parser's known alignment values, never arbitrary CSS.
      const alignment = { 'text-align:left': 'left', 'text-align:center': 'center', 'text-align:right': 'right' } as const
      const style = String(token.attrGet('style') ?? '')
      if (Object.hasOwn(alignment, style)) node.alignment = alignment[style as keyof typeof alignment]
    }
    if (type === 'link') node.href = validatedExternalUrl(String(token.attrGet('href') ?? ''))
    stack[stack.length - 1].push(node)
    if (node.children !== undefined) stack.push(node.children)
  }
  return roots
}
