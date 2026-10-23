# Observatory Frontend

This directory contains the Svelte control room and its Tauri desktop bridge.
The Rust backend remains responsible for JSONL inspection, parsing, session
routing, parent-session lookup, and Worklog generation.

## Transcript data flow

The initial load requests all observation kinds once and retains those
transcript blocks in frontend state. Filter changes project the retained blocks
without reparsing the source file. Theme changes select the corresponding
renderer without an additional keyed remount of the transcript container.

Collapse state is owned by `App.svelte` and is reset when the transcript scope
(source session, filter, or theme) changes. **Capture Transcript** serializes the
same filtered blocks, references, theme, and collapse state directly from data;
it does not scrape rendered DOM text.

Refresh pending and failure retain the last successful observations. Equal
message content reuses the existing DOM subtree; appended messages are added
without replacing the retained transcript. `TranscriptViewer.svelte` selects
the presentation, while `AppLayout.svelte` owns the Transcript/Collection
columns. A left Session Navigator is a future extension point, not a current
feature.

## Shared message rendering

User and Codex blocks share the `message-semantics.ts` Markdown AST and the
static DOM constructor in `message-dom.ts` across all four themes. Supported
elements include paragraphs, emphasis, lists, links, inline and fenced code,
and tables. Tool calls, results, and metadata remain plain text. Raw HTML and
images are disabled; external links are restricted to absolute HTTP/HTTPS
destinations through the existing Tauri opener boundary.

## Collection state and outputs

`lib/collection/` owns in-memory selection, read-only presentation, and clipboard
serialization. Keys combine the loaded source path, kind, raw timestamp,
content, and occurrence number before filtering. Collected items snapshot the
parsed block and sort by its index in the unfiltered transcript, independently
of selection time and timestamps.

Refresh retains the exact collection snapshots, order, selected indicators,
and panel state, including during pending and failure. Filter/theme changes
do not reset the collection. Selecting another path or resetting the session
clears it and closes the panel. Adding the first item opens the panel; later
additions respect a closed panel. Clear resets selections while keeping the
current panel state; Copy All retains them. Collection is not persisted across
app restarts.

The panel uses `pre` for raw parsed content, preserving Markdown fences and
whitespace without visual Markdown rendering. It does not reconstruct the
original JSONL record or reverse any parser normalization. Display and Copy All
share role labels and the Transcript's local timestamp formatter. Original
timestamps remain part of message identity.

Collection, Capture Transcript, and Export Worklog have separate inputs:
Collection serializes selected snapshots; Capture serializes the filtered
theme/collapse presentation; the backend Worklog exporter reads the complete
source session. Collection state is never passed to Capture or Worklog.

The toolbar Bottom action and existing Top action share the window scroll
target, 200ms animation, and reduced-motion behavior. Browser tests wait for
the destination across consecutive frames with a bounded timeout and include
a deliberately delayed frame; they do not assert completion after a fixed
300ms delay.

## Update availability

At launch, `App.svelte` reads the packaged application version and performs one
unauthenticated request to GitHub's latest public release endpoint. A notice is
passed to the initial transcript presentations for `update-available`,
`current`, or `development` results. The last indicates a valid running version
newer than the latest public release. Network failures and unrecognized
responses remain silent, and the fixed official Releases URL is the only update
link opened. The request sends no session content, selected paths, or session
identifiers.

## Development

Install the locked dependencies and start an interactive desktop development
run from `frontend/`:

```text
npm ci
npm run tauri:dev
```

For automated tests, static checks, production builds, Rust package tests,
desktop build verification, and change-specific requirements, follow the
[test matrix](../docs/test-matrix.md).

The desktop command layer is under `src-tauri/`. It adapts typed backend DTOs to
Tauri commands and must not duplicate parser or session-routing behavior.

## Windows source builds and version metadata

Install Node.js with npm, the Rust stable toolchain, and the Windows Tauri build
prerequisites (MSVC build tools, Windows SDK, and WebView2). Run `npm ci` from
`frontend/` in a fresh checkout. From the repository root, `build-and-run.bat`
builds the release executable without an installer, packages a portable ZIP,
and launches the executable. This packaging path is separate from verification.

The executable is `frontend/src-tauri/target/release/codex-session-observatory.exe`.
The packaging script reads `tauri.conf.json` to name
`release/Codex-Session-Observatory_<version>_windows-x64-portable.zip`, containing
the executable, root `LICENSE`, and `src-tauri/portable/README.txt`.

Synchronize the application version in `frontend/package.json`, the npm
lockfile's root and empty-path package, `backend/Cargo.toml`,
`frontend/src-tauri/Cargo.toml`, and `frontend/src-tauri/tauri.conf.json`.
Both Cargo lockfiles must also reflect the local package versions (`backend`
in both, and `codex-session-observatory-tauri` in the desktop lockfile).
Dependency package versions are independent. Tauri build metadata supplies the
Windows executable version and the runtime version used by the update check.
After a version change, check the compiled executable's FileVersion and
ProductVersion as well as the source metadata. A four-part Windows version
such as `1.3.0.0` corresponds to app version `1.3.0`.
