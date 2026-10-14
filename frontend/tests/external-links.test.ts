import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { validatedExternalUrl, openExternalLink } from '../src/lib/rendering/external-links.ts'
import { parseMessageMarkdown } from '../src/lib/rendering/message-semantics.ts'
import type { MessageNode } from '../src/lib/rendering/message-semantics.ts'

const walk = (nodes: MessageNode[]): MessageNode[] => nodes.flatMap(node => [node, ...walk(node.children ?? [])])

test('only absolute http/https URLs reach the existing opener', async () => {
  const opened: string[] = []
  const opener = async (url: string) => { opened.push(url) }
  for (const source of ['https://example.com/docs', 'HTTP://example.com/path']) await openExternalLink(source, opener)
  assert.deepEqual(opened, ['https://example.com/docs', 'http://example.com/path'])
  for (const source of ['javascript:alert(1)', 'data:text/html,x', 'file:///C:/private', 'mailto:a@example.com', '/relative', '//example.com', 'https://user:password@example.com', 'https://example.com\\@evil.test', 'https://example.com\n', 'https%3A%2F%2Fexample.com']) {
    assert.equal(validatedExternalUrl(source), null, source)
    await assert.rejects(openExternalLink(source, opener))
  }
  assert.equal(opened.length, 2)
  await assert.rejects(openExternalLink('https://example.com', async () => { throw new Error('denied') }), /denied/)
})

test('Markdown and entity encodings cannot activate a forbidden protocol', () => {
  for (const destination of [
    'javascript:alert%281%29', 'JaVaScRiPt:alert%281%29', 'javascript&#58;alert%281%29',
    '&#106;avascript:alert%281%29', 'java&#x09;script:alert%281%29',
    'java%73cript:alert%281%29', 'javascript%3Aalert%281%29',
    'data&#58;text/html,x', 'file&#58;///private', 'vbscript:evil',
    'java\\script:alert%281%29',
  ]) {
    const nodes = walk(parseMessageMarkdown('[link](' + destination + ')').nodes)
    assert.ok(nodes.every(node => node.type !== 'link' || node.href == null), destination)
  }
  const good = walk(parseMessageMarkdown('[link](https&#58;//example.com/a?x=1&amp;y=2)').nodes).find(node => node.type === 'link')
  assert.equal(good?.href, 'https://example.com/a?x=1&y=2')
})

test('desktop scope supports web URLs without file or default opener permissions', async () => {
  const capabilities = JSON.parse(await readFile(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'))
  const opener = capabilities.permissions.find((permission: { identifier?: string }) => permission.identifier === 'opener:allow-open-url')
  assert.ok(opener.allow.some((scope: { url: string }) => scope.url === 'https://*'))
  assert.ok(opener.allow.some((scope: { url: string }) => scope.url === 'http://*'))
  assert.ok(!capabilities.permissions.includes('opener:default'))
  assert.ok(!capabilities.permissions.includes('opener:allow-open-path'))
})
