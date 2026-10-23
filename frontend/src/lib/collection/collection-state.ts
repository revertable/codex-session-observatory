import type { TranscriptBlockDto } from '../parse-contract'
import { formatEntryTimestamp } from '../rendering/entry-timestamp.ts'
import { renderLabelForKind } from '../rendering/render-labels.ts'

export interface CollectedMessage {
  readonly id: string
  /** Position in the unfiltered transcript, retained across Refresh. */
  readonly sourceIndex: number
  readonly block: Readonly<TranscriptBlockDto>
}

export interface CollectionState {
  readonly items: readonly CollectedMessage[]
  readonly isOpen: boolean
}

export function createCollectionState(): CollectionState {
  return { items: [], isOpen: false }
}

/** Build keys before filtering so role filters never renumber repeated messages.
 * The tuple is encoded directly, without a lossy hash. The source path isolates
 * files even when session metadata is missing or has been copied between logs.
 */
export function identifyMessages(
  sourcePath: string,
  blocks: readonly TranscriptBlockDto[],
): ReadonlyMap<TranscriptBlockDto, string> {
  const occurrences = new Map<string, number>()
  const keys = new Map<TranscriptBlockDto, string>()
  for (const block of blocks) {
    const signature = JSON.stringify([
      sourcePath, block.entry_type, block.timestamp, block.content,
    ])
    const occurrence = occurrences.get(signature) ?? 0
    occurrences.set(signature, occurrence + 1)
    keys.set(block, JSON.stringify([signature, occurrence]))
  }
  return keys
}

export function toggleCollectedMessage(
  state: CollectionState,
  id: string,
  block: TranscriptBlockDto,
  sourceIndex: number,
): CollectionState {
  if (state.items.some(item => item.id === id)) {
    return { ...state, items: state.items.filter(item => item.id !== id) }
  }
  return {
    // Automatically open when adding the first item; later additions respect
    // the user's decision to keep the panel closed.
    isOpen: state.items.length === 0 ? true : state.isOpen,
    // Keep the shared display/copy array in source order. Neither timestamps
    // nor the time of selection determines a message's position.
    items: [...state.items, { id, sourceIndex, block: Object.freeze({ ...block }) }]
      .sort((left, right) => left.sourceIndex - right.sourceIndex),
  }
}

export function clearCollection(state: CollectionState): CollectionState {
  return { ...state, items: [] }
}

/** Refresh must retain the exact state, including captured text and panel state.
 * Only explicitly selecting another JSONL (or leaving it via Reset) resets it.
 */
export function collectionForSelectedPath(
  state: CollectionState,
  currentPath: string,
  nextPath: string,
): CollectionState {
  return currentPath === nextPath ? state : createCollectionState()
}

export function collectionRoleLabel(block: TranscriptBlockDto): string {
  return `[${renderLabelForKind(block.entry_type, block.label).label}]`
}

/** Copy raw parsed content, including Markdown fences and all whitespace.
 * Only header timestamps are formatted, using the same local label as Transcript.
 */
export function serializeCollection(items: readonly CollectedMessage[]): string {
  return items.map(({ block }) => {
    const role = collectionRoleLabel(block)
    const label = formatEntryTimestamp(block.timestamp)?.label
    const timestamp = label === undefined ? '' : ` · ${label}`
    return `${role}${timestamp}\n${block.content}`
  }).join('\n\n---\n\n')
}
