# Observatory Frontend

This directory contains the Svelte workspace and its Tauri desktop bridge. Rust owns JSONL decoding, session inspection and classification, Navigator snapshots, parent-session lookup, and Worklog generation. The desktop bridge calls the backend in-process.

## Search

The shared SEARCH row keeps one draft input across Session and Transcript, with a separate last-applied condition and result for each scope. Editing or clearing the draft, or switching scope, preserves applied results and highlights. Only Enter or the magnifying-glass button applies the draft to the selected scope. Searches use literal, case-insensitive substrings, with surrounding query whitespace ignored. Ctrl+F focuses and selects the draft without changing its scope or opening WebView2's Find UI.

Session search scans every entry in the current complete Navigator snapshot, including entries beyond the first page. It reads plain and Zstandard-compressed sources through the existing source validation and parser, and matches only actual `You` entries. The discovery boundary remains `CODEX_HOME/sessions`; archives, Guardian reviews and linked sources retain their existing exclusions. Results retain Flat/Hierarchical ordering, paging and selection. Submitting an empty Session draft restores the unfiltered snapshot; Reload discovers current files and reapplies the last submitted query. Toasts report progress, completion and unreadable files. Generation checks reject superseded searches and reloads. Search does not write source logs or maintain a persistent index.

Transcript search runs on the rendered message bodies that pass the active filters. Collapsed bodies are excluded until expanded. It searches rendered Markdown text, including matches spanning inline formatting, and preserves line and paragraph boundaries. CSS Highlights and DOM Ranges preserve message nodes, link handlers, clipboard text and Collection snapshots. Repeating the applied query advances and wraps; the row reports the current/total position. Filter, collapse, Refresh, theme and session changes rebuild results using the last submitted condition, independently of the draft. Submitting an empty Transcript draft removes its highlights and position. Search does not change filters or Collection.

`lib/search/` owns scope/query state, literal matching and Transcript range navigation. Rust's `session/search.rs` owns parser-grounded Session matching; Navigator keeps the original snapshot separate from its search view. The Tauri `search_sessions` command transports result pages and a progress channel.

## Session Navigator and loading

`lib/session-navigator/` implements Flat and Hierarchical views of one backend snapshot. The backend discovers ordinary and ChatGPT Handoff sessions under `CODEX_HOME/sessions`, defaulting to the user's `.codex/sessions`. It excludes archives, Guardian reviews, and linked sources. Title metadata and actual conversation activity are collected by the backend; missing-title sources become Untitled Session without invented prompt titles.

Flat uses snapshot-bound cursors and pages of 20 in original creation-time order. Hierarchical follows date folders and includes unfiled items. Reload replaces the snapshot and invalidates old cursors and action targets. The frontend coordinates generations, duplicate-request protection, loading/error feedback, and retry. Activity affects title weight only.

The Flat/Hierarchical choice is saved in WebView local storage under `observatory.navigator-mode.v1` and restored on startup. Missing or invalid values default to Flat. Storage failures appear in Status while view switching remains available. Restoring Hierarchical loads its tree from the new Navigator snapshot.

`App.svelte` reuses one load workflow for Navigator selection and parent-session navigation. A source load requests all observation kinds once; filters project retained blocks without reparsing. Plain and zstd-compressed JSONL share the transport contract. Context-menu Open uses the same selection flow; folder/Export commands revalidate snapshot identity and paths without replacing the selected transcript.

## Transcript rendering and state

The full block array and filtered view share block references. An identity map derived from source path, role, timestamp, content, and duplicate occurrence is reused while the original array and path are unchanged. All three renderers use these keys. Refresh receives new DTOs and recomputes identities while equal content retains its DOM attachment.

Refresh pending and failure retain the last successful observations. `TranscriptViewer.svelte` selects Terminal, Markdown, or Chat rendering; the two DM themes share Chat. Collapse state belongs to App and resets when source, filters, or theme changes. Capture serializes filtered blocks, references, theme, and collapse state directly from data, without scraping DOM.

User/Codex bodies share the Markdown AST and safe static DOM constructor. Semantics include paragraphs, emphasis, lists, links, inline/fenced code, and tables. Tool calls/results and metadata remain plain text. Raw HTML and images are disabled; external links use validated absolute HTTP/HTTPS destinations through Tauri's opener. Text tokens use Text nodes without redundant span wrappers. Semantic parents and table cells preserve whitespace. Transcript virtualization and `content-visibility` skipping are not enabled.

## Workspace and common feedback

`AppLayout.svelte` and common CSS own the Sessions / Transcript / Collection Grid, shared available height, independent panel scrolling, side-panel toggles, and constrained resize tracks. Each panel's Top/Bottom controls target its own viewport. `panel-scroll.ts` handles panel scroll animation, reduced motion, and cancellation. Theme styles own colors and visual presentation within this shared layout.

`SessionHeader.svelte` presents load state, source information, resume copying, appearance, filters, and panel actions. Loaded/Idle is a badge; Reset is separate. The common status controller coordinates user-facing action results and errors without duplicating feedback in each panel.

`system_fonts.rs` uses Windows DirectWrite to enumerate installed families. Text and Code choices map independently to CSS variables; empty values mean Default. Settings use WebView local storage key `observatory.fonts.v1`; unavailable saved families revert to Default. Character fallback is system-dependent. The selected Code family stays in use even when it is proportional. Fonts come from the local Windows installation.

## Collection and output boundaries

`lib/collection/` owns selection, read-only presentation, and clipboard serialization. Items retain snapshots and original unfiltered indexes. Source order is independent of click order and timestamps; duplicate occurrences have independent identities. Refresh, filters, and themes preserve snapshots and panel state. A different source or Reset clears Collection and closes it. Copy All keeps selections; Clear leaves the panel open. Collection is not persisted across restarts.

Collection shows parsed message text. General prose follows Text; code and log segments follow Code. Markdown fences, line breaks, and indentation remain in their original text form.

Collection serializes selected snapshots, Capture serializes the transcript presentation, and Worklog reads the complete source in Rust. Filters and Collection are not passed to the exporter. Existing manifest compatibility, staging, and overwrite safeguards remain in the backend.

Desktop parse/Export commands schedule blocking work away from the native message thread. Shared file-operation serialization is acquired before worker scheduling and held until completion. This protects native responsiveness and limits concurrent file work. IPC delivery and rendering remain separate stages. See [Performance History](../docs/performance-history.md) for measurements and rejected approaches.

## Update availability

On startup App reads the packaged version and makes one unauthenticated GitHub latest-release request. Initial guidance can show current, update-available, or development status. Network failures and unknown responses stay silent. Only the official Releases URL is opened; session content, paths, and IDs are not sent. Updates are not downloaded or installed.

## Development and verification

Install Node.js/npm, Rust stable, and Windows Tauri prerequisites (MSVC build tools, Windows SDK, and WebView2). From `frontend/`:

```text
npm ci
npm run tauri:dev
```

The command adapter is in `src-tauri/`; parsing and session business rules remain in the backend crate. Follow the [test matrix](../docs/test-matrix.md) for Node-only tests, client DOM tests, static checks, Rust tests, and the full repository `verify.ps1` sequence. Browser integration uses an installed browser and isolated profiles. Verify native clipboard, dialog, and desktop behavior in the packaged EXE.

## Windows builds and version metadata

`build-and-run.bat` builds the release EXE, packages the portable ZIP, and launches it. This is separate from verification. The EXE is `frontend/src-tauri/target/release/codex-session-observatory.exe`. Packaging reads the Tauri version for `release/Codex-Session-Observatory_<version>_windows-x64-portable.zip` and includes that EXE, root LICENSE, and `src-tauri/portable/README.txt`.

If a verified release EXE already exists, package it without recompiling from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File frontend/src-tauri/scripts/package-portable.ps1 -ExecutablePath frontend/src-tauri/target/release/codex-session-observatory.exe
```

Synchronize application versions in `frontend/package.json`, the npm lockfile's root and empty-path package, `backend/Cargo.toml`, `frontend/src-tauri/Cargo.toml`, and `frontend/src-tauri/tauri.conf.json`. Both Cargo locks reflect the local backend package, and the desktop lock also reflects `codex-session-observatory-tauri`. Third-party versions are independent. Tauri supplies runtime and Windows EXE metadata; inspect FileVersion and ProductVersion after building. Windows `2.0.1.0` corresponds to application `2.0.1`.
