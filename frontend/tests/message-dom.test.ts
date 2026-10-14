import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMessageDom, createMessageAttachment } from '../src/lib/rendering/message-dom.ts';
import { parseMessageMarkdown } from '../src/lib/rendering/message-semantics.ts';
import type { MessageNode } from '../src/lib/rendering/message-semantics.ts';
// A recording Document test double: it implements no HTML parsing API.
class RecordedNode {
    tag: string;
    text: string | null;
    attributes: Record<string, string> = {};
    children: RecordedNode[] = [];
    constructor(tag: string, text: string | null = null) { this.tag = tag; this.text = text; }
    set className(value: string) { this.attributes.class = value; }
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    appendChild(node: RecordedNode) { this.children.push(node); return node; }
}
const recordingDocument = {
    createDocumentFragment: () => new RecordedNode('#fragment'),
    createElement: (tag: string) => new RecordedNode(tag),
    createTextNode: (text: string) => new RecordedNode('#text', text),
} as unknown as Document;
const flatten = (node: RecordedNode): RecordedNode[] => [node, ...node.children.flatMap(flatten)];
test('constructor preserves semantic elements, literal text and whitelisted attributes without HTML APIs', () => {
    const source = '**bold** *italic*\n\n`&amp; <tag>`\n\n```\n  literal &amp;  \n```\n\n- first\n- next\n\n3. third\n4. fourth\n\n| L | C | R |\n|:---|:---:|---:|\n| **x** | `y` | [docs](https://example.com/a) |\n\n<script>literal</script>';
    const semantic = parseMessageMarkdown(source);
    const before = JSON.stringify(semantic);
    const { fragment, links } = buildMessageDom(recordingDocument, semantic.nodes);
    const nodes = flatten(fragment as unknown as RecordedNode);
    for (const tag of ['strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'])
        assert.ok(nodes.some(node => node.tag === tag), tag);
    assert.ok(nodes.some(node => node.tag === 'ol' && node.attributes.start === '3'));
    assert.deepEqual(nodes.filter(node => node.tag === 'th').map(node => node.attributes['data-align']), ['left', 'center', 'right']);
    const region = nodes.find(node => node.attributes.class === 'message-table-scroll')!;
    assert.deepEqual(region.attributes, { class: 'message-table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Message table' });
    assert.ok(nodes.some(node => node.text === '  literal &amp;  \n'));
    assert.ok(nodes.some(node => node.text === '&amp; <tag>'));
    assert.ok(nodes.some(node => node.text?.includes('<script>literal</script>')));
    assert.ok(nodes.every(node => !['script', 'img', 'iframe', 'embed'].includes(node.tag)));
    assert.ok(nodes.every(node => Object.keys(node.attributes).every(key => !key.startsWith('on'))));
    const anchor = nodes.find(node => node.tag === 'a')!;
    assert.equal(links.get(anchor as unknown as Element), 'https://example.com/a');
    assert.equal(JSON.stringify(semantic), before);
});
test('constructor keeps empty text, exact whitespace and both kinds of line break', () => {
    const nodes: MessageNode[] = [{ type: 'text', text: '' }, { type: 'text', text: '  leading\ntrailing  ' }, { type: 'soft_break' }, { type: 'hard_break' }];
    const result = flatten(buildMessageDom(recordingDocument, nodes).fragment as unknown as RecordedNode);
    assert.deepEqual(result.filter(node => node.tag === '#text').map(node => node.text), ['', '  leading\ntrailing  ']);
    assert.equal(result.filter(node => node.tag === 'br').length, 2);
});
test('constructor validates destinations again even when supplied an unsafe AST', () => {
    for (const href of ['javascript:evil', 'data:text/html,x', 'file:///private', '&#106;avascript:evil', 'https%3A%2F%2Fexample.com', 'https://example.com\n']) {
        const nodes: MessageNode[] = [{ type: 'link', href, children: [{ type: 'strong', children: [{ type: 'text', text: 'label' }] }] }];
        const result = flatten(buildMessageDom(recordingDocument, nodes).fragment as unknown as RecordedNode);
        assert.ok(!result.some(node => node.tag === 'a'), href);
        assert.ok(result.some(node => node.tag === 'strong'));
        assert.ok(result.some(node => node.text === 'label'));
    }
});
test('attachment memo is message-local and preserves identity for equal source or AST', () => {
    const first = parseMessageMarkdown('**one**');
    const memo = createMessageAttachment(() => { });
    const attachment = memo('**one**', first);
    const equalSource = parseMessageMarkdown('**one**');
    assert.equal(memo('**one**', equalSource), attachment);
    assert.equal(memo('equivalent source', equalSource), attachment);
    assert.equal(memo('equivalent source', parseMessageMarkdown('**one**')), attachment);
    assert.notEqual(memo('*two*', parseMessageMarkdown('*two*')), attachment);
    assert.notEqual(createMessageAttachment(() => { })('**one**', first), attachment);
});
