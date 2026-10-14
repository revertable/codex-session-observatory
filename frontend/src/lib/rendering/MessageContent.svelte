<script lang="ts">
  import type { TranscriptBlockDto } from '../parse-contract'
  import type { MessageNode } from './message-semantics.ts'
  import { messageSemantics } from './message-semantics.ts'
  import { openExternalLink } from './external-links.ts'

  let { block }: { block: TranscriptBlockDto } = $props()
  const semantic = $derived(messageSemantics(block))
  let linkError = $state('')

  async function followLink(event: MouseEvent, href: string) {
    event.preventDefault()
    try {
      await openExternalLink(href)
      linkError = ''
    } catch {
      linkError = 'Could not open this link.'
    }
  }
</script>

{#snippet nodes(items: MessageNode[])}
  {#each items as node}
    {#if node.type === 'text'}
      <span class="message-text">{node.text}</span>
    {:else if node.type === 'strong'}
      <strong>{@render nodes(node.children ?? [])}</strong>
    {:else if node.type === 'emphasis'}
      <em>{@render nodes(node.children ?? [])}</em>
    {:else if node.type === 'code_inline'}
      <code class="message-inline-code">{node.text}</code>
    {:else if node.type === 'code_block'}
      <pre class="message-code-block"><code>{node.text}</code></pre>
    {:else if node.type === 'soft_break' || node.type === 'hard_break'}
      <br />
    {:else if node.type === 'paragraph'}
      {#if node.tight}<span class="message-tight-paragraph">{@render nodes(node.children ?? [])}</span>
      {:else}<p>{@render nodes(node.children ?? [])}</p>{/if}
    {:else if node.type === 'unordered_list'}
      <ul>{@render nodes(node.children ?? [])}</ul>
    {:else if node.type === 'ordered_list'}
      <ol start={node.start ?? 1}>{@render nodes(node.children ?? [])}</ol>
    {:else if node.type === 'list_item'}
      <li>{@render nodes(node.children ?? [])}</li>
    {:else if node.type === 'link'}
      {#if node.href != null}
        <a href={node.href} onclick={(event) => followLink(event, node.href!)}>{@render nodes(node.children ?? [])}</a>
      {:else}
        {@render nodes(node.children ?? [])}
      {/if}
    {/if}
  {/each}
{/snippet}

{#if semantic === null}
  <pre class="technical-message-content">{block.content}</pre>
{:else}
  <div class="message-content">{@render nodes(semantic.nodes)}</div>
  {#if linkError}<p class="message-link-error" role="status">{linkError}</p>{/if}
{/if}
