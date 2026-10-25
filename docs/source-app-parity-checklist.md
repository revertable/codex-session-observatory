# Source App Parity Checklist

> **Status: historical reference.** This checklist preserves observations made while evaluating the original Kotlin/Swing application for the Rust/Svelte port. Its `required parity`, `planned ...`, and `possible new enhancement` labels describe that migration stage. Current behavior is defined by the present repository implementation and current boundary/architecture documents.

The product has intentionally diverged from the original app in several areas, including the Tauri in-process command boundary, `DM Style (Dark)`, filtered transcript capture, full-session versionable Worklog bundles, specialized Guardian session routing and parent navigation, and the distinction between human-authored requests and injected transport/context. Use the detailed checklist below for provenance and comparison, and the current implementation for accepted product behavior.

This checklist recorded source-app behavior from the original Kotlin/Swing `codex-chat-viewer` app so the Rust/Svelte port could evaluate intentional parity while separating backend/API, frontend, rendering/export, and parser/domain work.

The original app is read-only reference material.

Reference source files observed:

- `app/src/main/kotlin/app/codexchatviewer/App.kt`
- `app/src/main/kotlin/app/codexchatviewer/JsonlChatParser.kt`
- `app/src/main/kotlin/app/codexchatviewer/TranscriptBlock.kt`
- `app/src/main/kotlin/app/codexchatviewer/ChatRenderer.kt`
- `app/src/main/kotlin/app/codexchatviewer/ChatStyledRenderer.kt`
- `app/src/main/kotlin/app/codexchatviewer/ChatRenderTheme.kt`
- `app/src/main/kotlin/app/codexchatviewer/TranscriptRenderController.kt`
- `app/src/main/kotlin/app/codexchatviewer/MarkdownDocumentRenderer.kt`
- `app/src/main/kotlin/app/codexchatviewer/MessengerChatRenderer.kt`
- `app/src/main/kotlin/app/codexchatviewer/TranscriptSearchController.kt`
- `app/src/main/kotlin/app/codexchatviewer/TranscriptScrollController.kt`
- `app/src/main/kotlin/app/codexchatviewer/SearchPanel.kt`
- `app/src/main/kotlin/app/codexchatviewer/MarkdownExportController.kt`
- `app/src/main/kotlin/app/codexchatviewer/MarkdownTranscriptExporter.kt`

Reference tests observed:

- `AppTest.kt`
- `JsonlChatParserTest.kt`
- `TranscriptBlockTest.kt`
- `ChatEntryFilterTest.kt`
- `ChatRenderThemeTest.kt`
- `ChatStyledRendererTest.kt`
- `MarkdownDocumentRendererTest.kt`
- `MessengerChatRendererTest.kt`
- `TranscriptRenderControllerTest.kt`
- `TranscriptSearchControllerTest.kt`
- `SearchMatchTest.kt`
- `TranscriptScrollControllerTest.kt`
- `MarkdownExportControllerTest.kt`
- `MarkdownTranscriptExporterTest.kt`

## Historical Classification Legend

- `required parity`: behavior was marked for preservation unless a later product decision rejected it.
- `already covered by current parser/domain work`: behavior was represented in parser/domain planning or implementation at the time.
- `planned backend/API work`: behavior was assigned to a later backend/API milestone.
- `planned frontend work`: behavior was assigned primarily to a later Svelte Control Room milestone.
- `planned export/rendering work`: behavior was assigned to later transcript rendering, theme rendering, or Markdown export/report work.
- `possible new enhancement`: behavior was not found in the original app and was not treated as parity at the time.

## 1. App Startup and Main Workflow

- `required parity`: app starts into a ready state before any file is loaded.
- `planned frontend work`: initial transcript area displays `Codex Chat Viewer`, `Ready.`, and `Default theme: <theme-name>`.
- `planned frontend work`: main controls include theme selection, `Open JSONL`, `Export Markdown`, filter toggles, and search panel.
- `required parity`: selecting a file updates current selected file, current session id, current parsed log, clears collapsed blocks, resets search, updates metadata, and renders the current transcript.
- `planned backend/API work`: Rust backend should provide the load/parse operation consumed by the frontend workflow.
- `planned frontend work`: Svelte frontend should preserve the workflow ordering: open/select path, load/parse, update metadata, reset transient UI state, render.

## 2. File Open and Load Behavior

- `required parity`: file open action is scoped to Codex JSONL files while still allowing all files in the chooser.
- `planned frontend work`: original dialog title is `Open Codex JSONL File`.
- `planned frontend work`: original file filter label is `JSONL files (*.jsonl)`.
- `required parity`: cancelling file open leaves the current state unchanged.
- `required parity`: when a file is approved, the app remembers its parent as the last selected directory.
- `required parity`: initial directory preference is last selected directory, then `$CODEX_HOME/sessions`, then `~/.codex/sessions`, then user home, then current directory.
- `planned backend/API work`: backend should safely accept an explicitly selected local JSONL path and return parse results.
- `planned frontend work`: frontend should preserve user-visible file-open state and cancellation behavior.

## 3. Loaded File Metadata

- `required parity`: metadata panel tracks selected file name, absolute path, detected session id, and resume command.
- `planned frontend work`: no-selection state shows `Selected File: None`, `Path: Not selected`, `Session ID: Not detected`, and `Resume Command: Not available`.
- `planned frontend work`: loaded state shows selected file name, absolute path, detected session id or `Not detected`, and resume command or `Not available`.
- `planned frontend work`: long metadata values are truncated for labels and preserved in tooltips.
- `planned backend/API work`: backend/API response should include enough source metadata for the frontend to render file name, path, session id, counters, and entries.

## 4. Parser and Display Handoff

- `already covered by current parser/domain work`: `ParsedChatLog` contains entries, parsed candidate count, ignored line count, malformed line count, and observed event counts.
- `already covered by current parser/domain work`: `ParsedChatLog.filtered(...)` filters entries without reparsing and preserves counters.
- `already covered by current parser/domain work`: `ParsedChatLog.transcriptBlocks()` maps entries into transcript blocks with type, label, title, and content.
- `required parity`: display receives the filtered log for the current filter state.
- `planned backend/API work`: API should preserve stable serialized field names and counts for frontend display.
- `planned frontend work`: frontend should rerender from the current filtered observations without triggering a reparse for simple filter changes.

## 5. Rendered Entry Kinds and Labels

- `already covered by current parser/domain work`: rendered entry kinds are `CONTEXT`, `TASK`, `YOU`, `CODEX`, `TOOL_CALL`, `TOOL_RESULT`, and `SYSTEM`.
- `already covered by current parser/domain work`: labels are `[CONTEXT]`, `[TASK]`, `[YOU]`, `[CODEX]`, `[TOOL CALL]`, `[TOOL RESULT]`, and `[SYSTEM]`.
- `required parity`: transcript blocks preserve entry type, label, title, and content.
- `planned export/rendering work`: all renderers and exporters should use the same labels as the source app.

## 6. User, Codex, System, Context, Tool, and Result Rendering

- `required parity`: user messages render as `[YOU]`.
- `required parity`: assistant/model messages render as `[CODEX]`.
- `required parity`: injected `AGENTS.md` project instructions render as `[CONTEXT]` with summary content.
- `required parity`: injected task/prompt instructions render as `[TASK]` with summary content.
- `required parity`: tool calls render as `[TOOL CALL]`.
- `required parity`: tool outputs, command results, function outputs, custom tool outputs, and patch results render as `[TOOL RESULT]`.
- `required parity`: session metadata and lifecycle metadata render as `[SYSTEM]`.
- `already covered by current parser/domain work`: parser classification and extraction behavior is documented in `docs/parser-port-plan.md`.
- `planned export/rendering work`: visual renderers should preserve the user-visible block labels and content separation.

## 7. Terminal/Text Transcript Rendering

- `required parity`: terminal/text rendering includes title, blank line, file, path, session id, separator, transcript or empty-state message, separator, and counters.
- `required parity`: empty logs show `No renderable chat messages found in this JSONL file.`
- `required parity`: when empty logs have observed event counts, render `Observed event types:` sorted by descending count and limited to eight.
- `required parity`: counters shown are parsed candidates, visible entries, ignored lines, and malformed lines.
- `required parity`: blocks are expanded by default and can collapse to header only.
- `planned export/rendering work`: text renderer should preserve collapsible header ranges or equivalent frontend state.
- `planned frontend work`: clicking a terminal/text block header toggles collapse.

## 8. Theme and Visual Styling

- `required parity`: available themes are exactly `Terminal Style`, `Markdown Style`, `DM Style`, and `Messenger Style` unless later design work intentionally changes this.
- `required parity`: `Talk Style` is not part of the current source-app theme list.
- `required parity`: each theme provides styles for every rendered entry kind.
- `planned frontend work`: theme selector should expose the parity theme families.
- `planned export/rendering work`: terminal-style rendering uses monospaced text and bracket collapse markers `[v]` and `[>]`.
- `planned export/rendering work`: Markdown, DM, and Messenger styles use `v` and `>` collapse markers.
- `planned export/rendering work`: DM and Messenger align `[YOU]` right, `[CODEX]` left, and meta/tool/system/context/task blocks centered.
- `planned export/rendering work`: Markdown style renders document-like sections with left-aligned blocks.

## 9. Markdown Component Rendering

- `required parity`: Markdown Style uses the component renderer path, not the terminal text renderer path.
- `planned export/rendering work`: component renderer should build a document column with title, notice sections, block sections, wrapping text areas, and final counter notice.
- `planned export/rendering work`: Markdown block sections use header text, accent borders, background panels, and type-specific fonts.
- `required parity`: technical blocks (`TOOL_CALL`, `TOOL_RESULT`) use code-style wrapping behavior.
- `required parity`: meta blocks (`SYSTEM`, `CONTEXT`, `TASK`) use meta-style text.
- `required parity`: collapsed Markdown blocks keep block/header ranges but omit content text ranges.
- `planned frontend work`: clicking Markdown headers toggles collapse.
- `planned export/rendering work`: layout width responds to viewport width with minimum and maximum document widths.

## 10. Messenger and DM Chat-Style Rendering

- `required parity`: DM Style and Messenger Style use the chat component renderer path.
- `planned export/rendering work`: chat-style rendering uses bubbles/cards with right-aligned user blocks, left-aligned Codex blocks, and centered meta/tool/system/context/task blocks.
- `required parity`: chat-style renderer maintains transcript text and component block ranges for search.
- `planned export/rendering work`: message, meta, and tool block widths respond to viewport width and shrink for narrow viewports.
- `required parity`: collapsed chat blocks keep block/header ranges but omit content text ranges.
- `planned frontend work`: clicking chat headers toggles collapse.

## 11. Transcript Render Controller and Scroll Behavior

- `required parity`: render path follows theme family:
  - Terminal Style -> text mode.
  - Markdown Style -> Markdown component mode.
  - DM Style and Messenger Style -> chat component mode.
- `planned frontend work`: switching themes preserves viewport position when possible.
- `planned frontend work`: component renderer rerenders on meaningful viewport width changes.
- `planned frontend work`: toggling collapse preserves the viewport anchor where possible.
- `planned frontend work`: search navigation scrolls text offsets, component text offsets, or component blocks into view.
- `required parity`: scroll-to-top resets the vertical scroll bar after render when the render should reset position.

## 12. Filtering Behavior and Filter UI

- `already covered by current parser/domain work`: filtering without reparsing preserves parser counters.
- `required parity`: filter toggles are `YOU`, `CODEX`, `TOOL CALL`, `TOOL RESULT`, and `META`.
- `required parity`: turning off `YOU` hides only user entries.
- `required parity`: turning off `CODEX` hides only assistant entries.
- `required parity`: turning off `TOOL CALL` hides tool call entries.
- `required parity`: turning off `TOOL RESULT` hides tool result entries.
- `required parity`: turning off `META` hides `SYSTEM`, `CONTEXT`, and `TASK` entries.
- `planned frontend work`: filter toggles should be icon-style controls with tooltips.
- `planned frontend work`: changing filters clears collapsed block state and rerenders.
- `planned export/rendering work`: export uses the currently filtered transcript, not the unfiltered backing log.

## 13. Search Behavior

- `required parity`: `Ctrl+F` toggles the search panel.
- `planned frontend work`: search panel includes a find field, previous and next icon buttons, and match count display.
- `required parity`: Enter moves to next match and Shift+Enter moves to previous match.
- `required parity`: Escape closes search and clears the query.
- `required parity`: blank queries produce no matches and no match count.
- `required parity`: search is case-insensitive and non-overlapping.
- `required parity`: search preserves original string offsets, including Unicode/Korean text cases covered by tests.
- `required parity`: next and previous navigation wraps around matches.
- `required parity`: refreshing matches can preserve current index when possible, or reset to the first match.
- `planned frontend work`: match count displays empty, `0 / 0`, or one-based current match over total matches.
- `planned frontend work`: text mode highlights all matches and uses a distinct current-match highlight.
- `planned frontend work`: component mode maps transcript offsets into component text ranges; when mapping fails, it applies a fallback highlight around the component block.

## 14. Counters and Statistics Display

- `already covered by current parser/domain work`: parsed candidate, ignored line, malformed line, and observed event count fields are part of the domain model.
- `required parity`: rendered transcript footer displays parsed candidates, visible entries, ignored lines, and malformed lines.
- `required parity`: visible entries count reflects the currently filtered transcript.
- `required parity`: observed event counts are displayed only in the no-renderable-entry state, sorted by count descending and limited to eight.
- `planned backend/API work`: API responses should include counters even when entries are filtered or empty.
- `planned frontend work`: frontend should render counters consistently across supported display modes.

## 15. Session ID Detection

- `required parity`: session id detection scans the selected source file name without extension, then each parent directory name upward.
- `required parity`: the first UUID-shaped value is used.
- `required parity`: UUID pattern is:

```text
\b[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}\b
```

- `planned backend/API work`: backend may perform this detection from the selected path, or expose enough path context for frontend detection.
- `planned frontend work`: metadata and copy affordances should update from the detected session id.

## 16. Copy Resume Command and Clipboard Behavior

- `required parity`: when a session id is detected, resume command is `codex resume <session-id>`.
- `planned frontend work`: metadata shows `Resume Command: codex resume <session-id>` when available.
- `planned frontend work`: `Copy Resume Command` is enabled only when the resume command is available.
- `planned frontend work`: clicking `Copy Resume Command` copies the command string to the system clipboard.
- `planned frontend work`: when no session id is detected, metadata shows `Resume Command: Not available`, the copy button is disabled, and its tooltip/state is cleared.
- `required parity`: original app clipboard behavior found during review is limited to Copy Resume Command.
- `possible new enhancement`: copying the full transcript, filtered transcript, visible transcript, or selected rendered blocks was not found in the original app and must be planned separately if desired.

## 17. Markdown Export

- `required parity`: `Export Markdown` is available from the main header next to `Open JSONL`.
- `planned frontend work`: when no transcript is loaded, export does not open a save flow and appends `No transcript loaded to export.`
- `required parity`: export request uses selected source file, current session id, currently filtered chat log, and last selected directory hint.
- `planned export/rendering work`: exporter serializes the provided `ParsedChatLog` as-is.
- `required parity`: collapsed UI state does not affect export; exported Markdown contains full content and no collapse markers.
- `required parity`: exported Markdown is UTF-8.
- `planned export/rendering work`: Markdown output starts with `# Codex Chat Viewer Export`.
- `planned export/rendering work`: metadata includes source file name, absolute source path, and optional non-blank session id.
- `planned export/rendering work`: `Source file:` and `Path:` metadata lines include two trailing spaces in the source app output.
- `planned export/rendering work`: transcript is fenced as `text`.
- `planned export/rendering work`: transcript body is built from transcript blocks as label plus trimmed content, with blank lines between blocks and combined transcript trimmed before fencing.
- `planned export/rendering work`: fence selection uses at least three backticks and one more than the longest backtick run in transcript content.

Markdown shape:

````text
# Codex Chat Viewer Export

Source file: <source-jsonl-file-name>  
Path: <absolute-source-path>  
Session ID: <session-id>

```text
<transcript>
```
````

## 18. Export Filename, Overwrite, and Outcomes

- `required parity`: default export filename is `<source-name-without-extension>.md`.
- `required parity`: if the default suggested file exists, suggest `<source-name-without-extension> (1).md`, then increment until unused.
- `required parity`: selected target paths without a case-insensitive `.md` ending get `.md` appended.
- `required parity`: existing `.md` and `.MD` endings are preserved.
- `required parity`: initial export directory is source file parent, request initial directory, then fallback directory.
- `required parity`: existing target files require overwrite confirmation.
- `planned frontend work`: overwrite confirmation title is `Overwrite Markdown Export`.
- `planned frontend work`: overwrite confirmation message is `<file-name> already exists.\nDo you want to overwrite it?`
- `required parity`: declining overwrite cancels export and writes nothing.
- `required parity`: export outcomes are `Cancelled`, `Success(file, noticeMessage)`, and `Failure(noticeMessage)`.
- `required parity`: cancellation occurs when save dialog is not approved, selected file is missing, or overwrite is declined.
- `required parity`: success writes UTF-8 Markdown, creates parent directories when needed, asks Explorer to select the exported file on Windows, and does not fail if Explorer cannot open.
- `required parity`: success notice is `Markdown exported to <absolute-target-path>`.
- `required parity`: failures from generation or writing produce `Markdown export failed: <exception-message-or-class-name>`.
- `planned frontend work`: success and failure notices are appended to the viewer; cancelled export returns without notice.

## 19. Status, Error, and Cancel Behavior

- `required parity`: ready state is visible before any file is loaded.
- `required parity`: file-open cancellation makes no state change.
- `required parity`: export cancellation emits no success/failure notice.
- `required parity`: no-loaded-transcript export emits `No transcript loaded to export.`
- `required parity`: parser handles malformed JSON lines without aborting and reports malformed line count.
- `required parity`: empty files return a safe result.
- `planned frontend work`: status notices should be appended as system/notice content in the current render mode.
- `planned backend/API work`: API errors should be represented in a way the frontend can display without corrupting existing transcript state.

## 20. Test Coverage To Preserve or Port

- `already covered by current parser/domain work`: port parser tests from `JsonlChatParserTest.kt`.
- `already covered by current parser/domain work`: port transcript block and filter tests from `TranscriptBlockTest.kt` and `ChatEntryFilterTest.kt`.
- `planned export/rendering work`: port or recreate theme coverage from `ChatRenderThemeTest.kt`.
- `planned export/rendering work`: port terminal/text renderer coverage from `ChatStyledRendererTest.kt`.
- `planned export/rendering work`: port Markdown component renderer coverage from `MarkdownDocumentRendererTest.kt`.
- `planned export/rendering work`: port Messenger/DM renderer coverage from `MessengerChatRendererTest.kt`.
- `planned export/rendering work`: port render-path selection coverage from `TranscriptRenderControllerTest.kt`.
- `planned frontend work`: port search behavior coverage from `TranscriptSearchControllerTest.kt` and `SearchMatchTest.kt`.
- `planned frontend work`: port scroll/anchor behavior coverage from `TranscriptScrollControllerTest.kt` where applicable to the web UI.
- `planned export/rendering work`: port Markdown export coverage from `MarkdownTranscriptExporterTest.kt` and `MarkdownExportControllerTest.kt`.
- `planned frontend work`: keep an app-level smoke test equivalent to `AppTest.kt`.

## 21. Explicit Non-Parity Enhancements

- `possible new enhancement`: full-session transcript copy.
- `possible new enhancement`: currently visible transcript copy.
- `possible new enhancement`: selected block copy.
- `possible new enhancement`: exporting unfiltered transcript while filters are active.
- `possible new enhancement`: new theme families beyond the four source-app themes.
- `possible new enhancement`: changing theme names or dropping source-app themes.

These should not be implemented or documented as parity unless a later task explicitly accepts them as new product behavior.
