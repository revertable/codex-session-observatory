<script lang="ts">
  import type { TranscriptBlockDto } from '../parse-contract'
  import { messageSemantics } from './message-semantics.ts'
  import { createMessageAttachment } from './message-dom.ts'

  let { block }: { block: TranscriptBlockDto } = $props()
  const semantic = $derived(messageSemantics(block))
  let linkError = $state('')
  const attachment = createMessageAttachment(error => { linkError = error })
</script>

{#if semantic === null}
  <pre class="technical-message-content">{block.content}</pre>
{:else}
  <div class="message-content" {@attach attachment(block.content, semantic)}></div>
  {#if linkError}<p class="message-link-error" role="status">{linkError}</p>{/if}
{/if}
