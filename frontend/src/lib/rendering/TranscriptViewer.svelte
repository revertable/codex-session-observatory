<script lang="ts">
  import type { ObservedEventCountDto, ReferencedConversationDto, TranscriptBlockDto } from '../parse-contract'
  import type { PublicReleaseStatus } from '../update-check'
  import { renderPathForTheme, type TranscriptThemeName } from './transcript-themes'
  import TerminalTranscript from './TerminalTranscript.svelte'
  import MarkdownTranscript from './MarkdownTranscript.svelte'
  import ChatTranscript from './ChatTranscript.svelte'

  interface Props {
    theme: TranscriptThemeName
    isLoaded: boolean
    publicReleaseStatus: PublicReleaseStatus | null
    observedEventCounts: ObservedEventCountDto[]
    blocks: TranscriptBlockDto[]
    // Keys come from the unfiltered source and survive equivalent Refresh DTOs.
    messageIds: ReadonlyMap<TranscriptBlockDto, string>
    references: ReferencedConversationDto[]
    collapsedBlocks: Readonly<Record<number, boolean>>
    onToggleBlock: (index: number) => void
    collectedBlocks: readonly boolean[]
    onToggleCollection: (index: number) => void
  }
  let { theme, isLoaded, publicReleaseStatus, observedEventCounts, blocks, messageIds, references,
    collapsedBlocks, onToggleBlock, collectedBlocks, onToggleCollection }: Props = $props()
</script>

{#if renderPathForTheme(theme) === 'terminal'}
  <TerminalTranscript {theme} {isLoaded} {publicReleaseStatus} showIdentityNote={!isLoaded}
    {observedEventCounts} {blocks} {messageIds} {references} {collapsedBlocks} {onToggleBlock}
    {collectedBlocks} {onToggleCollection} />
{:else if renderPathForTheme(theme) === 'markdown'}
  <MarkdownTranscript {theme} {isLoaded} {publicReleaseStatus} {observedEventCounts}
    {blocks} {messageIds} {references} {collapsedBlocks} {onToggleBlock} {collectedBlocks} {onToggleCollection} />
{:else}
  <ChatTranscript theme={theme as 'DM Style' | 'DM Style (Dark)'} {isLoaded} {publicReleaseStatus}
    {observedEventCounts} {blocks} {messageIds} {references} {collapsedBlocks} {onToggleBlock}
    {collectedBlocks} {onToggleCollection} />
{/if}
