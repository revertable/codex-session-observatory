# Parser Port Plan

> **Status: historical reference.** This document records the completed Kotlin/Swing-to-Rust parser port plan and the source observations that grounded it. Current behavior is defined by the Rust implementation under `backend/src/parser/`, `backend/src/inspection/`, `backend/src/session/`, and their tests.

Later product work intentionally extended the original parity scope with session classification/routing, Guardian specialized-session handling, parent-session lookup, and conservative user transport/context decoding. Statements below such as “proposed,” “to port,” “first milestone,” and “future implementation” describe the migration stage when this record was written.

This plan is grounded in the existing Kotlin/Swing `codex-chat-viewer` parser and is documentation only. The reference repository remains read-only.

## 1. Existing Kotlin Parser Entry Points

- `JsonlChatParser.parse(file: File): ParsedChatLog`
  - Main parser entry point.
  - Returns an empty `ParsedChatLog` when the input path is not a file.
  - Reads the JSONL file line by line, extracts renderable candidates, counts malformed and ignored lines, observes event types, then deduplicates candidates into visible entries.
- `CodexChatViewerFrame.updateSelection(selectedFile: File?)`
  - UI integration point.
  - Calls `JsonlChatParser.parse(selectedFile)` after detecting the session id.
- `ChatRenderer.render(file: File, sessionId: String?, parsedChatLog: ParsedChatLog): String`
  - Text rendering entry point for parsed output.
  - Displays entries, parsed candidate count, visible entry count, ignored line count, and malformed line count.
  - Displays top observed event counts when no renderable entries are found.
- `ParsedChatLog.filtered(filter: ChatEntryFilter): ParsedChatLog`
  - Parser-adjacent filtering entry point.
  - Filters `entries` without reparsing and preserves parse counters.
- `ParsedChatLog.transcriptBlocks(): List<TranscriptBlock>`
  - Parser-to-transcript adapter.
  - Converts rendered entries into labeled transcript blocks.

## 2. Existing Data Model

### `ParsedChatLog`

```kotlin
data class ParsedChatLog(
    val entries: List<RenderedEntry>,
    val parsedCandidates: Int,
    val ignoredLines: Int,
    val malformedLines: Int,
    val observedEventCounts: Map<String, Int>
)
```

- `entries`: deduplicated renderable observations.
- `parsedCandidates`: count of extracted candidates before deduplication.
- `ignoredLines`: valid JSON lines that produce no renderable candidate.
- `malformedLines`: non-empty lines that cannot be parsed as JSON.
- `observedEventCounts`: counts by top-level event key.

### `RenderedEntry`

```kotlin
data class RenderedEntry(
    val kind: RenderedEntryKind,
    val content: String
)
```

### `RenderedEntryKind`

```kotlin
enum class RenderedEntryKind(val label: String) {
    CONTEXT("[CONTEXT]"),
    TASK("[TASK]"),
    YOU("[YOU]"),
    CODEX("[CODEX]"),
    TOOL_CALL("[TOOL CALL]"),
    TOOL_RESULT("[TOOL RESULT]"),
    SYSTEM("[SYSTEM]")
}
```

Meaning:

- `CONTEXT`: injected `AGENTS.md` project instruction content, rendered as the summary `AGENTS.md project instructions loaded`.
- `TASK`: injected task or prompt body, rendered as the summary `Task or prompt instructions loaded`.
- `YOU`: normal user-visible user message.
- `CODEX`: assistant/model/agent message.
- `TOOL_CALL`: function, custom tool, command, or tool-call request summary.
- `TOOL_RESULT`: function output, command result, custom tool output, patch result, or tool result text.
- `SYSTEM`: system/session/task lifecycle metadata.

### Transcript Block Structures

```kotlin
data class TranscriptBlock(
    val type: RenderedEntryKind,
    val label: String,
    val title: String,
    val content: String
)
```

`ParsedChatLog.transcriptBlocks()` maps every `RenderedEntry` to:

- `type = entry.kind`
- `label = entry.kind.label`
- `title = entry.kind.label`
- `content = entry.content`

### Parser-Internal Candidate Model

```kotlin
private data class ParsedCandidate(
    val entry: RenderedEntry,
    val stableKey: String?,
    val normalizedText: String,
    val source: CandidateSource,
    val timestamp: String?
)
```

`CandidateSource` priority order:

- `RESPONSE_MESSAGE`: 4
- `RESPONSE_TOOL_RESULT`: 4
- `EVENT_TOOL_RESULT`: 3
- `RESPONSE_TOOL_CALL`: 3
- `EVENT_USER_MESSAGE`: 3
- `EVENT_AGENT_MESSAGE`: 2
- `EVENT_SYSTEM`: 2
- `FALLBACK`: 1

## 3. How JSONL Lines Are Read

- The parser opens the file with a UTF-8 decoder configured with replacement behavior:
  - malformed input: replace
  - unmappable character: replace
- It uses line iteration over a buffered input stream.
- Each raw line is trimmed.
- Empty trimmed lines are skipped and are not counted as ignored or malformed.
- Each non-empty trimmed line is parsed independently as JSON.
- JSON parse failure increments `malformedLines` and parsing continues with the next line.

## 4. How Codex Event Types Are Interpreted

The parser first tries envelope-specific extraction:

- Top-level `type = "event_msg"`
  - Reads `payload.type`.
  - `user_message`: extracts `payload.message`, then classifies it as `CONTEXT`, `TASK`, or `YOU`.
  - `agent_message`: extracts `payload.message` as `CODEX`.
  - `exec_command_end`: builds a `TOOL_RESULT` containing command summary, status/exit code, and first available output from `aggregated_output`, `formatted_output`, `stdout`, or `stderr`.
  - `patch_apply_end`: builds `TOOL_RESULT` with `Patch apply status: <status>`.
  - `task_started` and `task_complete`: builds `SYSTEM` entry from lifecycle type and optional `turn_id`.
  - Other payload types are ignored.
- Top-level `type = "response_item"`
  - Reads `payload.type`.
  - `message`: uses role-based extraction.
  - `function_call` and `custom_tool_call`: build `TOOL_CALL`.
  - `function_call_output` and `custom_tool_call_output`: build `TOOL_RESULT`.
  - Other payload types are ignored.
- Top-level `type = "session_meta"`
  - Builds a `SYSTEM` entry from `payload.id`, `payload.model_provider`, and `payload.cli_version` when present.

If envelope extraction does not apply, fallback extraction checks:

- the root object itself;
- nested `message`;
- nested `item`;
- nested `delta`;
- each object inside root `output` when `output` is an array.

Role-based interpretation:

- `role = "user"`: classify text as `CONTEXT`, `TASK`, or `YOU`.
- `role = "assistant"` or `"model"`: `CODEX`.
- `role = "tool"`: `TOOL_RESULT`.
- `role = "system"`: `SYSTEM`.
- other roles, including `developer`, are ignored.

Typed fallback interpretation:

- Type containing `user`: classify text as `CONTEXT`, `TASK`, or `YOU`.
- Type containing `assistant`, `model`, or `agent`: `CODEX`.
- Type containing `system` or `session`: `SYSTEM`.
- Type containing `tool_call`, `function_call`, or command-like values that are not end/output: `TOOL_CALL`.
- Type containing `tool_result`, `function_result`, `command_result`, `output`, or `end`: `TOOL_RESULT`.

Text extraction checks direct fields `content`, `text`, `message`, `output`, `result`, and `summary`. Values may be strings, arrays of strings/objects, or objects with nested `text.value`, `value`, `content`, or `message`.

## 5. How Malformed Lines Are Handled

- A malformed line is any non-empty trimmed line that cannot be parsed by Jackson as JSON.
- The parser increments `malformedLines`.
- It does not throw to the caller.
- It continues parsing subsequent lines.
- Malformed lines do not increment `ignoredLines` or `observedEventCounts`.

## 6. How Ignored Lines Are Counted

- A line is ignored when it is valid JSON but extraction returns no candidates.
- `ignoredLines` increments once per valid JSON line with zero candidates.
- Empty lines do not count as ignored.
- Examples:
  - unknown event envelope types;
  - known envelope types without usable payload content;
  - `response_item/message` with `role = "developer"`;
  - objects without recognized role/type/text fields.

## 7. How Duplicate Suppression Works

Deduplication happens after all candidates are extracted.

Stable-key pass:

- A candidate stable key is built as `<RenderedEntryKind.name>:<stableId>` when a stable id exists.
- Stable ids come from fields such as message `id`, tool `call_id`, session id, or turn id depending on source.
- For each stable key, the first candidate establishes order.
- Later candidates with the same stable key may replace the selection.
- Replacement chooses higher `CandidateSource` priority.
- At equal priority, replacement chooses longer rendered content.
- Candidates without stable keys remain pending.

Combined order:

- Pending candidates and selected stable-key candidates are combined.
- The combined list is sorted by the candidate's original index in the full candidate list.

Adjacent duplicate pass:

- Only adjacent candidates can be suppressed in this pass.
- Kinds must match.
- Normalized text must match.
- Normalization lowercases, normalizes CRLF to LF, collapses whitespace to single spaces, and trims.
- If both stable keys exist, they must be equal.
- If both timestamps exist and match, duplicates are suppressed.
- Known duplicate source pairs are suppressed:
  - `EVENT_USER_MESSAGE` with `RESPONSE_MESSAGE`
  - `EVENT_AGENT_MESSAGE` with `RESPONSE_MESSAGE`
  - `EVENT_TOOL_RESULT` with `RESPONSE_TOOL_RESULT`
- When suppressing, the retained candidate may be replaced using the same priority/longer-content rule.

Important behavior to preserve:

- Identical messages with different stable ids are not collapsed.
- Duplicate messages across event and response shapes are collapsed when source-pair/timestamp rules match.
- Tool result duplicates with the same call id collapse, preferring higher-priority or longer content as applicable.

## 8. How Observed Event Counts Work

For each successfully parsed JSON line, before extraction:

- Read top-level `type`.
- Read `payload.type`.
- Build the observed key:
  - `<topType>/<payloadType>` when both exist;
  - `<payloadType>` when only payload type exists;
  - `<topType>` when only top-level type exists;
  - `unknown` when neither exists.
- Increment the linked count map for that key.

The linked map preserves first-observed insertion order internally. `ChatRenderer` displays observed event counts only when there are no visible entries, sorted by descending count and limited to the top eight.

## 9. Kotlin Tests To Port To Rust

Port the parser-focused tests from `JsonlChatParserTest.kt` first:

- `agentsInjectedInstructionsAreClassifiedAsContext`
- `structuredTaskBodyIsClassifiedAsTask`
- `eventMsgUserMessageIsRenderedAsYou`
- `eventMsgUserMessageCharacterizationCoversYouTaskAndContextClassification`
- `duplicateUserMessageAcrossEventShapesIsRenderedOnce`
- `identicalUserMessagesWithDifferentIdsAreNotCollapsed`
- `longNormalHumanPromptStillRendersAsYou`
- `responseItemAssistantMessageIsRenderedAsCodex`
- `eventMsgAgentMessageIsClassifiedAsCodex`
- `responseItemMessageExtractsRoleBasedEntries`
- `utf8KoreanUserMessageRendersCorrectly`
- `utf8CodexMessageRendersCorrectly`
- `responseItemFunctionCallIsRenderedAsToolCall`
- `execCommandEndIsRenderedAsToolResult`
- `functionCallOutputIsRenderedAsToolResult`
- `customToolCallAndOutputAreRenderedAsToolEntries`
- `sessionMetaIsExtractedAsSystemEntry`
- `duplicateCodexMessageAcrossEventShapesIsRenderedOnce`
- `duplicateToolResultsWithSameCallIdAreRenderedOnce`
- `duplicateEntriesWithSameStableIdPreferLongerContentAtSamePriority`
- `malformedJsonlCountsEachMalformedLine`
- `identicalCodexMessagesWithDifferentIdsAreNotCollapsed`
- `developerMessagesRemainIgnored`
- `malformedJsonLinesDoNotCrashParsing`
- `emptyFilesReturnSafeResult`
- `userAndCodexBlocksRemainSeparateForRealisticEnvelopeShapes`

Port parser-adjacent model tests next:

- `TranscriptBlockTest.transcriptBlocksPreserveEntryTypeLabelAndContent`
- `ChatEntryFilterTest.parsedEntriesCanBeFilteredWithoutReparsing`
- `ChatEntryFilterTest.turningOffYouHidesYouEntries`
- `ChatEntryFilterTest.turningOffCodexHidesCodexEntries`
- `ChatEntryFilterTest.turningOffToolCallHidesToolCallEntries`
- `ChatEntryFilterTest.turningOffToolResultHidesToolResultEntries`
- `ChatEntryFilterTest.turningOffMetaHidesSystemAndContextEntries`

Defer export/UI renderer tests until Rust export and API/display contracts exist:

- `MarkdownTranscriptExporterTest.*`
- Swing renderer, search, scroll, and theme tests.

Note: the current Kotlin UTF-8 assertions verify parser output through `ChatRenderer.render(...)`, so they include the renderer path rather than testing `RenderedEntry.content` directly. Rust parser tests should assert preserved Unicode strings directly in `RenderedEntry.content`; any mojibake compatibility should be handled only if a frontend/export compatibility requirement explicitly asks for it.

## 10. Proposed Rust Structs/Enums

```rust
pub struct ParsedChatLog {
    pub entries: Vec<RenderedEntry>,
    pub parsed_candidates: usize,
    pub ignored_lines: usize,
    pub malformed_lines: usize,
    pub observed_event_counts: indexmap::IndexMap<String, usize>,
}

pub struct RenderedEntry {
    pub kind: RenderedEntryKind,
    pub content: String,
}

pub enum RenderedEntryKind {
    Context,
    Task,
    You,
    Codex,
    ToolCall,
    ToolResult,
    System,
}

pub struct TranscriptBlock {
    pub entry_type: RenderedEntryKind,
    pub label: &'static str,
    pub title: &'static str,
    pub content: String,
}

pub struct ChatEntryFilter {
    pub show_you: bool,
    pub show_codex: bool,
    pub show_tool_call: bool,
    pub show_tool_result: bool,
    pub show_meta: bool,
}
```

Parser-internal structs:

```rust
struct ParsedCandidate {
    entry: RenderedEntry,
    stable_key: Option<String>,
    normalized_text: String,
    source: CandidateSource,
    timestamp: Option<String>,
    original_index: usize,
}

enum CandidateSource {
    ResponseMessage,
    ResponseToolResult,
    EventToolResult,
    ResponseToolCall,
    EventUserMessage,
    EventAgentMessage,
    EventSystem,
    Fallback,
}
```

Expected helpers:

- `RenderedEntryKind::label(&self) -> &'static str`
- `ParsedChatLog::filtered(&self, filter: &ChatEntryFilter) -> ParsedChatLog`
- `ParsedChatLog::transcript_blocks(&self) -> Vec<TranscriptBlock>`
- `CandidateSource::priority(&self) -> u8`

Use `serde_json::Value` for untrusted JSON signals unless a later milestone introduces typed envelopes. Preserve the rule that signal content is data, not authority.

Dependency note:

- Parser implementation will likely require `serde`, `serde_json`, and `indexmap`.
- Test support should prefer inline fixtures first before adding fixture-related crates.

## 11. Proposed Rust Module Structure Under `backend/src`

```text
backend/src/
  main.rs
  domain/
    mod.rs
    chat_log.rs
    rendered_entry.rs
    transcript_block.rs
    filter.rs
  parser/
    mod.rs
    jsonl.rs
    extract.rs
    classify.rs
    tool.rs
    dedupe.rs
    observed.rs
    text.rs
  api/
    mod.rs
  export/
    mod.rs
```

Initial parser responsibilities:

- `parser/jsonl.rs`: file/reader entry points, line iteration, counters, top-level parse loop.
- `parser/extract.rs`: envelope and fallback extraction orchestration.
- `parser/classify.rs`: `AGENTS.md` context and task-body classification.
- `parser/tool.rs`: tool call/result summary builders and truncation limits.
- `parser/dedupe.rs`: candidate source priorities, stable-key pass, adjacent duplicate suppression.
- `parser/observed.rs`: observed event key construction and counting.
- `parser/text.rs`: JSON text extraction from strings, arrays, and nested objects.

Domain responsibilities:

- `domain/chat_log.rs`: `ParsedChatLog` and filtering.
- `domain/rendered_entry.rs`: `RenderedEntry` and `RenderedEntryKind`.
- `domain/transcript_block.rs`: `TranscriptBlock` conversion.
- `domain/filter.rs`: `ChatEntryFilter`.

## 12. First Implementation Milestone

Milestone: parser parity core without UI/API integration.

Scope:

- Add the domain types needed by the parser.
- Add a parser function that accepts a `Read` source and a file-path wrapper for local files.
- Preserve Kotlin counters:
  - parsed candidates before dedupe;
  - ignored valid JSON lines;
  - malformed non-empty JSONL lines;
  - observed event counts for valid JSON lines.
- Implement envelope extraction for:
  - `event_msg/user_message`
  - `event_msg/agent_message`
  - `event_msg/exec_command_end`
  - `event_msg/patch_apply_end`
  - `event_msg/task_started`
  - `event_msg/task_complete`
  - `response_item/message`
  - `response_item/function_call`
  - `response_item/custom_tool_call`
  - `response_item/function_call_output`
  - `response_item/custom_tool_call_output`
  - `session_meta`
- Implement fallback extraction from root, `message`, `item`, `delta`, and array `output`.
- Implement duplicate suppression.
- Add Rust unit tests ported from the Kotlin parser tests listed above.

Out of scope for the first milestone:

- API endpoint design.
- Frontend rendering.
- Markdown export.
- Real private logs or committed sample data.
- Dependency/build/release changes beyond parser dependencies explicitly declared in the implementation task.

Related documentation-only checklist:

- `docs/source-app-parity-checklist.md` records broader Kotlin/Swing source-app parity requirements for the Rust/Svelte port. It includes export and Copy Resume Command behavior, but is intentionally not part of the parser parity implementation milestone.

## 13. Verification Plan

Documentation-only verification for this plan:

- Confirm `docs/parser-port-plan.md` exists.
- Confirm it includes the required thirteen sections.
- Confirm `docs/source-app-parity-checklist.md` exists when source-app parity planning is needed.
- Confirm no source files were changed.

Future implementation verification:

- Run Rust formatting, for example `cargo fmt`.
- Run Rust unit tests, for example `cargo test`.
- Add parser fixtures inline in tests or under a sanitized test fixture directory only.
- Assert exact `ParsedChatLog` values for extraction, counters, observed event counts, and dedupe behavior.
- Assert malformed lines are counted and do not abort parsing.
- Assert ignored valid JSON lines are counted once per valid unrenderable line.
- Assert duplicate suppression preserves separate messages with different stable ids.
- Assert Unicode parser output remains valid Rust `String` content.
- When API integration begins, add endpoint-level tests that verify serialized field names and counts match the frontend contract.
