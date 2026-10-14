import { untrack } from 'svelte'
import type { Attachment } from 'svelte/attachments'
import type { MessageNode, MessageSemantics } from './message-semantics.ts'
import { openExternalLink, validatedExternalUrl } from './external-links.ts'

interface MessageDom {
  fragment: DocumentFragment
  links: WeakMap<Element, string>
}

/** Build only the semantic elements we support. Source text never becomes HTML. */
export function buildMessageDom(document: Document, nodes: readonly MessageNode[]): MessageDom {
  const fragment = document.createDocumentFragment()
  const links = new WeakMap<Element, string>()
  appendNodes(document, nodes, fragment, links)
  return { fragment, links }
}

function appendNodes(
  document: Document,
  nodes: readonly MessageNode[],
  parent: Node,
  links: WeakMap<Element, string>,
): void {
  for (const node of nodes) {
    let element: HTMLElement
    let childParent: HTMLElement | undefined
    switch (node.type) {
      case 'text':
        element = document.createElement('span')
        element.className = 'message-text'
        element.appendChild(document.createTextNode(node.text ?? ''))
        break
      case 'code_inline':
        element = document.createElement('code')
        element.className = 'message-inline-code'
        element.appendChild(document.createTextNode(node.text ?? ''))
        break
      case 'code_block':
        element = document.createElement('pre')
        element.className = 'message-code-block'
        childParent = document.createElement('code')
        childParent.appendChild(document.createTextNode(node.text ?? ''))
        element.appendChild(childParent)
        break
      case 'soft_break': case 'hard_break': element = document.createElement('br'); break
      case 'paragraph':
        element = document.createElement(node.tight ? 'span' : 'p')
        if (node.tight) element.className = 'message-tight-paragraph'
        break
      case 'strong': element = document.createElement('strong'); break
      case 'emphasis': element = document.createElement('em'); break
      case 'unordered_list': element = document.createElement('ul'); break
      case 'ordered_list':
        element = document.createElement('ol')
        element.setAttribute('start', String(node.start ?? 1))
        break
      case 'list_item': element = document.createElement('li'); break
      case 'table':
        element = document.createElement('div')
        element.className = 'message-table-scroll'
        element.setAttribute('tabindex', '0')
        element.setAttribute('role', 'region')
        element.setAttribute('aria-label', 'Message table')
        childParent = document.createElement('table')
        childParent.className = 'message-table'
        element.appendChild(childParent)
        break
      case 'table_head': element = document.createElement('thead'); break
      case 'table_body': element = document.createElement('tbody'); break
      case 'table_row': element = document.createElement('tr'); break
      case 'table_header_cell': case 'table_cell':
        element = document.createElement(node.type === 'table_header_cell' ? 'th' : 'td')
        if (node.type === 'table_header_cell') element.setAttribute('scope', 'col')
        element.setAttribute('data-align', node.alignment === 'center' || node.alignment === 'right' ? node.alignment : 'left')
        break
      case 'link': {
        const href = node.href == null ? null : validatedExternalUrl(node.href)
        if (href === null) {
          appendNodes(document, node.children ?? [], parent, links)
          continue
        }
        element = document.createElement('a')
        element.setAttribute('href', href)
        links.set(element, href)
        break
      }
      default: {
        const unsupported: never = node.type
        throw new Error(`Unsupported message node: ${unsupported}`)
      }
    }
    if (node.children) appendNodes(document, node.children, childParent ?? element, links)
    parent.appendChild(element)
  }
}

export function mountMessageDom(
  host: HTMLElement,
  nodes: readonly MessageNode[],
  onLinkStatus: (error: string) => void,
  openLink: (href: string) => Promise<void> = openExternalLink,
): () => void {
  const { fragment, links } = buildMessageDom(host.ownerDocument, nodes)
  host.replaceChildren(fragment)
  onLinkStatus('')
  let active = true
  let request = 0
  async function followLink(event: Event): Promise<void> {
    const ElementClass = host.ownerDocument.defaultView?.Element
    if (!active || !ElementClass || !(event.target instanceof ElementClass)) return
    const anchor = event.target.closest('a')
    const href = anchor === null ? undefined : links.get(anchor)
    if (href === undefined) return
    event.preventDefault()
    const current = ++request
    try {
      await openLink(href)
      if (active && current === request) onLinkStatus('')
    } catch {
      if (active && current === request) onLinkStatus('Could not open this link.')
    }
  }
  host.addEventListener('click', followLink)
  return () => {
    active = false
    host.removeEventListener('click', followLink)
    host.replaceChildren()
  }
}

/** One memo per MessageContent; identical source does not replace its subtree. */
export function createMessageAttachment(
  onLinkStatus: (error: string) => void,
): (content: string, semantic: MessageSemantics) => Attachment<HTMLElement> {
  let previousContent: string | undefined
  let previousSemantic: MessageSemantics | undefined
  let previousAttachment: Attachment<HTMLElement> | undefined
  return (content, semantic) => {
    const unchanged = previousAttachment && (content === previousContent || semantic === previousSemantic)
    previousContent = content
    previousSemantic = semantic
    if (unchanged) return previousAttachment!
    previousAttachment = host => untrack(() => mountMessageDom(host, semantic.nodes, onLinkStatus))
    return previousAttachment
  }
}
