<script lang="ts">
  import { openExternalLink } from './external-links.ts'
  import MessageContent from './MessageContent.svelte'
  import CollectionToggle from '../collection/CollectionToggle.svelte'
  import type { ObservedEventCountDto, ReferencedConversationDto, TranscriptBlockDto } from '../parse-contract'
  import type { PublicReleaseStatus } from '../update-check'
  import { formatEntryTimestamp } from './entry-timestamp.ts'
  import { renderLabelForKind } from './render-labels'
  import type { TranscriptThemeName } from './transcript-themes'
  import ConversationReferences from './ConversationReferences.svelte'
  import UpdateNotice from './UpdateNotice.svelte'

  const COSMIC_HORIZON_URL =
    'https://riu-salze-studio.gitbook.io/cosmic-horizon?utm_source=codex_session_observatory&utm_medium=desktop_app&utm_campaign=visit_cosmic_horizon'

  interface Props {
    theme: TranscriptThemeName
    isLoaded: boolean
    publicReleaseStatus: PublicReleaseStatus | null
    observedEventCounts: ObservedEventCountDto[]
    blocks: TranscriptBlockDto[]
    messageIds: ReadonlyMap<TranscriptBlockDto, string>
    references: ReferencedConversationDto[]
    collapsedBlocks: Readonly<Record<number, boolean>>
    onToggleBlock: (index: number) => void
    collectedBlocks?: readonly boolean[]
    onToggleCollection?: (index: number) => void
  }

  let {
    theme,
    isLoaded,
    publicReleaseStatus,
    observedEventCounts,
    blocks,
    messageIds,
    references,
    collapsedBlocks,
    onToggleBlock,
    collectedBlocks = [],
    onToggleCollection,
  }: Props = $props()

  const displayedEventCounts = $derived(
    [...observedEventCounts].sort((left, right) => right.count - left.count).slice(0, 8),
  )

  async function visitCosmicHorizon(event: MouseEvent) {
    event.preventDefault()
    await openExternalLink(COSMIC_HORIZON_URL)
  }
</script>

<div class="transcript-presentation markdown-transcript" data-empty={!isLoaded} aria-label="Markdown transcript">
  <header class="markdown-document-header">
    <p class="markdown-kicker">Markdown Style</p>
    {#if !isLoaded}
      <div class="transcript-empty-state markdown-empty-state">
        <p class="empty-intro">Codex Session Observatory is built from the Cosmic Horizon approach to observable AI-assisted work.</p>
        <p class="empty-provenance">
          Cosmic Horizon Archive
          <a href={COSMIC_HORIZON_URL} onclick={visitCosmicHorizon}>[Visit]</a>
        </p>
        {#if publicReleaseStatus !== null}
          <p class="empty-version"><UpdateNotice releaseStatus={publicReleaseStatus} presentation="markdown" /></p>
        {/if}
        <p class="empty-selection">Select a session from Sessions to begin.</p>
        <p class="empty-metadata markdown-empty-metadata">Current theme: {theme}</p>
      </div>
    {/if}
  </header>

  {#if isLoaded}
    {#if references.length > 0}
      <div class="markdown-blocks">
        <ConversationReferences {references} />
      </div>
    {/if}
    {#if blocks.length === 0}
      <section class="markdown-notice">
        <p>No renderable chat messages found in this JSONL file.</p>
        {#if displayedEventCounts.length > 0}
          <h3>Observed event types</h3>
          <ul>
            {#each displayedEventCounts as eventCount}
              <li>{eventCount.event}: {eventCount.count}</li>
            {/each}
          </ul>
        {/if}
      </section>
    {:else}
      <div class="markdown-blocks">
        {#each blocks as block, index (messageIds.get(block))}
          {@const label = renderLabelForKind(block.entry_type, block.label)}
          {@const isCollapsed = collapsedBlocks[index] ?? false}
          {@const timestamp = formatEntryTimestamp(block.timestamp)}
          <section class="markdown-block" data-family={label.family} data-kind={block.entry_type}>
            <div class="transcript-message-header">
            <button
              type="button"
              class="markdown-block-toggle"
              aria-expanded={!isCollapsed}
              onclick={() => onToggleBlock(index)}
            >
              <span class="transcript-toggle-marker" aria-hidden="true">{isCollapsed ? '>' : 'v'}</span>
              <strong>[{label.label}]</strong>
              {#if timestamp !== null}
                <time
                  class="transcript-block-timestamp"
                  datetime={timestamp.datetime}
                  title={`Original timestamp: ${timestamp.datetime}`}
                >{timestamp.label}</time>
              {/if}
            </button>
            {#if onToggleCollection}
              <CollectionToggle selected={collectedBlocks[index] ?? false} onToggle={() => onToggleCollection?.(index)} />
            {/if}
            </div>
            {#if !isCollapsed}
              <MessageContent {block} />
            {/if}
          </section>
        {/each}
      </div>
    {/if}
  {/if}
</div>
