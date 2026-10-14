import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compile } from 'svelte/compiler'
import { render } from 'svelte/server'
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

const require = createRequire(import.meta.url)
const compiled = new Map<string, Promise<string>>()
function componentModule(url: URL): Promise<string> {
  const key = url.href
  const previous = compiled.get(key)
  if (previous) return previous
  const result = (async () => {
    let code = compile(await readFile(url, 'utf8'), { filename: fileURLToPath(url), generate: 'server' }).js.code
    const matches = [...code.matchAll(/from (['"])([^'"]+)\1/g)]
    for (const match of matches) {
      const specifier = match[2]
      let target: string
      if (specifier.endsWith('.svelte')) target = await componentModule(new URL(specifier, url))
      else if (specifier.startsWith('.')) target = new URL(/\.[a-z]+$/i.test(specifier) ? specifier : specifier + '.ts', url).href
      else target = pathToFileURL(require.resolve(specifier)).href
      code = code.replace(match[0], 'from ' + JSON.stringify(target))
    }
    return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  })()
  compiled.set(key, result)
  return result
}

test('all four themes render common semantic elements and inert HTML; technical content is plain', async () => {
  const source = '**important** *italic*\n\n`CONFIG=9000` &#x20;\nApply\n\n- A\n- B\n\n3. third\n4. fourth\n\n```\n  literal &amp;  \n```\n\n[docs](https://example.com/docs)\n<script>alert(1)</script>\n<img src="https://example.com/image" onerror="alert(1)">'
  for (const [file, theme] of [
    ['TerminalTranscript.svelte', 'Terminal Style'], ['MarkdownTranscript.svelte', 'Markdown Style'],
    ['ChatTranscript.svelte', 'DM Style'], ['ChatTranscript.svelte', 'DM Style (Dark)'],
  ]) {
    const component = await import(await componentModule(new URL('../src/lib/rendering/' + file, import.meta.url)))
    const html = render(component.default, { props: {
      theme, isLoaded: true, publicReleaseStatus: null, showIdentityNote: false,
      observedEventCounts: [], blocks: [block(source), block('**technical**', 'tool_result')],
      references: [], collapsedBlocks: {}, onToggleBlock: () => {},
    } }).body
    assert.match(html, /<strong>[^]*important[^]*<\/strong>/)
    assert.match(html, /<em>[^]*italic[^]*<\/em>/)
    assert.match(html, /class="message-inline-code"[^>]*>CONFIG=9000<\/code>/)
    assert.match(html, /<ul>/)
    assert.match(html, /<ol start="3">/)
    assert.match(html, /<br\s*\/?\s*>/)
    assert.match(html, /href="https:\/\/example.com\/docs"/)
    assert.match(html, /&lt;script(?:>|&gt;)/)
    assert.doesNotMatch(html, /<script|<img|<iframe|<[^>]*\sonerror=/)
    assert.doesNotMatch(html, /&amp;#x20;/)
    assert.match(html, /class="technical-message-content"[^>]*>\*\*technical\*\*<\/pre>/)
    assert.ok(html.includes('  literal &amp;amp;  \n'))
  }
})
