# Codex Session Observatory

[![Latest release](https://img.shields.io/github/v/release/revertable/codex-session-observatory?display_name=tag&label=release)](https://github.com/revertable/codex-session-observatory/releases/latest)

**Language:** English | [한국어](README.ko.md)

Codex Session Observatory is a Windows desktop app for reading Codex session JSONL files from Codex CLI and the Codex Windows app. Read transcripts, capture the current view, collect selected messages, and export complete sessions as structured worklogs. Session files are processed locally and remain unchanged.

## Get started

1. Download the Windows portable ZIP from [GitHub Releases](https://github.com/revertable/codex-session-observatory/releases/latest).
2. Extract the archive and run `codex-session-observatory.exe`.
3. Click **Select JSONL** and choose a session file.

The archive includes the application, `LICENSE`, and a bilingual `README.txt`.

## Features

| Feature | What it does | Output |
| --- | --- | --- |
| Transcript | Read a session with themes, role filters, and collapsible messages | On-screen transcript |
| Capture Transcript | Copy the transcript using the current filters, theme, and expanded/collapsed state | Clipboard text |
| Collection | Gather selected messages in their original transcript order | Clipboard text via **Copy All** |
| Export Worklog | Export the complete session independently of filters and Collection selections | Structured local files |

These four features work independently. Collecting messages changes neither the transcript nor the content used by Capture Transcript or Export Worklog.

## Read a transcript

Choose **Terminal Style**, **Markdown Style**, **DM Style**, or **DM Style (Dark)** from **Theme**. All four themes share Markdown formatting for user and Codex messages, including emphasis, lists, links, code blocks, and tables. Tool calls, tool results, and metadata use plain-text formatting.

Use **You**, **Codex**, **Tool calls**, **Tool results**, and **Meta** to choose which roles appear. Click a message header to collapse or expand its body. Available message timestamps use local time in `YYYY-MM-DD HH:mm:ss` format.

- **Refresh** rereads the selected file. The current transcript stays visible while loading and remains available if refresh fails.
- The down-arrow button to the right of the Collection toggle is **Scroll to Bottom**. **Top** below the transcript returns to the top.
- **Copy Resume Command** copies `codex resume <session-id>` when a session ID is available.
- Click the **loaded** status to clear the loaded session and return to the initial screen.

Referenced ChatGPT conversations appear with their title and conversation ID. Recognized automatically supplied context is separated from human requests. Guardian review sessions have a dedicated view with **Open Parent Session** when the parent is available locally; resume and Worklog export are unavailable for these review sessions.

## Capture Transcript

Click **Capture Transcript** below the transcript to copy its text presentation to the clipboard. The capture follows the current role filters, theme, and collapsed messages. Collapsed messages contribute their headers only. Markdown content is copied as readable text.

Collection selections do not affect the capture.

## Collect messages

1. Click **+** beside a message timestamp to add it to Collection. The icon changes to **✓**; click it again to remove that message.
2. Review the selected messages in the Collection Panel. Adding the first message opens the panel automatically.
3. Click **Copy All** to copy the collected messages. **Clear** removes all selections.

The panel starts closed. The Collection icon immediately to the right of **Theme** shows or hides it. Its tooltip is **Show Collection** or **Hide Collection**.

Collection keeps messages in their order of appearance in the original transcript, before filtering. Selection time and timestamps do not determine the order. Each message appears once, and removing then re-adding it restores its original position. The panel and **Copy All** use the same order.

The panel is read-only. It shows the parsed message text with Markdown markers, code fences, line breaks, and indentation preserved, rather than rendering Markdown. Role headers such as `[YOU]`, `[CODEX]`, and `[TOOL]` and local timestamps appear in both the panel and the copied text.

Changing filters or themes preserves the collection. **Refresh** preserves its contents, order, selection indicators, and open/closed state. Hiding the panel or using **Copy All** keeps the selections. Loading another JSONL file or resetting the loaded session clears the collection and closes the panel. Closing the app also clears the collection; it is held for the current session in the app.

## Export Worklog

Click **Export Worklog** and choose a parent folder. The app exports the complete session regardless of the current role filters, collapsed messages, or Collection selections.

Each human request starts a work unit containing the following Codex responses and tool activity up to the next request. The resulting bundle has this structure:

```text
<selected-parent>/
└─ codex-worklog/
   └─ YYYY-MM-DD/
      └─ HHMMSS_<source-id>/
         ├─ 000_index.md
         ├─ 001_HHMMSS.md
         ├─ 002_HHMMSS.md
         ├─ ...
         └─ manifest.json
```

`000_index.md` provides the session index and referenced-conversation information. Numbered Markdown files contain the work units. `manifest.json` tracks generated files so exporting the same compatible bundle again refreshes them. Directory and file names use local time; original timestamps remain in the generated content and metadata where available.

After export, the app opens the bundle folder in File Explorer.

## App information

On launch, the app checks GitHub Releases and shows whether the running version is current, a newer public release is available, or the running version is an unpublished development version.

**Visit Cosmic Horizon** opens the related [Cosmic Horizon Archive](https://riu-salze-studio.gitbook.io/cosmic-horizon).

Codex Session Observatory follows [Codex Chat Viewer](https://github.com/revertable/codex-chat-viewer), rebuilt as a Rust, Svelte, and Tauri desktop app. Source build instructions are in the [development guide](frontend/README.md); automated checks are documented in the [test matrix](docs/test-matrix.md).
