# Codex Session Observatory

[![Latest release](https://img.shields.io/github/v/release/revertable/codex-session-observatory?display_name=tag&label=release)](https://github.com/revertable/codex-session-observatory/releases/latest)

**Language:** English | [한국어](README.ko.md)

Codex Session Observatory is a Windows desktop tool for browsing and reading local Codex session records. Explore a transcript, gather the messages you need, copy a useful view, or export a complete session as a structured Worklog. Plain `.jsonl` and compressed `.jsonl.zst` records are processed locally without rewriting the originals.

## Design philosophy

I develop and maintain this independently as a personal, one-developer project. I also use it continuously in my own Codex work. Development is **Validation-first**: I add capabilities whose usefulness becomes clear in actual use, and investigate and verify problems before changing behavior.

Practical value, accuracy, and preservation of original records matter more to me than the number of features. The app keeps message order and context visible so you can choose which records to read, collect, and reuse.

## Get started

1. Download the Windows x64 portable ZIP from [GitHub Releases](https://github.com/revertable/codex-session-observatory/releases/latest).
2. Extract it and run `codex-session-observatory.exe`.
3. Choose a session in **Sessions** to load its **Transcript**. Add individual messages to **Collection** when you want to reuse them.

Sessions are discovered under `CODEX_HOME/sessions`, or `%USERPROFILE%\.codex\sessions` when `CODEX_HOME` is unset. The ZIP contains the EXE, `LICENSE`, and a bilingual `README.txt`. It uses the Microsoft Edge WebView2 runtime installed on Windows; it does not include an installer or automatic updater.

## Browse and read

The workspace has **Sessions / Transcript / Collection** panels. Sessions and Collection can be hidden independently, and their boundaries can be resized. Each panel scrolls independently and has its own Top/Bottom controls.

- **Flat** shows sessions by their original creation time, newest first, and loads more as you scroll.
- **Hierarchical** follows year/month/day folders. Sessions outside those folders remain available in a separate group.

Your Flat/Hierarchical choice is saved on this device and restored when you reopen the app. Flat is the default when no valid saved choice is available.

Both views use the same list of ordinary and ChatGPT Handoff sessions. Archived sessions and Guardian reviews are excluded from this list. Titles come from metadata available on this device; **Untitled Session** and its information tooltip identify records without title metadata. Recent conversation activity affects title emphasis, not list order.

Selecting a session opens it in Transcript. Right-click a session for **Open**, **Open Containing Folder**, or **Export Worklog**. Folder opening and exporting an unselected session keep the current transcript and Collection intact.

Choose **Terminal Style**, **Markdown Style**, **DM Style**, or **DM Style (Dark)** under **Style**. **Filters** selects the visible roles. User and Codex messages share Markdown emphasis, lists, links, code, and tables; tool activity and metadata retain a plain-text presentation. Click message headers to collapse or expand them. Available timestamps are shown in local time.

**Text** and **Code** independently select fonts installed on Windows. Default keeps the app's existing font rules. Font choices are saved on this device; character fallback depends on the selected font and system. Choosing a proportional Code font can change whitespace-based alignment.

## Collect, copy, and export

During a task, I sometimes bring the context of an existing conversation to another AI as part of deciding what to do next. Passing along my goals, reference material, instructions, the AI's responses, and progress so far meant finding and copying the relevant messages one by one.

I built Collection to make that part of my own workflow easier. Select the messages you need and click **Copy All** to copy them together, ready to use as reference material in a new prompt.

| Task | Result |
| --- | --- |
| **Capture Transcript**, in the Transcript header | Copies a text presentation using the current filters, theme, and collapsed/expanded state |
| Message **+ / ✓** controls and Collection **Copy All** | Collects selected message snapshots and copies them in original transcript order |
| **Resume command** copy control | Copies `codex resume <session-id>` for use in Codex when the session ID is available |
| **Export Worklog**, in the toolbar or a session's context menu | Exports the complete source session independently of filters, collapse state, and Collection |

Collected messages stay in their original transcript order, with role headers, available local timestamps, Markdown fences, line breaks, and indentation preserved. **Copy All** keeps the selection; **Clear** empties it.

Each human request begins a Worklog unit containing the following Codex responses and tool activity until the next request. Export creates `codex-worklog/YYYY-MM-DD/HHMMSS_<source-id>/` with `000_index.md`, numbered Markdown units, and `manifest.json`, then opens the folder in File Explorer. Compatible existing bundles can be refreshed under the exporter's overwrite safeguards.

## Refresh and session state

**Reload Sessions** refreshes the Navigator snapshot while retaining the current transcript and Collection. Changing Flat/Hierarchical mode also leaves them intact.

The top-header and Transcript-header **Refresh** controls reread the current session. The last successful transcript remains visible during loading and after a failed refresh. Collection snapshots, source order, and panel state survive Refresh, filters, and theme changes. Hiding a panel keeps its state.

The **Loaded** badge reports state; the adjacent **X** resets the loaded session. Selecting a different session or resetting clears Collection and closes its panel. Collection is also cleared when the app exits. The common **Status** line reports action results, progress, warnings, and errors.

## Local processing and project information

Session content is processed locally. At startup, an automatic GitHub Releases check can report a newer public release or an unpublished development version; it sends no session content, selected paths, or session IDs. The current app has no in-app setting to disable this request. GitHub receives connection and request metadata as described in the privacy section of the [Code signing policy](docs/code-signing-policy.md#privacy-policy). It does not download or install updates. External links open only through explicit user actions.

The [Cosmic Horizon Archive](https://riu-salze-studio.gitbook.io/cosmic-horizon) describes the related approach to observable AI-assisted work. This project follows [Codex Chat Viewer](https://github.com/revertable/codex-chat-viewer), rebuilt with Rust, Svelte, and Tauri.

For source builds and architecture, see the [development guide](frontend/README.md). Verification is documented in the [test matrix](docs/test-matrix.md). Version-specific changes belong in [GitHub Releases](https://github.com/revertable/codex-session-observatory/releases).

## Code signing policy

See the [Code signing policy](docs/code-signing-policy.md). The policy is a draft for the SignPath Foundation application; code signing is not enabled.
