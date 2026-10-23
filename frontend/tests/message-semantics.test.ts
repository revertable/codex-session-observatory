import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMessageMarkdown, messageSemantics } from '../src/lib/rendering/message-semantics.ts'
import type { MessageNode } from '../src/lib/rendering/message-semantics.ts'
import { messagePlainText } from '../src/lib/rendering/message-plain-text.ts'
import type { TranscriptBlockDto } from '../src/lib/parse-contract.ts'

const block = (content: string, entry_type: TranscriptBlockDto['entry_type'] = 'you'): TranscriptBlockDto =>
  ({ entry_type, label: '[YOU]', title: '[YOU]', timestamp: null, content })
const walk = (nodes: MessageNode[]): MessageNode[] => nodes.flatMap(node => [node, ...walk(node.children ?? [])])

test('message semantics preserve newlines, entities, code, and multiple paragraphs', () => {
  const cases = [
    ['first\nsecond', 'first\nsecond'],
    ['first  \nsecond', 'first\nsecond'],
    ['`CONFIG=9000` &#x20;\nApply', 'CONFIG=9000  \nApply'],
    ['<tag> > & &amp; &#x20; &madeup;', '<tag> > & &   &madeup;'],
    ['`&amp; &#x20; <tag>`', '&amp; &#x20; <tag>'],
    ['\\&amp;', '&amp;'],
    ['one\n\ntwo\n\n\nthree', 'one\n\ntwo\n\n\nthree'],
    ['**important** and *emphasis*', 'important and emphasis'],
    ['- A\n- B', '- A\n- B'],
    ['3. third\n4. fourth', '3. third\n4. fourth'],
    ['- A\n  - child\n- B', '- A\n  - child\n- B'],
    ['```js\n  code &amp;  \n```', '  code &amp;  \n'],
    ['[docs](https://example.com/docs)', 'docs (https://example.com/docs)'],
  ]
  for (const [source, expected] of cases) assert.equal(messagePlainText(parseMessageMarkdown(source)), expected, source)
  assert.ok(walk(parseMessageMarkdown('a\nb').nodes).some(node => node.type === 'soft_break'))
  assert.ok(walk(parseMessageMarkdown('a  \nb').nodes).some(node => node.type === 'hard_break'))
})

test('cache never mutates DTO and invalidates on content changes; technical blocks stay plain', () => {
  const dto = block('**bold**')
  const before = JSON.stringify(dto)
  const first = messageSemantics(dto)
  assert.equal(first, messageSemantics(dto))
  assert.equal(JSON.stringify(dto), before)
  dto.content = '*italic*'
  assert.notEqual(first, messageSemantics(dto))
  for (const kind of ['tool_call', 'tool_result', 'system', 'context', 'task'] as const)
    assert.equal(messageSemantics(block('**raw**', kind)), null)
})

test('tables preserve headers, rows, alignment, inline semantics and surrounding blocks', () => {
  const source = 'Before\n\n| Left | Center | Right |\n| :--- | :---: | ---: |\n| **강조** | *italic* `code` | [docs](https://example.com/docs) |\n| a\\|b | `c\\|d` | &amp; <tag> |\n\nAfter'
  const semantic = parseMessageMarkdown(source)
  assert.deepEqual(semantic.nodes.map(node => node.type), ['paragraph', 'table', 'paragraph'])
  const table = semantic.nodes[1]
  assert.deepEqual(table.children?.map(node => node.type), ['table_head', 'table_body'])
  const headCells = table.children?.[0].children?.[0].children ?? []
  assert.deepEqual(headCells.map(node => node.type), ['table_header_cell', 'table_header_cell', 'table_header_cell'])
  assert.deepEqual(headCells.map(node => node.alignment), ['left', 'center', 'right'])
  const rows = table.children?.[1].children ?? []
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0].children?.map(node => node.alignment), ['left', 'center', 'right'])
  assert.deepEqual(rows[0].children?.map(node => node.children?.filter(child => child.type !== 'text').map(child => child.type)), [['strong'], ['emphasis', 'code_inline'], ['link']])
  assert.equal(messagePlainText(semantic), 'Before\n\nLeft\tCenter\tRight\n강조\titalic code\tdocs (https://example.com/docs)\na|b\tc|d\t& <tag>\n\nAfter')
})

test('table boundaries follow markdown-it grammar without changing raw DTO or code blocks', () => {
  const headerOnly = '| A | B |\n|---|---|'
  assert.equal(messagePlainText(parseMessageMarkdown(headerOnly)), 'A\tB')
  assert.equal(messagePlainText(parseMessageMarkdown('| |\n|---|\n| one |')), '\none')
  const uneven = headerOnly + '\n| one |\n| one | two | extra |'
  assert.equal(messagePlainText(parseMessageMarkdown(uneven)), 'A\tB\none\t\none\ttwo')
  const dto = block(uneven)
  messageSemantics(dto)
  assert.equal(dto.content, uneven)
  const malformed = '| A | B |\n|---| nope |\n| one | two |'
  assert.equal(messagePlainText(parseMessageMarkdown(malformed)), malformed)
  const fenced = '```\n' + headerOnly + '\n```'
  assert.deepEqual(parseMessageMarkdown(fenced).nodes.map(node => node.type), ['code_block'])
  assert.equal(messagePlainText(parseMessageMarkdown(fenced)), headerOnly + '\n')
  const nested = parseMessageMarkdown('- First\n\n  | A | B |\n  |---|---|\n  | one | two |\n\n- Last')
  assert.equal(nested.nodes[0].type, 'unordered_list')
  assert.equal(nested.nodes[0].children?.length, 2)
  assert.ok(walk(nested.nodes).some(node => node.type === 'table'))
  assert.ok(messagePlainText(nested).endsWith('- Last'))
})

test('table cells retain existing entity and link security boundaries', () => {
  for (const target of ['javascript:alert%281%29', '&#106;avascript:alert%281%29', 'java&#x09;script:evil', 'data:text/html,x', 'file:///private']) {
    const semantic = parseMessageMarkdown('| Cell |\n|---|\n| [bad](' + target + ') |')
    assert.ok(walk(semantic.nodes).every(node => node.type !== 'link' || node.href == null))
  }
  const cells = walk(parseMessageMarkdown('| Cell |\n|---|\n| &lt;script&gt;alert(1)&lt;/script&gt; |').nodes)
  assert.ok(cells.some(node => node.type === 'text' && node.text?.includes('<script>')))
})
