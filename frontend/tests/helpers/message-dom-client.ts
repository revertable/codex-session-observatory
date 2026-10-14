import { mount, unmount, flushSync, tick } from 'svelte';
import MessageContent from '../../src/lib/rendering/MessageContent.svelte';
import Terminal from '../../src/lib/rendering/TerminalTranscript.svelte';
import Markdown from '../../src/lib/rendering/MarkdownTranscript.svelte';
import Chat from '../../src/lib/rendering/ChatTranscript.svelte';
import Host from '../fixtures/MessageContentHost.svelte';
import { buildMessageDom, mountMessageDom } from '../../src/lib/rendering/message-dom.ts';
import { parseMessageMarkdown } from '../../src/lib/rendering/message-semantics.ts';
import { serializeTranscript } from '../../src/lib/rendering/transcript-capture.ts';
import '../../src/app.css';
import '../../src/lib/rendering/transcript.css';
const target = document.querySelector('#target') as HTMLElement;
const assert = (condition: unknown, message: string) => { if (!condition)
    throw new Error(message); };
const block = (content: string, entry_type = 'you') => ({ entry_type, content, label: '[YOU]', title: '[YOU]', timestamp: '2026-01-01T01:02:03Z' });
const settle = async () => { flushSync(); await tick(); await new Promise(resolve => setTimeout(resolve, 0)); flushSync(); };
const code = (text: string) => String.fromCharCode(96) + text + String.fromCharCode(96);
const fence = String.fromCharCode(96).repeat(3);
const opened: string[] = [];
let failOpen = false;
(window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: {
        url: string;
    }) => {
        assert(command === 'plugin:opener|open_url', 'existing opener command');
        opened.push(args.url);
        if (failOpen)
            throw new Error('mock opener denied');
    } };
const source = '**important** *italic*\n\n' + code('CONFIG=9000') + ' &#x20;\nApply\n\n- A\n- B\n\n3. third\n4. fourth\n\n' + fence + '\n  literal &amp;  \n' + fence + '\n\n[docs](https://example.com/docs)\n<script>alert(1)</script>\n<img src="https://example.com/image" onerror="alert(1)">';
const tableSource = '| Left | Center | Right |\n| :--- | :---: | ---: |\n| **strong** | *italic* ' + code('code') + ' | [docs](https://example.com/docs) |\n| <script>alert(1)</script> | <img src="https://example.com/x" onerror="evil"> | [bad](javascript:evil) |';
const themes = [['Terminal Style', Terminal], ['Markdown Style', Markdown], ['DM Style', Chat], ['DM Style (Dark)', Chat]] as const;
function inert(root: Element) {
    assert(!root.querySelector('script,img,iframe,embed,object'), 'no executable/resource element');
    assert(Array.from(root.querySelectorAll('*')).every(element => Array.from(element.attributes).every(attribute => !attribute.name.startsWith('on'))), 'no event attributes');
    assert(Array.from(root.querySelectorAll('a')).every(anchor => ['https:', 'http:'].includes(new URL(anchor.href).protocol)), 'web protocols only');
}
function semanticAssertions(root: HTMLElement) {
    assert(root.querySelector('.message-content strong')?.textContent === 'important', 'bold');
    assert(root.querySelector('.message-content em')?.textContent === 'italic', 'italic');
    assert(root.querySelector('.message-inline-code')?.textContent === 'CONFIG=9000', 'inline code');
    assert(root.querySelector('.message-content ul'), 'unordered list');
    assert(root.querySelector('.message-content ol')?.getAttribute('start') === '3', 'ordered list start');
    assert(root.querySelector('.message-content br'), 'line break');
    assert(root.querySelector('.message-content a')?.getAttribute('href') === 'https://example.com/docs', 'link');
    assert(root.querySelector('.message-code-block code')?.textContent === '  literal &amp;  \n', 'fenced literal whitespace/entity');
    assert(root.querySelector('.message-content')?.textContent?.includes('<script>alert(1)</script>'), 'raw HTML is literal text');
    assert(!root.querySelector('.message-content')?.textContent?.includes('&#x20;'), 'entity interpreted outside code');
    assert(root.querySelector('.technical-message-content')?.textContent === '**technical**', 'technical stays plain');
    inert(root);
}
const cases: Record<string, () => Promise<void>> = {
    async 'constructor keeps breaks, entities, empty leaves and inert destinations'() {
        for (const [input, expected] of [['first\nsecond', 'first\nsecond'], ['first  \nsecond', 'first\nsecond'], [code('CONFIG=9000') + ' &#x20;\nApply', 'CONFIG=9000  \nApply'], ['<tag> > & &amp; &#x20; &madeup;', '<tag> > & &   &madeup;'], [code('&amp; &#x20; <tag>'), '&amp; &#x20; <tag>'], ['\\&amp;', '&amp;']]) {
            const host = document.createElement('div');
            const semantic = parseMessageMarkdown(input);
            const before = JSON.stringify(semantic);
            host.append(buildMessageDom(document, semantic.nodes).fragment);
            function text(node: Node): string { return node.nodeType === 3 ? node.nodeValue! : (node as Element).tagName === 'BR' ? '\n' : Array.from(node.childNodes).map(text).join(''); }
            assert(text(host) === expected, 'exact rendered inline text: ' + input);
            assert(JSON.stringify(semantic) === before, 'AST unchanged');
            inert(host);
            const walker = document.createTreeWalker(host, NodeFilter.SHOW_COMMENT);
            assert(!walker.nextNode(), 'no structural anchors');
        }
        const host = document.createElement('div');
        host.append(buildMessageDom(document, [{ type: 'text', text: '' }]).fragment);
        assert(host.firstChild?.firstChild?.nodeType === 3 && host.firstChild.firstChild.nodeValue === '', 'empty semantic leaf retained');
        for (const href of ['javascript:evil', 'data:text/html,x', 'file:///private', 'javascript&#58;evil', 'https%3A%2F%2Fexample.com']) {
            host.replaceChildren(buildMessageDom(document, [{ type: 'link', href, children: [{ type: 'text', text: 'label' }] }]).fragment);
            assert(!host.querySelector('a') && host.textContent === 'label', 'unsafe direct AST rejected');
        }
    },
    async 'all four themes preserve original semantic and table assertions and collapse'() {
        for (const [theme, component] of themes) {
            target.replaceChildren();
            const blocks = [block(source), block('**technical**', 'tool_result'), block(tableSource)];
            let collapsedBlocks: Record<number, boolean> = {};
            const props = { theme, isLoaded: true, publicReleaseStatus: null, showIdentityNote: false, observedEventCounts: [], blocks, references: [], collapsedBlocks, onToggleBlock: (index: number) => { collapsedBlocks = { ...collapsedBlocks, [index]: !collapsedBlocks[index] }; instance.replace({ ...props, collapsedBlocks }); } };
            const before = JSON.stringify(blocks);
            const captured = serializeTranscript({ ...props, theme: theme as any });
            const instance = mount(Host, { target, props: { component: component as any, props } });
            try {
                await settle();
                semanticAssertions(target);
                const table = target.querySelector('table')!;
                assert(table, 'table present');
                assert(table.querySelectorAll('thead').length === 1 && table.querySelectorAll('tbody').length === 1, 'table sections');
                assert(table.querySelectorAll('tr').length === 3, 'row count');
                assert(table.querySelector('th[scope="col"][data-align="center"]'), 'header alignment/scope');
                assert(table.querySelector('td[data-align="right"]'), 'cell alignment');
                const region = table.parentElement!;
                assert(region.tabIndex === 0 && region.getAttribute('role') === 'region' && region.getAttribute('aria-label') === 'Message table', 'accessible scroll region');
                assert(table.querySelector('code')?.textContent === 'code', 'table inline code');
                inert(table);
                assert(JSON.stringify(blocks) === before, 'DTO unchanged');
                assert(serializeTranscript({ ...props, theme: theme as any }) === captured, 'Capture unchanged by mount');
                const buttons = target.querySelectorAll<HTMLButtonElement>('[aria-expanded]');
                buttons[2].click();
                await settle();
                assert(!target.querySelector('table'), 'collapsed table absent');
                assert(buttons[2].getAttribute('aria-expanded') === 'false', 'collapsed state');
                buttons[2].click();
                await settle();
                assert(target.querySelector('table'), 'expanded table restored');
                instance.replace({ ...props, collapsedBlocks: { 0: true, 1: true, 2: true } });
                await settle();
                assert(!target.querySelector('.message-content,.technical-message-content'), 'all collapsed bodies absent');
            }
            finally {
                await unmount(instance);
                await settle();
                target.replaceChildren();
            }
        }
    },
    async 'attachment preserves subtree identity and cleans replacement and unmount listeners'() {
        const prototype = HTMLElement.prototype;
        const originalAdd = prototype.addEventListener;
        const originalRemove = prototype.removeEventListener;
        const owned = new Map<HTMLElement, Set<EventListenerOrEventListenerObject>>();
        prototype.addEventListener = function (type: any, listener: any, options: any) { if (type === 'click' && this.classList.contains('message-content')) {
            if (!owned.has(this))
                owned.set(this, new Set());
            owned.get(this)!.add(listener);
        } return originalAdd.call(this, type, listener, options); };
        prototype.removeEventListener = function (type: any, listener: any, options: any) { if (type === 'click')
            owned.get(this)?.delete(listener); return originalRemove.call(this, type, listener, options); };
        const first = block('**one** [docs](https://example.com/docs)');
        const instance = mount(Host, { target, props: { component: MessageContent as any, props: { block: first } } });
        let disposed = false;
        try {
            await settle();
            const host = target.querySelector<HTMLElement>('.message-content')!;
            const leaf = host.querySelector('strong')!;
            const anchor = host.querySelector('a')!;
            const observer = new MutationObserver(() => { });
            observer.observe(host, { childList: true, subtree: true, characterData: true });
            instance.replace({ block: { ...first } });
            await settle();
            assert(host.querySelector('strong') === leaf && observer.takeRecords().length === 0, 'equal-content new DTO does not rebuild');
            opened.length = 0;
            anchor.click();
            await settle();
            assert(opened[0] === 'https://example.com/docs', 'existing Tauri opener');
            failOpen = true;
            anchor.click();
            await settle();
            failOpen = false;
            assert(target.querySelector('.message-link-error')?.textContent === 'Could not open this link.', 'error displayed');
            assert(host.querySelector('strong') === leaf, 'link error does not rebuild');
            anchor.click();
            await settle();
            assert(!target.querySelector('.message-link-error'), 'success clears error');
            assert(host.querySelector('strong') === leaf, 'link success does not rebuild');
            observer.disconnect();
            instance.replace({ block: block('*two*\n\n' + tableSource) });
            await settle();
            assert(!leaf.isConnected && host.querySelector('em')?.textContent === 'two', 'replacement cleans old subtree');
            assert(owned.get(host)?.size === 1, 'exactly one current listener');
            for (const type of ['tool_call', 'tool_result', 'system', 'context', 'task']) {
                instance.replace({ block: block('**raw** <script>literal</script>', type) });
                await settle();
                assert(target.querySelector('.technical-message-content')?.textContent === '**raw** <script>literal</script>', 'technical plain');
                assert(!target.querySelector('.message-content,script'), 'technical has no semantic subtree');
            }
            instance.replace({ block: first });
            await settle();
            assert(target.querySelector('strong'), 'semantic restored');
            await unmount(instance);
            disposed = true;
            await settle();
            assert(Array.from(owned.values()).every(listeners => listeners.size === 0), 'all owned listeners removed');
            assert(host.childNodes.length === 0, 'old host emptied');
        }
        finally {
            failOpen = false;
            if (!disposed)
                await unmount(instance);
            prototype.addEventListener = originalAdd;
            prototype.removeEventListener = originalRemove;
            target.replaceChildren();
        }
    },
    async 'pending and superseded link completions cannot update disposed or newer content'() {
        const host = document.createElement('div');
        target.append(host);
        const statuses: string[] = [];
        const requests: {
            resolve: () => void;
            reject: () => void;
        }[] = [];
        const cleanup = mountMessageDom(host, parseMessageMarkdown('[**nested**](https://example.com)').nodes, error => statuses.push(error), () => new Promise<void>((resolve, reject) => requests.push({ resolve, reject: () => reject(Error('denied')) })));
        const anchor = host.querySelector('a')!;
        host.querySelector<HTMLElement>('strong')!.click();
        anchor.click();
        await settle();
        requests[1].resolve();
        await settle();
        const afterLatest = statuses.length;
        requests[0].reject();
        await settle();
        assert(statuses.length === afterLatest, 'superseded failure ignored');
        anchor.click();
        await settle();
        cleanup();
        requests[2].reject();
        await settle();
        assert(statuses.length === afterLatest, 'disposed failure ignored');
        host.append(anchor);
        anchor.removeAttribute('href');
        const count = requests.length;
        anchor.click();
        await settle();
        assert(requests.length === count, 'detached owned listener removed');
        target.replaceChildren();
    },
};
(globalThis as any).__domCases = cases;
(globalThis as any).__domReady = true;
