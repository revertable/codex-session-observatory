//! Immutable, file-backed Navigator snapshots. Reload is separate from loading
//! or refreshing a transcript; only the current snapshot is retained.
mod metadata;

use super::source;
use crate::{
    api::{ApiResult, ErrorResponseDto, SessionClassificationDto, navigator::*},
    inspection::{SessionClassification, inspect_reader},
    parser::jsonl::scan_conversation_activity,
};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    env, fs, io,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};
use time::{Date, Month};

pub const PAGE_SIZE: usize = 20;

pub fn codex_home() -> io::Result<PathBuf> {
    home_from_environment(
        env::var_os("CODEX_HOME"),
        env::var_os("USERPROFILE").or_else(|| env::var_os("HOME")),
    )
}

fn home_from_environment(
    codex: Option<std::ffi::OsString>,
    user: Option<std::ffi::OsString>,
) -> io::Result<PathBuf> {
    if let Some(home) = codex.filter(|value| !value.is_empty()) {
        return Ok(home.into());
    }
    user.filter(|value| !value.is_empty())
        .map(|value| PathBuf::from(value).join(".codex"))
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Codex home is unavailable"))
}

#[derive(Clone, Debug)]
pub struct NavigatorSnapshot {
    pub sessions_root: String,
    pub items: Vec<SessionSummaryDto>,
    pub diagnostics: NavigatorDiagnosticsDto,
}

fn warn(diagnostics: &mut NavigatorDiagnosticsDto, code: &str) {
    if !diagnostics.warnings.iter().any(|value| value == code) {
        diagnostics.warnings.push(code.into());
    }
}

/// Scans just the selected sessions root. Never walks archives, links or
/// reparse points, and never falls back from an explicitly configured home.
pub fn collect_snapshot(home: &Path) -> io::Result<NavigatorSnapshot> {
    let requested_root = home.join("sessions");
    let mut diagnostics = NavigatorDiagnosticsDto::default();
    let db = metadata::database(home, &mut diagnostics.warnings);
    let index = metadata::index(home, &mut diagnostics.warnings);
    let root = match fs::canonicalize(&requested_root) {
        Ok(root) if root.is_dir() => root,
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Sessions root is not a directory",
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            warn(&mut diagnostics, "sessions_root_missing");
            return Ok(NavigatorSnapshot {
                sessions_root: requested_root.to_string_lossy().into_owned(),
                items: Vec::new(),
                diagnostics,
            });
        }
        Err(error) => return Err(error),
    };
    let mut files = Vec::new();
    walk(&root, &root, &mut files, &mut diagnostics);
    files.sort();
    let mut observed_paths = HashSet::new();
    let mut by_identity: HashMap<String, SessionSummaryDto> = HashMap::new();
    for candidate in files {
        let path = match source::resolve_path(&candidate).and_then(|path| {
            if is_link(&path) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Linked session source",
                ));
            }
            fs::canonicalize(path)
        }) {
            Ok(path) if path.starts_with(&root) && !is_link(&path) => path,
            _ => {
                diagnostics.unreadable_files += 1;
                continue;
            }
        };
        if !observed_paths.insert(path.clone()) {
            diagnostics.duplicate_files += 1;
            continue;
        }
        let summary = match summarize(&path, &root, &db, &index) {
            Ok(Some(summary)) => summary,
            Ok(None) => {
                diagnostics.guardian_sessions += 1;
                continue;
            }
            Err(_) => {
                diagnostics.unreadable_files += 1;
                continue;
            }
        };
        match by_identity.entry(summary.entry_key.clone()) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(summary);
            }
            std::collections::hash_map::Entry::Occupied(mut entry) => {
                diagnostics.duplicate_files += 1;
                warn(&mut diagnostics, "duplicate_thread_id");
                let previous = entry.get();
                let rank = |item: &SessionSummaryDto| {
                    (
                        source::is_compressed(Path::new(&item.path)),
                        item.path.clone(),
                    )
                };
                if rank(&summary) < rank(previous) {
                    entry.insert(summary);
                }
            }
        }
    }
    let mut items = by_identity.into_values().collect::<Vec<_>>();
    items.sort_by(|left, right| {
        right
            .created_at_ms
            .cmp(&left.created_at_ms)
            .then_with(|| left.thread_id.cmp(&right.thread_id))
            .then_with(|| left.path.cmp(&right.path))
    });
    if diagnostics.unreadable_files > 0 {
        warn(&mut diagnostics, "session_files_unreadable");
    }
    if items.iter().any(|item| item.storage_date.is_none()) {
        warn(&mut diagnostics, "sessions_outside_date_layout");
    }
    Ok(NavigatorSnapshot {
        sessions_root: root.to_string_lossy().into_owned(),
        items,
        diagnostics,
    })
}

fn is_link(path: &Path) -> bool {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return true;
    };
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

fn walk(
    directory: &Path,
    root: &Path,
    files: &mut Vec<PathBuf>,
    diagnostics: &mut NavigatorDiagnosticsDto,
) {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => {
            warn(diagnostics, "session_directory_unreadable");
            return;
        }
    };
    for entry in entries {
        let Ok(entry) = entry else {
            warn(diagnostics, "session_directory_unreadable");
            continue;
        };
        let path = entry.path();
        if is_link(&path) {
            continue;
        }
        let Ok(canonical) = fs::canonicalize(&path) else {
            warn(diagnostics, "session_directory_unreadable");
            continue;
        };
        if !canonical.starts_with(root) {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            warn(diagnostics, "session_directory_unreadable");
            continue;
        };
        if kind.is_dir() {
            if !entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case("archived_sessions")
            {
                walk(&path, root, files, diagnostics);
            }
        } else if kind.is_file() && source::is_session_file(&path) {
            diagnostics.discovered_files += 1;
            files.push(path);
        }
    }
}

fn storage_date(path: &Path, root: &Path) -> Option<Date> {
    let parent = path.strip_prefix(root).ok()?.parent()?;
    let parts = parent
        .iter()
        .map(|value| value.to_str())
        .collect::<Option<Vec<_>>>()?;
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return None;
    }
    Date::from_calendar_date(
        parts[0].parse().ok()?,
        Month::try_from(parts[1].parse::<u8>().ok()?).ok()?,
        parts[2].parse().ok()?,
    )
    .ok()
}

fn summarize(
    path: &Path,
    root: &Path,
    db: &HashMap<String, metadata::ThreadMetadata>,
    index: &HashMap<String, String>,
) -> io::Result<Option<SessionSummaryDto>> {
    let inspection = inspect_reader(source::open_reader(path)?)?;
    if inspection.classification == SessionClassification::GuardianReview {
        return Ok(None);
    }
    let identity = inspection.identity;
    let id = identity.as_ref().and_then(|value| value.thread_id.clone());
    let activity = scan_conversation_activity(source::open_reader(path)?)?;
    let metadata = id.as_ref().and_then(|id| db.get(id));
    let indexed = id.as_ref().and_then(|id| index.get(id));
    let (title, title_source) = if let Some(name) = metadata.and_then(|value| value.name.as_ref()) {
        (name.clone(), TitleSource::DatabaseName)
    } else if let Some(name) = indexed {
        (name.clone(), TitleSource::SessionIndex)
    } else if let Some(title) = metadata.and_then(|value| value.title.as_ref()) {
        (title.clone(), TitleSource::DatabaseTitle)
    } else if let Some(id) = &id {
        (id.chars().take(8).collect(), TitleSource::ThreadId)
    } else {
        (
            path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            TitleSource::FileName,
        )
    };
    let date = storage_date(path, root);
    let db_created = metadata
        .and_then(|value| value.created_at_ms)
        .filter(|value| {
            time::OffsetDateTime::from_unix_timestamp_nanos(i128::from(*value) * 1_000_000).is_ok()
        });
    let (created_at_ms, created_at_source) = if let Some(timestamp) = db_created {
        (Some(timestamp), TimeSource::DatabaseCreatedAtMs)
    } else if let Some(timestamp) = activity.metadata_created_at_ms {
        (Some(timestamp), TimeSource::SessionMetadata)
    } else if let Some(timestamp) = activity.envelope_created_at_ms {
        (Some(timestamp), TimeSource::SessionEnvelope)
    } else if let Some(date) = date {
        (
            Some((date.midnight().assume_utc().unix_timestamp_nanos() / 1_000_000) as i64),
            TimeSource::StorageDate,
        )
    } else {
        (None, TimeSource::Unavailable)
    };
    let path_string = path.to_string_lossy().into_owned();
    Ok(Some(SessionSummaryDto {
        entry_key: id
            .as_ref()
            .map(|id| format!("thread:{id}"))
            .unwrap_or_else(|| format!("path:{}", source::plain_path(path).to_string_lossy())),
        thread_id: id,
        path: path_string,
        title,
        title_source,
        created_at_ms,
        created_at_source,
        last_conversation_at_ms: activity.last_conversation_at_ms,
        last_conversation_at_source: if activity.last_conversation_at_ms.is_some() {
            TimeSource::ConversationMessage
        } else {
            TimeSource::Unavailable
        },
        storage_date: date.map(|date| date.to_string()),
        classification: SessionClassificationDto::Unclassified,
        thread_source: identity.and_then(|value| value.thread_source),
    }))
}

#[derive(Debug)]
pub struct NavigatorService {
    instance: u128,
    generation: AtomicU64,
    current: Mutex<Option<(String, Arc<NavigatorSnapshot>)>>,
}
impl Default for NavigatorService {
    fn default() -> Self {
        Self {
            instance: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            generation: AtomicU64::new(0),
            current: Mutex::new(None),
        }
    }
}
fn error(code: &str, message: &str) -> ErrorResponseDto {
    ErrorResponseDto::new(code, message)
}
impl NavigatorService {
    /// Called before blocking I/O so a slow older reload cannot replace a newer request.
    pub fn begin_reload(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }
    pub fn install(
        &self,
        generation: u64,
        snapshot: NavigatorSnapshot,
    ) -> ApiResult<SessionPageDto> {
        let mut state = self
            .current
            .lock()
            .map_err(|_| error("navigator_unavailable", "Navigator state is unavailable."))?;
        if self.generation.load(Ordering::SeqCst) != generation {
            return Err(error(
                "navigator_reload_superseded",
                "A newer Navigator reload was requested.",
            ));
        }
        let id = format!("{:x}-{generation}", self.instance);
        if generation == 0
            || state
                .as_ref()
                .is_some_and(|(current_id, _)| current_id == &id)
        {
            return Err(error(
                "navigator_reload_superseded",
                "This reload has already been published.",
            ));
        }
        let snapshot = Arc::new(snapshot);
        let page = page(&id, &snapshot, 0);
        *state = Some((id, snapshot));
        Ok(page)
    }
    fn snapshot(&self, id: &str) -> ApiResult<Arc<NavigatorSnapshot>> {
        let state = self
            .current
            .lock()
            .map_err(|_| error("navigator_unavailable", "Navigator state is unavailable."))?;
        match state.as_ref() {
            Some((current_id, snapshot)) if current_id == id => Ok(Arc::clone(snapshot)),
            _ => Err(error(
                "navigator_snapshot_expired",
                "Reload the Navigator to obtain a current snapshot.",
            )),
        }
    }
    pub fn flat(&self, request: FlatSessionsRequestDto) -> ApiResult<SessionPageDto> {
        let snapshot = self.snapshot(&request.snapshot_id)?;
        let offset = match request.cursor {
            None => 0,
            Some(cursor) => cursor
                .strip_prefix(&format!("{}:", request.snapshot_id))
                .and_then(|offset| offset.parse::<usize>().ok())
                .filter(|offset| {
                    *offset > 0 && *offset % PAGE_SIZE == 0 && *offset < snapshot.items.len()
                })
                .ok_or_else(|| {
                    error(
                        "navigator_invalid_cursor",
                        "The cursor does not belong to this snapshot or page.",
                    )
                })?,
        };
        Ok(page(&request.snapshot_id, &snapshot, offset))
    }
    pub fn hierarchy(
        &self,
        request: HierarchicalSessionsRequestDto,
    ) -> ApiResult<SessionHierarchyDto> {
        let snapshot = self.snapshot(&request.snapshot_id)?;
        let mut grouped: BTreeMap<i32, BTreeMap<u8, BTreeMap<u8, Vec<SessionSummaryDto>>>> =
            BTreeMap::new();
        let mut unfiled_items = Vec::new();
        for item in &snapshot.items {
            let date = item.storage_date.as_deref().and_then(|date| {
                Date::parse(
                    date,
                    time::macros::format_description!("[year]-[month]-[day]"),
                )
                .ok()
            });
            if let Some(date) = date {
                grouped
                    .entry(date.year())
                    .or_default()
                    .entry(date.month() as u8)
                    .or_default()
                    .entry(date.day())
                    .or_default()
                    .push(item.clone());
            } else {
                unfiled_items.push(item.clone());
            }
        }
        let years = grouped
            .into_iter()
            .rev()
            .map(|(year, months)| SessionYearDto {
                year,
                months: months
                    .into_iter()
                    .rev()
                    .map(|(month, days)| SessionMonthDto {
                        month,
                        days: days
                            .into_iter()
                            .rev()
                            .map(|(day, items)| SessionDayDto { day, items })
                            .collect(),
                    })
                    .collect(),
            })
            .collect();
        Ok(SessionHierarchyDto {
            snapshot_id: request.snapshot_id,
            sessions_root: snapshot.sessions_root.clone(),
            total: snapshot.items.len(),
            years,
            unfiled_items,
            diagnostics: snapshot.diagnostics.clone(),
        })
    }
}
fn page(id: &str, snapshot: &NavigatorSnapshot, offset: usize) -> SessionPageDto {
    let end = (offset + PAGE_SIZE).min(snapshot.items.len());
    let has_more = end < snapshot.items.len();
    SessionPageDto {
        snapshot_id: id.into(),
        sessions_root: snapshot.sessions_root.clone(),
        total: snapshot.items.len(),
        items: snapshot.items[offset..end].to_vec(),
        next_cursor: has_more.then(|| format!("{id}:{end}")),
        has_more,
        diagnostics: snapshot.diagnostics.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configured_home_is_authoritative_even_when_missing_and_blank_uses_default() {
        assert_eq!(
            home_from_environment(
                Some("explicit-nonexistent-home".into()),
                Some("user-home".into())
            )
            .unwrap(),
            PathBuf::from("explicit-nonexistent-home")
        );
        assert_eq!(
            home_from_environment(Some("".into()), Some("user-home".into())).unwrap(),
            PathBuf::from("user-home").join(".codex")
        );
        assert!(home_from_environment(None, None).is_err());
    }
}
