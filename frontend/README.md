# Observatory Frontend

This directory contains the Svelte workspace and its Tauri desktop bridge. Rust owns JSONL decoding, session inspection and classification, Navigator snapshots, parent-session lookup, and Worklog generation. The desktop bridge calls the backend in-process; it is not a network API or local server.

## Session Navigator and loading

`lib/session-navigator/` implements Flat and Hierarchical views of one backend snapshot. The backend discovers ordinary and ChatGPT Handoff sessions under `CODEX_HOME/sessions`, defaulting to the user's `.codex/sessions`. It excludes archives, Guardian reviews, and linked sources. Title metadata and actual conversation activity are collected by the backend; missing-title sources become Untitled Session without invented prompt titles.

Flat uses snapshot-bound cursors and pages of 20 in original creation-time order. Hierarchical follows date folders and includes unfiled items. Reload replaces the snapshot and invalidates old cursors and action targets. The frontend coordinates generations, duplicate-request protection, loading/error feedback, and retry. Activity affects title weight only.

`App.svelte` reuses one load workflow for Navigator selection and parent-session navigation. A source load requests all observation kinds once; filters project retained blocks without reparsing. Plain and zstd-compressed JSONL share the transport contract. Context-menu Open uses the same selection flow; folder/Export commands revalidate snapshot identity and paths without replacing the selected transcript.

## Transcript rendering and state

The full block array and filtered view share block references. An identity map derived from source path, role, timestamp, content, and duplicate occurrence is reused while the original array and path are unchanged. All three renderers use these keys. Refresh receives new DTOs and recomputes identities while equal content retains its DOM attachment.

Refresh pending and failure retain the last successful observations. `TranscriptViewer.svelte` selects Terminal, Markdown, or Chat rendering; the two DM themes share Chat. Collapse state belongs to App and resets when source, filters, or theme changes. Capture serializes filtered blocks, references, theme, and collapse state directly from data, without scraping DOM.

User/Codex bodies share the Markdown AST and safe static DOM constructor. Semantics include paragraphs, emphasis, lists, links, inline/fenced code, and tables. Tool calls/results and metadata remain plain text. Raw HTML and images are disabled; external links use validated absolute HTTP/HTTPS destinations through Tauri's opener. Text tokens use Text nodes without redundant span wrappers. Semantic parents and table cells preserve whitespace. Transcript virtualization and `content-visibility` skipping are not enabled.

## Workspace and common feedback

`AppLayout.svelte` and common CSS own the Sessions / Transcript / Collection Grid, shared available height, independent panel scrolling, side-panel toggles, and constrained resize tracks. Each panel's Top/Bottom controls target its own viewport. `panel-scroll.ts` handles animation, reduced motion, and cancellation; it does not scroll the page window. Theme styles own presentation rather than alternate workspace geometry.

`SessionHeader.svelte` presents load state, source information, resume copying, appearance, filters, and panel actions. Loaded/Idle is a badge; Reset is separate. The common status controller coordinates user-facing action results and errors without duplicating feedback in each panel.

`system_fonts.rs` uses Windows DirectWrite to enumerate installed families. Text and Code choices map independently to CSS variables; empty values mean Default. Settings use WebView local storage key `observatory.fonts.v1`; unavailable saved families revert to Default. Character fallback is system-dependent, and a proportional Code choice is not silently replaced. No comparison font assets are bundled.

## Collection and output boundaries

`lib/collection/` owns selection, read-only presentation, and clipboard serialization. Items retain snapshots and original unfiltered indexes. Source order is independent of click order and timestamps; duplicate occurrences have independent identities. Refresh, filters, and themes preserve snapshots and panel state. A different source or Reset clears Collection and closes it. Copy All keeps selections; Clear leaves the panel open. Collection is not persisted across restarts.

Collection shows parsed text, not reconstructed JSONL records. General prose follows Text and actual code/log segments follow Code; the whole Collection is not code-only. Markdown fences, line breaks, and indentation remain without visual Markdown rendering.

Collection serializes selected snapshots, Capture serializes the transcript presentation, and Worklog reads the complete source in Rust. Filters and Collection are not passed to the exporter. Existing manifest compatibility, staging, and overwrite safeguards remain in the backend.

Desktop parse/Export commands schedule blocking work away from the native message thread. Shared file-operation serialization is acquired before worker scheduling and held until completion. This protects native responsiveness and limits concurrent file work; it does not remove IPC or renderer costs. See [Performance History](../docs/performance-history.md) for measurements and rejected approaches.

## Update availability

On startup App reads the packaged version and makes one unauthenticated GitHub latest-release request. Initial guidance can show current, update-available, or development status. Network failures and unknown responses stay silent. Only the official Releases URL is opened; session content, paths, and IDs are not sent. Updates are not downloaded or installed.

## Development and verification

Install Node.js/npm, Rust stable, and Windows Tauri prerequisites (MSVC build tools, Windows SDK, and WebView2). From `frontend/`:

```text
npm ci
npm run tauri:dev
```

The command adapter is in `src-tauri/`; parsing and session business rules remain in the backend crate. Follow the [test matrix](../docs/test-matrix.md) for Node-only tests, client DOM tests, static checks, Rust tests, and the full repository `verify.ps1` sequence. Browser integration uses an installed browser and isolated profiles; it does not replace native clipboard/dialog or packaged-EXE checks.

## Windows builds and version metadata

`build-and-run.bat` builds the release EXE, packages the portable ZIP, and launches it. This is separate from verification. The EXE is `frontend/src-tauri/target/release/codex-session-observatory.exe`. Packaging reads the Tauri version for `release/Codex-Session-Observatory_<version>_windows-x64-portable.zip` and includes that EXE, root LICENSE, and `src-tauri/portable/README.txt`.

If a verified release EXE already exists, package it without recompiling from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File frontend/src-tauri/scripts/package-portable.ps1 -ExecutablePath frontend/src-tauri/target/release/codex-session-observatory.exe
```

Synchronize application versions in `frontend/package.json`, the npm lockfile's root and empty-path package, `backend/Cargo.toml`, `frontend/src-tauri/Cargo.toml`, and `frontend/src-tauri/tauri.conf.json`. Both Cargo locks reflect the local backend package, and the desktop lock also reflects `codex-session-observatory-tauri`. Third-party versions are independent. Tauri supplies runtime and Windows EXE metadata; inspect FileVersion and ProductVersion after building. Windows `2.0.0.0` corresponds to application `2.0.0`.
