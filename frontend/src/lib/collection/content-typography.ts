import type { TranscriptBlockDto } from '../parse-contract'
import { isMarkdownMessage, messageSemantics, type MessageNode } from '../rendering/message-semantics.ts'

export interface CollectionTextPart { text: string; code: boolean }
const cache = new WeakMap<TranscriptBlockDto, { content: string; kind: string; parts: CollectionTextPart[] }>()

/** Presentation ranges only: retain every original character, including fences and CRLF. */
export function collectionTextParts(block: TranscriptBlockDto): CollectionTextPart[] {
  const previous = cache.get(block)
  if (previous?.content === block.content && previous.kind === block.entry_type) return previous.parts
  const text = block.content
  const ranges: [number, number][] = []
  if (block.entry_type === 'tool_call' || block.entry_type === 'tool_result') ranges.push([0, text.length])
  else if (isMarkdownMessage(block)) {
    const offsets = [0]
    for (const match of text.matchAll(/\r\n|\r|\n/g)) offsets.push(match.index! + match[0].length)
    offsets.push(text.length)
    const visit = (nodes: MessageNode[]) => {
      for (const node of nodes) {
        if ((node.type === 'code_block' || node.type === 'table') && node.lines) {
          ranges.push([offsets[node.lines[0]] ?? text.length, offsets[node.lines[1]] ?? text.length])
        } else if (node.children) visit(node.children)
      }
    }
    visit(messageSemantics(block)?.nodes ?? [])
    // Code spans retain their raw delimiters; an unmatched run remains ordinary text.
    const runs = [...text.matchAll(/`+/g)]
    for (let i = 0; i < runs.length; i++) {
      const open = runs[i]; const start = open.index!
      if (ranges.some(([a, b]) => start >= a && start < b)) continue
      let slashes = 0
      for (let p = start - 1; p >= 0 && text[p] === '\\'; p--) slashes++
      if (slashes % 2) continue
      const end = runs.findIndex((run, j) => j > i && run[0].length === open[0].length
        && !/\n[ \t]*\n/.test(text.slice(start, run.index).replace(/\r\n?/g, '\n'))
        && !ranges.some(([a, b]) => (run.index! >= a && run.index! < b) || (a > start && a < run.index!)))
      if (end >= 0) { ranges.push([start, runs[end].index! + runs[end][0].length]); i = end }
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const parts: CollectionTextPart[] = []
  let position = 0
  for (const [start, end] of ranges) {
    if (end <= position) continue
    if (start > position) parts.push({ text: text.slice(position, start), code: false })
    parts.push({ text: text.slice(Math.max(position, start), end), code: true })
    position = end
  }
  if (position < text.length || parts.length === 0) parts.push({ text: text.slice(position), code: false })
  cache.set(block, { content: text, kind: block.entry_type, parts })
  return parts
}
