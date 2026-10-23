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
    theme: Extract<TranscriptThemeName, 'DM Style' | 'DM Style (Dark)'>
    isLoaded: boolean
    publicReleaseStatus: PublicReleaseStatus | null
    observedEventCounts: ObservedEventCountDto[]
    blocks: TranscriptBlockDto[]
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

<div
  class="chat-transcript"
  data-chat-theme={theme === 'DM Style (Dark)' ? 'dark' : 'light'}
  aria-label={`${theme} transcript`}
>
  <header class="chat-transcript-header">
    <div>
      <strong>Session Observatory</strong>
      <span>{theme}</span>
    </div>
    {#if !isLoaded}
      <div class="chat-empty-state">
        <p>Codex Session Observatory is built from the Cosmic Horizon approach to observable AI-assisted work.</p>
        <p>
          Cosmic Horizon Archive
          <a href={COSMIC_HORIZON_URL} onclick={visitCosmicHorizon}>[Visit]</a>
        </p>
        {#if publicReleaseStatus !== null}
          <p><UpdateNotice releaseStatus={publicReleaseStatus} presentation="chat" /></p>
        {/if}
        <p>Select a local JSONL session to begin.</p>
        <p class="chat-empty-metadata">Current theme: {theme}</p>
        <p>Ready.</p>
      </div>
    {/if}
  </header>

  {#if isLoaded}
    {#if references.length > 0}
      <div class="chat-blocks">
        <ConversationReferences {references} />
      </div>
    {/if}
    {#if blocks.length === 0}
      <section class="chat-notice">
        <p>No renderable chat messages found in this JSONL file.</p>
        {#if displayedEventCounts.length > 0}
          <p>Observed event types:</p>
          <ul>
            {#each displayedEventCounts as eventCount}
              <li>{eventCount.event}: {eventCount.count}</li>
            {/each}
          </ul>
        {/if}
      </section>
    {:else}
      <div class="chat-blocks">
        {#each blocks as block, index}
          {@const label = renderLabelForKind(block.entry_type, block.label)}
          {@const isCollapsed = collapsedBlocks[index] ?? false}
          {@const timestamp = formatEntryTimestamp(block.timestamp)}
          <section class="chat-block" data-family={label.family} data-kind={block.entry_type}>
            <div class="transcript-message-header">
            <button
              type="button"
              class="chat-block-toggle"
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
