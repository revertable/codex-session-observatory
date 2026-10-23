# Observatory Map

## Project Identity

Project name:

```text
Codex Session Observatory
```

Purpose:

```text
A local-first Rust + Svelte + Tauri desktop observatory for Codex session JSONL logs.
```

This project is not only a viewer.
It is an observatory for AI-assisted work records.

---

## Reference Project

The original Kotlin/Swing implementation is maintained separately.

Original Kotlin/Swing version:

```text
https://github.com/revertable/codex-chat-viewer
```

Codex Session Observatory began as a Rust/Svelte port of that idea and now operates as its own Tauri desktop product. The Kotlin/Swing repository remains read-only historical and behavioral reference material, not the current product contract.

---

## Metaphor Map

Use these meanings consistently:

```text
Signal Records      = raw Codex session JSONL files
Signals             = raw JSONL events
Observations        = parsed/rendered entries
Observatory Core    = Rust backend
Control Room        = Svelte frontend
Observation Report  = versionable Worklog bundle
Sample Signals      = sanitized sample JSONL files
Field Kit           = release package
```

The metaphor exists to clarify structure.
Do not use metaphor when it hides purpose.

---

## Repository Shape

Expected top-level structure:

```text
backend/       Rust Observatory Core
frontend/      Svelte Control Room plus the Tauri desktop bridge
docs/          current boundary/architecture documents and historical records
sample-data/   optional sanitized JSONL fixtures only
release/       local packaging workspace; portable ZIP output is ignored
```

Within `frontend/`, `src/` contains the Svelte application and `src-tauri/` contains the desktop bridge, capabilities, configuration, and packaging support.

Do not rename top-level areas without explicit approval.

---

## Backend Responsibility

The Rust backend is the Observatory Core.

It should handle:

* reading Codex JSONL files
* inspecting and classifying session identity before transcript parsing
* routing ordinary and specialized sessions
* parsing raw signals
* conservatively separating human requests from recognized transport/context envelopes
* creating observations
* locating verified parent sessions by thread id
* exposing typed transport DTOs to the Tauri command layer
* generating versionable Worklog bundles

Prefer clear technical names:

```text
backend/src/parser/
backend/src/domain/
backend/src/inspection/
backend/src/session/
backend/src/api/
backend/src/export/
```

The backend is a Rust library used by the Tauri application. It is not currently an HTTP server and does not expose a standalone local web API.

For an ordinary session, the backend first inspects the stream for session identity, rewinds the file, and then parses it line by line with a reusable buffer. Known Codex envelopes use a typed, borrowing-oriented path. Unknown or legacy shapes retain the compatibility path through `serde_json::Value`. Candidate ordering, counters, replacement, and adjacent-deduplication semantics are shared after extraction.

Specialized sessions stop at their specialized routing boundary instead of entering the ordinary transcript parser. Parent-session lookup independently verifies candidate files by inspected thread identity.

### Human requests and transport context

JSONL `role=user` payloads can combine human text with ChatGPT-to-Work handoff
metadata, delegated tasks, and runtime context. The parser recognizes confirmed
envelopes conservatively. A delegated `Continuing from ...` task is suppressed
only when its title and `chatgpt-conversation://` ID exactly match the parsed
reference metadata. For a confirmed `ambient-ui-state` envelope, only text
after `## My request:` becomes a human request. Unrecognized or incomplete
structures retain the original text. Structured question replies become human
answers in their supplied order; canonical questions remain Codex observations.

Referenced conversation title and ID appear once as provenance. The bounded
`priorConversation` preview cache is not repeated in the transcript or Worklog;
the export index records preview availability. Recognized delegated tasks and
ambient context do not become Worklog request units. Parsing never rewrites
the source JSONL.

Avoid decorative names that hide purpose.

---

## Frontend Responsibility

The Svelte frontend is the Control Room.

It should handle:

* file/path input flow
* parsed observation display
* filter controls
* view mode controls
* collapse/expand interaction
* transcript capture and refresh actions
* source-ordered Collection selection, panel state, and clipboard copy
* Worklog export action UI
* specialized-session presentation and parent navigation
* user-visible status and error display
* launch-time public release availability display

Current responsibility-oriented component areas include:

```text
frontend/src/lib/control-room/
frontend/src/lib/rendering/
frontend/src/lib/collection/
frontend/src/lib/load-workflow.ts
frontend/src/lib/parse-contract.ts
frontend/src/lib/specialized-session.ts
```

The frontend retains the complete loaded transcript block set and projects role filters locally. Renderers receive the projected blocks plus explicit collapse state; filter and theme changes do not trigger an additional keyed remount of the transcript container. Transcript capture is a data-based serialization of the current theme, projected blocks, references, event summary, and collapse state rather than a readback from DOM text.

Filter semantics are shared across the backend domain, transport projection, and frontend projection. `You` includes only human-visible `You` observations. `Meta` includes `Context`, `Task`, and `System` observations. Tool calls and tool results remain independently selectable.

User/Codex message bodies share Markdown semantics and a static DOM constructor
across all four themes; technical and metadata bodies remain plain text.
Unchanged message attachments survive Refresh without replacing their DOM.

Collection holds read-only snapshots of parsed messages and sorts by position
in the unfiltered transcript. The same sorted items feed the panel and Copy All.
It preserves raw parsed text rather than rendering Markdown, and shares local
timestamp formatting with Transcript. Refresh, filters, and themes preserve
selection; selecting another JSONL or resetting the session clears selection
and closes the panel. This in-memory workspace is independent of filtered
Transcript capture and full-session backend Worklog export.

`AppLayout.svelte` owns the current Transcript and Collection columns;
`TranscriptViewer.svelte` selects a renderer. A future left Session Navigator
can be added beside these columns, but is not currently implemented. Detailed
frontend contracts and source-build instructions are in
[frontend/README.md](../frontend/README.md).

---

## Tauri Desktop Responsibility

`frontend/src-tauri/` is the desktop integration boundary.

It should handle:

* Tauri commands that adapt frontend requests to backend DTOs
* native file and folder dialogs
* opening exported folders or related external links
* desktop capabilities and application configuration
* portable Windows packaging support
* narrowly scoped external-link permissions for documented product links

Business parsing, session classification, parent lookup, and Worklog generation remain in the backend crate rather than Tauri command handlers.

The current command bridge calls the backend directly in-process. Do not describe this as a network API or local server.

---

## Naming Guidance

Prefer names that expose technical responsibility. Avoid decorative names such as:

```text
NebulaPanel.svelte
StarMagic.svelte
BlackholeView.svelte
```

The metaphor must clarify boundaries, not decorate confusion.
