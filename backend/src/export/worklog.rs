use std::{
    collections::HashSet,
    fs, io,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};
use time::{
    OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339, macros::format_description,
};

use crate::{
    api::LoadedFileMetadataDto,
    domain::{ParsedChatLog, ReferencedConversation, RenderedEntry, RenderedEntryKind},
    session,
};

const GENERATOR: &str = "codex-session-observatory";
const FORMAT: &str = "worklog_bundle";
const FORMAT_VERSION: u64 = 1;
const INDEX_FILE: &str = "000_index.md";
const MANIFEST_FILE: &str = "manifest.json";
const REVIEW_WARNING: &str = "Exported worklogs may contain prompts, paths, command outputs, code snippets, and project-specific details. Review before committing or sharing.";
const DATE_FORMAT: &[time::format_description::FormatItem<'static>] =
    format_description!("[year]-[month]-[day]");
const TIME_FORMAT: &[time::format_description::FormatItem<'static>] =
    format_description!("[hour][minute][second]");
type NamingOffsetResolver = fn(OffsetDateTime) -> UtcOffset;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExportWorklogRequest {
    pub source_path: PathBuf,
    pub parent_directory: PathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExportWorklogResult {
    pub bundle_path: String,
    pub generated_files: Vec<String>,
    pub refreshed: bool,
}

impl ExportWorklogResult {
    pub fn to_json(&self) -> Value {
        json!({
            "status": "exported",
            "bundle_path": self.bundle_path,
            "generated_files": self.generated_files,
            "refreshed": self.refreshed,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExportWorklogError {
    pub code: &'static str,
    pub message: String,
}

impl ExportWorklogError {
    pub fn to_json(&self) -> Value {
        json!({
            "error": {
                "code": self.code,
                "message": self.message,
            }
        })
    }

    fn io(context: &str, error: io::Error) -> Self {
        Self {
            code: "worklog_export_failed",
            message: format!("{context}: {error}"),
        }
    }

    fn unsafe_target(message: impl Into<String>) -> Self {
        Self {
            code: "target_not_safe_to_overwrite",
            message: message.into(),
        }
    }
}

struct WorkUnit<'a> {
    blocks: Vec<WorklogBlock<'a>>,
}

#[derive(Clone, Copy)]
struct WorklogBlock<'a> {
    entry: &'a RenderedEntry,
    timestamp: Option<&'a str>,
}

struct ExistingBundle {
    generated_files: Vec<String>,
}

pub fn export_worklog(
    request: ExportWorklogRequest,
) -> Result<ExportWorklogResult, ExportWorklogError> {
    export_worklog_at(request, OffsetDateTime::now_utc(), os_local_offset_at)
}

fn export_worklog_at(
    request: ExportWorklogRequest,
    export_time: OffsetDateTime,
    naming_offset: NamingOffsetResolver,
) -> Result<ExportWorklogResult, ExportWorklogError> {
    let source_path = session::source::resolve_path(&request.source_path).map_err(|error| {
        ExportWorklogError {
            code: "invalid_source_file",
            message: format!("The loaded JSONL source file is unavailable: {error}"),
        }
    })?;
    let request = ExportWorklogRequest {
        source_path,
        ..request
    };
    if !request.parent_directory.is_dir() {
        return Err(ExportWorklogError {
            code: "invalid_export_parent",
            message: "The selected export parent directory does not exist.".to_owned(),
        });
    }

    let source = LoadedFileMetadataDto::from_path(&request.source_path)
        .map_err(|error| ExportWorklogError::io("Could not resolve source metadata", error))?;
    let loaded = session::load_file(&request.source_path)
        .map_err(|error| ExportWorklogError::io("Could not load the source JSONL", error))?;
    if !loaded.descriptor.capabilities().can_export_worklog {
        return Err(ExportWorklogError {
            code: "worklog_export_unavailable",
            message: "Worklog export is not available for this session type.".to_owned(),
        });
    }
    let parsed = loaded.into_compatible_chat_log();
    let (prelude, units) = group_work_units(&parsed);
    let source_key = source_key(&source);
    let source_id = source_folder_id(&source, &source_key);
    let bundle_start = first_you_time(&units)
        .or_else(|| first_parsed_time(&parsed))
        .or_else(|| source_file_time(&request.source_path))
        .unwrap_or(export_time);
    let naming_bundle_start = naming_time(bundle_start, naming_offset);
    let date = format_time(naming_bundle_start, DATE_FORMAT, "1970-01-01");
    let start_time = format_time(naming_bundle_start, TIME_FORMAT, "000000");
    let bundle_name = safe_name(&format!("{start_time}_{source_id}"));
    let date_directory = request.parent_directory.join("codex-worklog").join(date);
    let target = date_directory.join(bundle_name);
    let existing = if target.exists() {
        Some(validate_existing_bundle(&target, &source_key)?)
    } else {
        None
    };

    fs::create_dir_all(&date_directory).map_err(|error| {
        ExportWorklogError::io("Could not create worklog date directory", error)
    })?;

    let unit_files = work_unit_filenames(&units, bundle_start, naming_offset);
    let mut generated_files = vec![INDEX_FILE.to_owned()];
    generated_files.extend(unit_files.iter().cloned());
    generated_files.push(MANIFEST_FILE.to_owned());

    if let Some(existing) = &existing {
        ensure_new_files_do_not_overwrite_user_files(
            &target,
            &existing.generated_files,
            &generated_files,
        )?;
    }

    let staging = staging_directory(&date_directory, &target);
    fs::create_dir(&staging).map_err(|error| {
        ExportWorklogError::io("Could not create worklog staging directory", error)
    })?;

    let stage_result = write_staged_bundle(
        &staging,
        &source,
        &source_key,
        bundle_start,
        export_time,
        &parsed.session_provenance.referenced_conversations,
        &prelude,
        &units,
        &unit_files,
        &generated_files,
    );
    if let Err(error) = stage_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    let refreshed = existing.is_some();
    if let Some(existing) = existing {
        if let Err(error) = replace_generated_files(
            &target,
            &staging,
            &existing.generated_files,
            &generated_files,
        ) {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        fs::remove_dir(&staging)
            .map_err(|error| ExportWorklogError::io("Could not remove staging directory", error))?;
    } else {
        fs::rename(&staging, &target)
            .map_err(|error| ExportWorklogError::io("Could not publish worklog bundle", error))?;
    }

    Ok(ExportWorklogResult {
        bundle_path: target.to_string_lossy().into_owned(),
        generated_files,
        refreshed,
    })
}

fn group_work_units(parsed: &ParsedChatLog) -> (Vec<WorklogBlock<'_>>, Vec<WorkUnit<'_>>) {
    let mut prelude = Vec::new();
    let mut units = Vec::new();
    let mut current: Option<WorkUnit<'_>> = None;

    for (index, entry) in parsed.entries.iter().enumerate() {
        let block = WorklogBlock {
            entry,
            timestamp: parsed
                .entry_timestamps
                .get(index)
                .and_then(|timestamp| timestamp.as_deref()),
        };

        if entry.kind == RenderedEntryKind::You {
            if let Some(unit) = current.take() {
                units.push(unit);
            }
            current = Some(WorkUnit {
                blocks: vec![block],
            });
        } else if let Some(unit) = current.as_mut() {
            unit.blocks.push(block);
        } else {
            prelude.push(block);
        }
    }

    if let Some(unit) = current {
        units.push(unit);
    }

    (prelude, units)
}

fn write_staged_bundle(
    staging: &Path,
    source: &LoadedFileMetadataDto,
    source_key: &str,
    bundle_start: OffsetDateTime,
    export_time: OffsetDateTime,
    referenced_conversations: &[ReferencedConversation],
    prelude: &[WorklogBlock<'_>],
    units: &[WorkUnit<'_>],
    unit_files: &[String],
    generated_files: &[String],
) -> Result<(), ExportWorklogError> {
    let index = render_index(
        source,
        source_key,
        bundle_start,
        export_time,
        referenced_conversations,
        prelude,
        unit_files,
    );
    fs::write(staging.join(INDEX_FILE), index)
        .map_err(|error| ExportWorklogError::io("Could not write worklog index", error))?;

    for (index, (unit, filename)) in units.iter().zip(unit_files).enumerate() {
        fs::write(
            staging.join(filename),
            render_work_unit(index + 1, unit, source, source_key),
        )
        .map_err(|error| ExportWorklogError::io("Could not write work unit", error))?;
    }

    let manifest = json!({
        "generator": GENERATOR,
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "source": {
            "source_key": source_key,
            "file_name": source.file_name,
            "absolute_path": source.absolute_path,
            "session_id": source.session_id,
        },
        "bundle": {
            "started_at": format_rfc3339(bundle_start),
            "exported_at": format_rfc3339(export_time),
            "work_unit_count": units.len(),
        },
        "generated_files": generated_files,
    });
    let manifest = serde_json::to_string_pretty(&manifest).map_err(|error| ExportWorklogError {
        code: "worklog_export_failed",
        message: format!("Could not serialize worklog manifest: {error}"),
    })?;
    fs::write(staging.join(MANIFEST_FILE), format!("{manifest}\n"))
        .map_err(|error| ExportWorklogError::io("Could not write worklog manifest", error))?;

    Ok(())
}

fn render_index(
    source: &LoadedFileMetadataDto,
    source_key: &str,
    bundle_start: OffsetDateTime,
    export_time: OffsetDateTime,
    referenced_conversations: &[ReferencedConversation],
    prelude: &[WorklogBlock<'_>],
    unit_files: &[String],
) -> String {
    let mut output = String::from("# Codex Worklog\n\n");
    output.push_str("## Source Session\n\n");
    output.push_str(&format!(
        "- Source file: `{}`\n- Source path: `{}`\n- Session ID: `{}`\n- Source key: `{source_key}`\n- Bundle start: `{}`\n- Exported at: `{}`\n\n",
        source.file_name.as_deref().unwrap_or("Not detected"),
        source.absolute_path,
        source.session_id.as_deref().unwrap_or("Not detected"),
        format_rfc3339(bundle_start),
        format_rfc3339(export_time),
    ));
    output.push_str(&render_referenced_conversations(referenced_conversations));
    output.push_str("## Review Warning\n\n");
    output.push_str(REVIEW_WARNING);
    output.push_str("\n\n## Bundle Structure\n\n");
    output.push_str("Each numbered Markdown file is one work unit beginning with a `[YOU]` request and continuing until the next `[YOU]` request. `manifest.json` is the machine-readable safety marker used for compatible refreshes.\n\n");
    output.push_str("## Generated Work Units\n\n");
    if unit_files.is_empty() {
        output.push_str("No `[YOU]` work-unit boundaries were found.\n");
    } else {
        for filename in unit_files {
            output.push_str(&format!("- [{filename}]({filename})\n"));
        }
    }

    if !prelude.is_empty() {
        output.push_str("\n## Session Prelude\n\n");
        output.push_str("These parsed blocks appeared before the first `[YOU]` work unit.\n");
        for block in prelude {
            output.push_str(&render_block(*block));
        }
    }

    output
}

fn render_work_unit(
    sequence: usize,
    unit: &WorkUnit<'_>,
    source: &LoadedFileMetadataDto,
    source_key: &str,
) -> String {
    let started_at = unit
        .blocks
        .first()
        .and_then(|block| block.timestamp)
        .unwrap_or("Not available");
    let mut output = format!(
        "# Work Unit {sequence:03}\n\n- Source file: `{}`\n- Session ID: `{}`\n- Source key: `{source_key}`\n- Started at: `{started_at}`\n\n",
        source.file_name.as_deref().unwrap_or("Not detected"),
        source.session_id.as_deref().unwrap_or("Not detected"),
    );
    for block in &unit.blocks {
        output.push_str(&render_block(*block));
    }
    output
}

fn render_block(block: WorklogBlock<'_>) -> String {
    let label = block.entry.kind.label();
    let content = block.entry.content.trim();
    let fence = safe_fence(content);
    let mut output = format!("## {label}\n\n");
    if let Some(timestamp) = block.timestamp {
        output.push_str(&format!("Timestamp: `{timestamp}`\n\n"));
    }
    output.push_str(&format!("{fence}text\n{content}\n{fence}\n\n"));
    output
}

fn render_referenced_conversations(references: &[ReferencedConversation]) -> String {
    let mut output = String::new();
    for reference in references {
        output.push_str("## Referenced ChatGPT conversation\n\n");
        output.push_str(&format!(
            "- Title: {}\n- Conversation ID: {}\n- Preview available: {}\n\n",
            markdown_inline_value(reference.title.as_deref().unwrap_or("Not provided")),
            markdown_inline_value(
                reference
                    .conversation_id
                    .as_deref()
                    .unwrap_or("Not provided")
            ),
            if reference.preview_available {
                "yes"
            } else {
                "no"
            },
        ));
    }
    output
}

fn markdown_inline_value(value: &str) -> String {
    let value = value.replace(['\r', '\n'], " ");
    let longest = value
        .as_bytes()
        .split(|byte| *byte != b'`')
        .map(|run| run.len())
        .max()
        .unwrap_or(0);
    let fence = "`".repeat(longest + 1);
    format!("{fence}{value}{fence}")
}

fn safe_fence(content: &str) -> String {
    let longest = content
        .as_bytes()
        .split(|byte| *byte != b'`')
        .map(|run| run.len())
        .max()
        .unwrap_or(0);
    "`".repeat(3.max(longest + 1))
}

fn work_unit_filenames(
    units: &[WorkUnit<'_>],
    fallback: OffsetDateTime,
    naming_offset: NamingOffsetResolver,
) -> Vec<String> {
    units
        .iter()
        .enumerate()
        .map(|(index, unit)| {
            let started_at = unit
                .blocks
                .first()
                .and_then(|block| block.timestamp)
                .and_then(parse_timestamp)
                .unwrap_or(fallback);
            let naming_started_at = naming_time(started_at, naming_offset);
            format!(
                "{:03}_{}.md",
                index + 1,
                format_time(naming_started_at, TIME_FORMAT, "000000")
            )
        })
        .collect()
}

fn first_you_time(units: &[WorkUnit<'_>]) -> Option<OffsetDateTime> {
    units
        .first()
        .and_then(|unit| unit.blocks.first())
        .and_then(|block| block.timestamp)
        .and_then(parse_timestamp)
}

fn first_parsed_time(parsed: &ParsedChatLog) -> Option<OffsetDateTime> {
    parsed
        .entry_timestamps
        .iter()
        .flatten()
        .find_map(|timestamp| parse_timestamp(timestamp))
}

fn source_file_time(path: &Path) -> Option<OffsetDateTime> {
    let metadata = fs::metadata(path).ok()?;
    metadata
        .created()
        .or_else(|_| metadata.modified())
        .ok()
        .map(OffsetDateTime::from)
}

fn parse_timestamp(value: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(value, &Rfc3339).ok()
}

fn naming_time(value: OffsetDateTime, naming_offset: NamingOffsetResolver) -> OffsetDateTime {
    value.to_offset(naming_offset(value))
}

fn os_local_offset_at(value: OffsetDateTime) -> UtcOffset {
    UtcOffset::local_offset_at(value).unwrap_or_else(|_| value.offset())
}

fn format_rfc3339(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

fn format_time(
    value: OffsetDateTime,
    format: &[time::format_description::FormatItem<'_>],
    fallback: &str,
) -> String {
    value.format(format).unwrap_or_else(|_| fallback.to_owned())
}

fn source_key(source: &LoadedFileMetadataDto) -> String {
    if let Some(session_id) = source
        .session_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
    {
        return format!("session:{}", session_id.trim().to_ascii_lowercase());
    }
    format!(
        "path:{:016x}",
        fnv1a64(&normalized_path(&source.absolute_path))
    )
}

fn source_folder_id(source: &LoadedFileMetadataDto, source_key: &str) -> String {
    if let Some(session_id) = source.session_id.as_deref() {
        let short = session_id
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .take(8)
            .collect::<String>()
            .to_ascii_lowercase();
        if !short.is_empty() {
            return format!("session-{short}");
        }
    }

    let hash = source_key.rsplit(':').next().unwrap_or("source");
    format!("source-{}", &hash[..hash.len().min(8)])
}

fn normalized_path(path: &str) -> String {
    path.replace('\\', "/").to_ascii_lowercase()
}

fn fnv1a64(value: &str) -> u64 {
    value
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        })
}

fn safe_name(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect::<String>()
        .trim_end_matches(['.', ' '])
        .to_owned()
}

fn staging_directory(date_directory: &Path, target: &Path) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let target_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("worklog");
    date_directory.join(format!(".{target_name}.observatory-staging-{nonce}"))
}

fn validate_existing_bundle(
    target: &Path,
    source_key: &str,
) -> Result<ExistingBundle, ExportWorklogError> {
    let metadata = fs::symlink_metadata(target).map_err(|error| {
        ExportWorklogError::io("Could not inspect existing worklog target", error)
    })?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(ExportWorklogError::unsafe_target(
            "The existing worklog target is not a safe directory.",
        ));
    }

    let manifest_path = target.join(MANIFEST_FILE);
    let manifest = fs::read_to_string(&manifest_path).map_err(|_| {
        ExportWorklogError::unsafe_target(
            "The existing target does not contain a readable Observatory manifest.",
        )
    })?;
    let manifest: Value = serde_json::from_str(&manifest).map_err(|_| {
        ExportWorklogError::unsafe_target(
            "The existing target contains an invalid Observatory manifest.",
        )
    })?;

    let compatible = manifest.get("generator").and_then(Value::as_str) == Some(GENERATOR)
        && manifest.get("format").and_then(Value::as_str) == Some(FORMAT)
        && manifest.get("format_version").and_then(Value::as_u64) == Some(FORMAT_VERSION)
        && manifest
            .pointer("/source/source_key")
            .and_then(Value::as_str)
            == Some(source_key);
    if !compatible {
        return Err(ExportWorklogError::unsafe_target(
            "The existing target manifest is not compatible with this source session.",
        ));
    }

    let generated_files = manifest
        .get("generated_files")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ExportWorklogError::unsafe_target(
                "The existing target manifest has no generated file list.",
            )
        })?
        .iter()
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                ExportWorklogError::unsafe_target(
                    "The existing target manifest has an invalid generated file entry.",
                )
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    if !generated_files.iter().any(|file| file == MANIFEST_FILE)
        || generated_files
            .iter()
            .any(|file| !is_safe_direct_filename(file) || !is_observatory_generated_filename(file))
    {
        return Err(ExportWorklogError::unsafe_target(
            "The existing target manifest contains an unsafe generated file list.",
        ));
    }

    Ok(ExistingBundle { generated_files })
}

fn is_safe_direct_filename(value: &str) -> bool {
    let path = Path::new(value);
    let mut components = path.components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

fn is_observatory_generated_filename(value: &str) -> bool {
    if matches!(value, INDEX_FILE | MANIFEST_FILE) {
        return true;
    }

    let bytes = value.as_bytes();
    bytes.len() == 13
        && bytes[..3].iter().all(u8::is_ascii_digit)
        && bytes[3] == b'_'
        && bytes[4..10].iter().all(u8::is_ascii_digit)
        && &bytes[10..] == b".md"
}

fn ensure_new_files_do_not_overwrite_user_files(
    target: &Path,
    previous_generated: &[String],
    next_generated: &[String],
) -> Result<(), ExportWorklogError> {
    let previous = previous_generated.iter().collect::<HashSet<_>>();
    for filename in next_generated {
        let path = target.join(filename);
        if path.exists() && !previous.contains(filename) {
            return Err(ExportWorklogError::unsafe_target(format!(
                "The generated filename `{filename}` would overwrite an untracked file."
            )));
        }
    }
    Ok(())
}

fn replace_generated_files(
    target: &Path,
    staging: &Path,
    previous_generated: &[String],
    next_generated: &[String],
) -> Result<(), ExportWorklogError> {
    for filename in previous_generated {
        let path = target.join(filename);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
                return Err(ExportWorklogError::unsafe_target(format!(
                    "Generated path `{filename}` unexpectedly refers to a directory."
                )));
            }
            Ok(_) => fs::remove_file(&path).map_err(|error| {
                ExportWorklogError::io("Could not remove stale generated file", error)
            })?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(ExportWorklogError::io(
                    "Could not inspect stale generated file",
                    error,
                ));
            }
        }
    }

    for filename in next_generated {
        fs::rename(staging.join(filename), target.join(filename)).map_err(|error| {
            ExportWorklogError::io("Could not publish generated worklog file", error)
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc_offset(_: OffsetDateTime) -> UtcOffset {
        UtcOffset::UTC
    }

    fn korea_offset(_: OffsetDateTime) -> UtcOffset {
        UtcOffset::from_hms(9, 0, 0).expect("valid offset")
    }

    fn test_root(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("worklog-tests")
            .join(format!("{name}-{nonce}"))
    }

    fn sample_jsonl(second_unit: bool) -> String {
        let mut lines = vec![
            json!({"timestamp":"2026-06-20T14:29:00Z","type":"session_meta","payload":{"id":"11111111-2222-3333-4444-555555555555","cwd":"E:\\safe"}}).to_string(),
            json!({"timestamp":"2026-06-20T14:30:12Z","type":"event_msg","payload":{"type":"user_message","message":"first request"}}).to_string(),
            json!({"timestamp":"2026-06-20T14:30:20Z","type":"event_msg","payload":{"type":"agent_message","message":"first response"}}).to_string(),
            json!({"timestamp":"2026-06-20T14:30:30Z","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{}````"}}).to_string(),
        ];
        if second_unit {
            lines.extend([
                json!({"timestamp":"2026-06-21T15:18:30Z","type":"event_msg","payload":{"type":"user_message","message":"second request"}}).to_string(),
                json!({"timestamp":"2026-06-21T15:18:35Z","type":"event_msg","payload":{"type":"agent_message","message":"second response"}}).to_string(),
            ]);
        }
        lines.join("\n")
    }

    fn export_fixture(
        root: &Path,
        second_unit: bool,
    ) -> Result<ExportWorklogResult, ExportWorklogError> {
        fs::create_dir_all(root).expect("create test root");
        let source = root.join("11111111-2222-3333-4444-555555555555.jsonl");
        fs::write(&source, sample_jsonl(second_unit)).expect("write source");
        export_worklog_at(
            ExportWorklogRequest {
                source_path: source,
                parent_directory: root.to_path_buf(),
            },
            OffsetDateTime::parse("2026-06-22T10:00:00Z", &Rfc3339).expect("time"),
            utc_offset,
        )
    }

    #[test]
    fn compressed_export_matches_plain_and_refreshes_after_representation_changes() {
        let root = test_root("compressed-equivalence");
        let first = export_fixture(&root, true).expect("plain export");
        let expected = first
            .generated_files
            .iter()
            .map(|name| {
                (
                    name.clone(),
                    fs::read_to_string(Path::new(&first.bundle_path).join(name)).unwrap(),
                )
            })
            .collect::<Vec<_>>();
        let plain = root.join("11111111-2222-3333-4444-555555555555.jsonl");
        let packed = plain.with_extension("jsonl.zst");
        let bytes = zstd::stream::encode_all(sample_jsonl(true).as_bytes(), 3).unwrap();
        fs::write(&packed, &bytes).unwrap();
        fs::remove_file(&plain).unwrap();
        let before = fs::metadata(&packed).unwrap();
        let result = export_worklog_at(
            ExportWorklogRequest {
                source_path: plain.clone(),
                parent_directory: root.clone(),
            },
            OffsetDateTime::parse("2026-06-22T10:00:00Z", &Rfc3339).unwrap(),
            utc_offset,
        )
        .unwrap();
        assert!(result.refreshed);
        assert_eq!(first.bundle_path, result.bundle_path);
        for (name, expected) in expected {
            let actual = fs::read_to_string(Path::new(&result.bundle_path).join(name)).unwrap();
            // Only source provenance differs between the physical formats.
            assert_eq!(actual.replace(".jsonl.zst", ".jsonl"), expected);
        }
        assert_eq!(fs::read(&packed).unwrap(), bytes);
        assert_eq!(
            before.modified().unwrap(),
            fs::metadata(&packed).unwrap().modified().unwrap()
        );
        assert_eq!(
            before.created().ok(),
            fs::metadata(&packed).unwrap().created().ok()
        );
        assert!(!plain.exists());
        fs::write(&plain, sample_jsonl(true)).unwrap();
        fs::remove_file(&packed).unwrap();
        assert!(
            export_worklog_at(
                ExportWorklogRequest {
                    source_path: packed,
                    parent_directory: root.clone()
                },
                OffsetDateTime::parse("2026-06-22T10:00:00Z", &Rfc3339).unwrap(),
                utc_offset
            )
            .unwrap()
            .refreshed
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn exports_grouped_bundle_with_prelude_stable_names_and_safe_fences() {
        let root = test_root("grouping");
        let result = export_fixture(&root, true).expect("export succeeds");
        let bundle = PathBuf::from(&result.bundle_path);

        assert!(bundle.ends_with(Path::new("2026-06-20").join("143012_session-11111111")));
        assert_eq!(
            result.generated_files,
            vec![
                "000_index.md",
                "001_143012.md",
                "002_151830.md",
                "manifest.json"
            ]
        );
        let first = fs::read_to_string(bundle.join("001_143012.md")).expect("first unit");
        let second = fs::read_to_string(bundle.join("002_151830.md")).expect("second unit");
        let index = fs::read_to_string(bundle.join(INDEX_FILE)).expect("index");
        let manifest: Value = serde_json::from_str(
            &fs::read_to_string(bundle.join(MANIFEST_FILE)).expect("manifest"),
        )
        .expect("manifest json");
        assert_eq!(manifest["generator"], "codex-session-observatory");
        assert!(first.contains("[YOU]") && first.contains("first response"));
        assert!(!first.contains("second request"));
        assert!(second.contains("second request") && second.contains("second response"));
        assert!(first.contains("`````text"));
        assert!(index.contains("Session Prelude") && index.contains(REVIEW_WARNING));
        assert!(
            bundle
                .parent()
                .expect("date parent")
                .ends_with("2026-06-20")
        );

        fs::remove_dir_all(&root).expect("remove test root");
    }

    #[test]
    fn compatible_refresh_removes_only_manifest_generated_files() {
        let root = test_root("refresh");
        let first = export_fixture(&root, true).expect("first export");
        let bundle = PathBuf::from(&first.bundle_path);
        fs::write(bundle.join("user-note.md"), "keep me").expect("write user file");

        let source = root.join("11111111-2222-3333-4444-555555555555.jsonl");
        fs::write(&source, sample_jsonl(false)).expect("shorten source");
        let refreshed = export_worklog_at(
            ExportWorklogRequest {
                source_path: source,
                parent_directory: root.clone(),
            },
            OffsetDateTime::parse("2026-06-22T11:00:00Z", &Rfc3339).expect("time"),
            utc_offset,
        )
        .expect("refresh succeeds");

        assert!(refreshed.refreshed);
        assert!(!bundle.join("002_151830.md").exists());
        assert_eq!(
            fs::read_to_string(bundle.join("user-note.md")).expect("user file"),
            "keep me"
        );

        fs::remove_dir_all(&root).expect("remove test root");
    }

    #[test]
    fn existing_target_without_compatible_manifest_is_rejected_unchanged() {
        let root = test_root("unsafe");
        fs::create_dir_all(&root).expect("create root");
        let source = root.join("11111111-2222-3333-4444-555555555555.jsonl");
        fs::write(&source, sample_jsonl(false)).expect("write source");
        let target = root
            .join("codex-worklog")
            .join("2026-06-20")
            .join("143012_session-11111111");
        fs::create_dir_all(&target).expect("create unsafe target");
        fs::write(target.join("user-note.md"), "untouched").expect("write note");

        let error = export_worklog_at(
            ExportWorklogRequest {
                source_path: source,
                parent_directory: root.clone(),
            },
            OffsetDateTime::parse("2026-06-22T10:00:00Z", &Rfc3339).expect("time"),
            utc_offset,
        )
        .expect_err("unsafe target rejected");

        assert_eq!(error.code, "target_not_safe_to_overwrite");
        assert_eq!(
            fs::read_to_string(target.join("user-note.md")).expect("note remains"),
            "untouched"
        );

        fs::remove_dir_all(&root).expect("remove test root");
    }

    #[test]
    fn handoff_worklog_includes_reference_metadata_but_not_preview_body() {
        let root = test_root("handoff-reference");
        fs::create_dir_all(&root).expect("create test root");
        let source = root.join("11111111-2222-3333-4444-555555555555.jsonl");
        let handoff = concat!(
            "## Referenced ChatGPT conversation:\n",
            "Transport guidance.\n",
            r#"{"conversationId":"conversation-1","title":"Design discussion","priorConversation":{"conversation":[{"role":"user","content":[{"text":"private preview sentinel"}]}]}}"#,
            "\n## My request:\n",
            "Continue the implementation."
        );
        fs::write(
            &source,
            [
                json!({"timestamp":"2026-06-20T14:29:00Z","type":"session_meta","payload":{"id":"11111111-2222-3333-4444-555555555555"}}).to_string(),
                json!({"timestamp":"2026-06-20T14:30:12Z","type":"response_item","payload":{"type":"message","role":"user","content":handoff}}).to_string(),
            ]
            .join("\n"),
        )
        .expect("write source");

        let result = export_worklog_at(
            ExportWorklogRequest {
                source_path: source,
                parent_directory: root.clone(),
            },
            OffsetDateTime::parse("2026-06-22T10:00:00Z", &Rfc3339).expect("time"),
            utc_offset,
        )
        .expect("export succeeds");
        let bundle = PathBuf::from(result.bundle_path);
        let index = fs::read_to_string(bundle.join(INDEX_FILE)).expect("index");
        let unit = fs::read_to_string(bundle.join("001_143012.md")).expect("work unit");

        assert!(index.contains("## Referenced ChatGPT conversation"));
        assert!(index.contains("Title: `Design discussion`"));
        assert!(index.contains("Conversation ID: `conversation-1`"));
        assert!(index.contains("Preview available: yes"));
        assert!(unit.contains("Continue the implementation."));
        assert!(!unit.contains("Referenced ChatGPT conversation"));
        assert!(!unit.contains("private preview sentinel"));
        assert!(!unit.contains("Transport guidance."));

        fs::remove_dir_all(&root).expect("remove test root");
    }

    #[test]
    fn worklog_marks_null_or_empty_preview_as_unavailable() {
        let rendered = render_referenced_conversations(&[ReferencedConversation {
            conversation_id: Some("conversation-1".to_owned()),
            title: None,
            preview_available: false,
        }]);

        assert!(rendered.contains("Preview available: no"));
        assert!(rendered.contains("Title: `Not provided`"));
    }

    #[test]
    fn ambient_context_and_delegated_task_do_not_leak_into_worklog() {
        let root = test_root("transport-redaction");
        fs::create_dir_all(&root).expect("create test root");
        let source = root.join("11111111-2222-3333-4444-555555555555.jsonl");
        let delegated = concat!(
            "## Referenced ChatGPT conversation:\n",
            "Transport guidance sentinel.\n",
            r#"{"conversationId":"conversation-1","title":"Design discussion","priorConversation":{"conversation":[{"role":"user","content":[{"text":"preview body sentinel"}]}]}}"#,
            "\n## My request:\n",
            "Continuing from [Design discussion](chatgpt-conversation://conversation-1): delegated task sentinel."
        );
        let ambient = concat!(
            "<in-app-browser-context source=\"ambient-ui-state\">\n",
            "ambient URL and local path sentinel\n",
            "</in-app-browser-context>\n\n",
            "## My request:\n",
            "actual human request"
        );
        fs::write(
            &source,
            [
                json!({"timestamp":"2026-06-20T14:29:00Z","type":"session_meta","payload":{"id":"11111111-2222-3333-4444-555555555555"}}).to_string(),
                json!({"timestamp":"2026-06-20T14:30:00Z","type":"response_item","payload":{"type":"message","role":"user","content":delegated}}).to_string(),
                json!({"timestamp":"2026-06-20T14:31:00Z","type":"response_item","payload":{"type":"message","role":"user","content":ambient}}).to_string(),
            ]
            .join("\n"),
        )
        .expect("write source");

        let result = export_worklog_at(
            ExportWorklogRequest {
                source_path: source,
                parent_directory: root.clone(),
            },
            OffsetDateTime::parse("2026-06-22T10:00:00Z", &Rfc3339).expect("time"),
            utc_offset,
        )
        .expect("export succeeds");
        let bundle = PathBuf::from(result.bundle_path);
        let index = fs::read_to_string(bundle.join(INDEX_FILE)).expect("index");
        let unit = fs::read_to_string(bundle.join("001_143100.md")).expect("work unit");
        let exported = format!("{index}\n{unit}");

        assert!(index.contains("Conversation ID: `conversation-1`"));
        assert!(unit.contains("actual human request"));
        for hidden in [
            "Transport guidance sentinel",
            "preview body sentinel",
            "delegated task sentinel",
            "ambient URL and local path sentinel",
            "## My request:",
            "in-app-browser-context",
        ] {
            assert!(
                !exported.contains(hidden),
                "unexpected transport content: {hidden}"
            );
        }

        fs::remove_dir_all(&root).expect("remove test root");
    }

    #[test]
    fn guardian_export_is_rejected_before_writing_a_bundle() {
        let root = test_root("guardian-routing");
        fs::create_dir_all(&root).expect("create test root");
        let source = root.join("11111111-2222-3333-4444-555555555555.jsonl");
        fs::write(
            &source,
            concat!(
                r#"{"type":"session_meta","payload":{"thread_source":"guardian_review","source":{"subagent":{"other":"guardian"}}}}"#,
                "\n",
                r#"{"type":"response_item","payload":{"type":"message","role":"user","content":"guardian user sentinel"}}"#,
                "\n",
                r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":"guardian assistant sentinel"}}"#,
            ),
        )
        .expect("write guardian fixture");

        let error = export_worklog_at(
            ExportWorklogRequest {
                source_path: source,
                parent_directory: root.clone(),
            },
            OffsetDateTime::parse("2026-06-22T10:00:00Z", &Rfc3339).expect("time"),
            utc_offset,
        )
        .expect_err("guardian export is unavailable");

        assert_eq!(error.code, "worklog_export_unavailable");
        assert!(!root.join("codex-worklog").exists());

        fs::remove_dir_all(&root).expect("remove test root");
    }

    #[test]
    fn local_naming_uses_first_you_in_user_timezone_and_refreshes_corrected_target() {
        let root = test_root("local-naming");
        let source_directory = root.join("sessions").join("2026").join("06").join("20");
        fs::create_dir_all(&source_directory).expect("create source directory");
        let source = source_directory
            .join("rollout-2026-06-20T01-57-21-019ee0d0-d085-73e0-be17-470b13f43a9d.jsonl");
        let jsonl = [
            json!({"timestamp":"2026-06-19T16:57:21.867Z","type":"session_meta","payload":{"id":"019ee0d0-d085-73e0-be17-470b13f43a9d"}}).to_string(),
            json!({"timestamp":"2026-06-19T16:59:18.261Z","type":"event_msg","payload":{"type":"user_message","message":"first request"}}).to_string(),
            json!({"timestamp":"2026-06-19T16:59:20Z","type":"event_msg","payload":{"type":"agent_message","message":"first response"}}).to_string(),
            json!({"timestamp":"2026-06-19T17:03:45.393Z","type":"event_msg","payload":{"type":"user_message","message":"second request"}}).to_string(),
            json!({"timestamp":"2026-06-20T16:30:00Z","type":"event_msg","payload":{"type":"user_message","message":"crosses local midnight"}}).to_string(),
        ]
        .join("\n");
        fs::write(&source, jsonl).expect("write mismatch fixture");

        let old_utc_target = root
            .join("codex-worklog")
            .join("2026-06-19")
            .join("165918_session-019ee0d0");
        fs::create_dir_all(&old_utc_target).expect("create old UTC target");
        fs::write(old_utc_target.join("keep.txt"), "untouched").expect("write old marker");

        let request = || ExportWorklogRequest {
            source_path: source.clone(),
            parent_directory: root.clone(),
        };
        let export_time = OffsetDateTime::parse("2026-06-22T10:00:00Z", &Rfc3339).expect("time");
        let first = export_worklog_at(request(), export_time, korea_offset).expect("first export");
        let corrected_target = root
            .join("codex-worklog")
            .join("2026-06-20")
            .join("015918_session-019ee0d0");

        assert_eq!(PathBuf::from(&first.bundle_path), corrected_target);
        assert_eq!(
            first.generated_files,
            vec![
                "000_index.md",
                "001_015918.md",
                "002_020345.md",
                "003_013000.md",
                "manifest.json",
            ]
        );
        assert!(old_utc_target.join("keep.txt").exists());
        assert!(corrected_target.join("001_015918.md").exists());

        let refreshed =
            export_worklog_at(request(), export_time, korea_offset).expect("refresh export");
        assert!(refreshed.refreshed);
        assert_eq!(PathBuf::from(refreshed.bundle_path), corrected_target);
        assert!(old_utc_target.join("keep.txt").exists());

        fs::remove_dir_all(&root).expect("remove test root");
    }
}
