<script lang="ts">
  import { openExternalLink } from './external-links.ts'
  import MessageContent from './MessageContent.svelte'
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
    showIdentityNote: boolean
    observedEventCounts: ObservedEventCountDto[]
    blocks: TranscriptBlockDto[]
    references: ReferencedConversationDto[]
    collapsedBlocks: Readonly<Record<number, boolean>>
    onToggleBlock: (index: number) => void
  }

  let {
    theme,
    isLoaded,
    publicReleaseStatus,
    showIdentityNote,
    observedEventCounts,
    blocks,
    references,
    collapsedBlocks,
    onToggleBlock,
  }: Props = $props()

  const separator = '========================================================================'
  const displayedEventCounts = $derived(
    [...observedEventCounts].sort((left, right) => right.count - left.count).slice(0, 8),
  )

  function displayLabel(block: TranscriptBlockDto) {
    const sourceLabel = block.label.trim()

    if (sourceLabel !== '') {
      return sourceLabel
    }

    return `[${renderLabelForKind(block.entry_type, '').label}]`
  }

  async function visitCosmicHorizon(event: MouseEvent) {
    event.preventDefault()
    await openExternalLink(COSMIC_HORIZON_URL)
  }
</script>

<div class="terminal-transcript" aria-label="Terminal transcript">
  <div class="terminal-title">Codex Session Observatory</div>
  <div class="terminal-blank" aria-hidden="true"></div>

  {#if !isLoaded}
    {#if showIdentityNote}
      <div>Codex Session Observatory is built from the Cosmic Horizon approach to observable AI-assisted work.</div>
      <div>Cosmic Horizon Archive&nbsp; <a class="terminal-visit-link" href={COSMIC_HORIZON_URL} onclick={visitCosmicHorizon}>[Visit]</a></div>
      {#if publicReleaseStatus !== null}
        <div><UpdateNotice releaseStatus={publicReleaseStatus} presentation="terminal" /></div>
      {/if}
      <div class="terminal-blank" aria-hidden="true"></div>
      <div>Select a local JSONL session to begin.</div>
    {/if}
    <div class="terminal-metadata">Current theme: {theme}</div>
    <div>Ready.</div>
  {:else}
    <div class="terminal-separator">{separator}</div>
    <div class="terminal-blank" aria-hidden="true"></div>
    {#if references.length > 0}
      <ConversationReferences {references} />
      <div class="terminal-blank" aria-hidden="true"></div>
    {/if}

    {#if blocks.length === 0}
      <div>No renderable chat messages found in this JSONL file.</div>

      {#if displayedEventCounts.length > 0}
        <div class="terminal-blank" aria-hidden="true"></div>
        <div class="terminal-metadata">Observed event types:</div>
        {#each displayedEventCounts as eventCount}
          <div class="terminal-metadata">- {eventCount.event}: {eventCount.count}</div>
        {/each}
      {/if}

      <div class="terminal-blank" aria-hidden="true"></div>
    {:else}
      {#each blocks as block, index}
        {@const label = renderLabelForKind(block.entry_type, block.label)}
        {@const isCollapsed = collapsedBlocks[index] ?? false}
        {@const timestamp = formatEntryTimestamp(block.timestamp)}
        <section class="terminal-block" data-family={label.family} data-kind={block.entry_type}>
          <button
            type="button"
            class="terminal-block-toggle"
            aria-expanded={!isCollapsed}
            onclick={() => onToggleBlock(index)}
          >
            {isCollapsed ? '[>]' : '[v]'} {displayLabel(block)}{#if timestamp !== null}<time
                class="terminal-block-timestamp"
                datetime={timestamp.datetime}
                title={`Original timestamp: ${timestamp.datetime}`}
              > · {timestamp.label}</time>{/if}
          </button>
          {#if !isCollapsed}
            <MessageContent {block} />
          {/if}
        </section>

        {#if index !== blocks.length - 1}
          <div class="terminal-blank" aria-hidden="true"></div>
        {/if}
      {/each}

      <div class="terminal-blank" aria-hidden="true"></div>
    {/if}

    <div class="terminal-separator">{separator}</div>
  {/if}
</div>
