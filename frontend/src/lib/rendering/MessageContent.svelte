<script lang="ts">
  import type { TranscriptBlockDto } from '../parse-contract'
  import { messageSemantics } from './message-semantics.ts'
  import { useStatus } from '../control-room/status-context'
  import type { StatusToken } from '../control-room/status-line'
  import { openExternalLink } from './external-links'
  import { createMessageAttachment } from './message-dom.ts'

  let { block }: { block: TranscriptBlockDto } = $props()
  const semantic = $derived(messageSemantics(block))
  const feedback = useStatus()
  let token: StatusToken | undefined
  const attachment = createMessageAttachment(error => {
    feedback?.finish(token, error ? 'error' : 'info', error)
    token = undefined
  }, href => {
    token = feedback?.begin('link', '', true)
    return openExternalLink(href)
  })
</script>

{#if semantic === null}
  <pre class="technical-message-content">{block.content}</pre>
{:else}
  <div class="message-content" {@attach attachment(block.content, semantic)}></div>
{/if}
