use std::{
    collections::HashSet,
    env, fs, io,
    path::{Path, PathBuf},
};

use super::source;
use crate::inspection::inspect_reader;

const SESSION_STORE_NAMES: [&str; 2] = ["sessions", "archived_sessions"];

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SessionLocation {
    Found(PathBuf),
    NotFound,
    Ambiguous,
    Unavailable,
}

pub fn locate_parent_session(current_file: &Path, parent_thread_id: &str) -> SessionLocation {
    let roots = observable_session_roots(current_file);
    locate_session_in_roots(parent_thread_id, &roots)
}

pub fn observable_session_roots(current_file: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(root) = containing_session_store(current_file) {
        candidates.push(root);
    }

    if let Some(codex_home) = env::var_os("CODEX_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        add_standard_stores(&mut candidates, &codex_home);
    }

    if let Some(user_home) = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        add_standard_stores(&mut candidates, &user_home.join(".codex"));
    }

    canonical_existing_directories(candidates)
}

pub fn locate_session_in_roots(parent_thread_id: &str, roots: &[PathBuf]) -> SessionLocation {
    let parent_thread_id = parent_thread_id.trim();
    if parent_thread_id.is_empty() {
        return SessionLocation::NotFound;
    }

    let roots = canonical_existing_directories(roots.iter().cloned());
    if roots.is_empty() {
        return SessionLocation::NotFound;
    }

    let mut matches = HashSet::new();
    let mut search_complete = true;

    for root in roots {
        scan_directory(&root, parent_thread_id, &mut matches, &mut search_complete);
    }

    if matches.len() > 1 {
        SessionLocation::Ambiguous
    } else if !search_complete {
        SessionLocation::Unavailable
    } else if let Some(path) = matches.into_iter().next() {
        SessionLocation::Found(path)
    } else {
        SessionLocation::NotFound
    }
}

fn add_standard_stores(candidates: &mut Vec<PathBuf>, codex_home: &Path) {
    candidates.extend(SESSION_STORE_NAMES.iter().map(|name| codex_home.join(name)));
}

fn containing_session_store(path: &Path) -> Option<PathBuf> {
    path.ancestors().find_map(|ancestor| {
        let name = ancestor.file_name()?.to_str()?;
        SESSION_STORE_NAMES
            .iter()
            .any(|candidate| name.eq_ignore_ascii_case(candidate))
            .then(|| ancestor.to_path_buf())
    })
}

fn canonical_existing_directories(candidates: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut observed = HashSet::new();
    let mut roots = Vec::new();

    for candidate in candidates {
        if !candidate.is_dir() {
            continue;
        }
        let Ok(canonical) = fs::canonicalize(candidate) else {
            continue;
        };
        if observed.insert(canonical.clone()) {
            roots.push(canonical);
        }
    }

    roots
}

fn scan_directory(
    directory: &Path,
    parent_thread_id: &str,
    matches: &mut HashSet<PathBuf>,
    search_complete: &mut bool,
) {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => {
            *search_complete = false;
            return;
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                *search_complete = false;
                continue;
            }
        };
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => {
                *search_complete = false;
                continue;
            }
        };

        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            scan_directory(&entry.path(), parent_thread_id, matches, search_complete);
            continue;
        }
        if !file_type.is_file() || !source::is_session_file(&entry.path()) {
            continue;
        }

        match file_matches_thread_id(&entry.path(), parent_thread_id) {
            Ok(true) => match source::resolve_path(&entry.path()).and_then(fs::canonicalize) {
                Ok(path) => {
                    matches.insert(path);
                }
                Err(_) => *search_complete = false,
            },
            Ok(false) => {}
            Err(_) => *search_complete = false,
        }
    }
}

fn file_matches_thread_id(path: &Path, parent_thread_id: &str) -> io::Result<bool> {
    let inspection = inspect_reader(source::open_reader(path)?)?;
    Ok(inspection
        .identity
        .and_then(|identity| identity.thread_id)
        .is_some_and(|thread_id| thread_id == parent_thread_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("session-locator-tests")
            .join(format!("{name}-{nonce}"))
    }

    fn write_session(path: &Path, thread_id: &str) {
        fs::create_dir_all(path.parent().expect("session parent")).expect("create session parent");
        fs::write(
            path,
            format!(
                "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{thread_id}\",\"originator\":\"codex_cli\"}}}}\n"
            ),
        )
        .expect("write session");
    }

    #[test]
    fn locates_parent_by_metadata_id_across_date_directories() {
        let root = test_root("different-dates").join("sessions");
        let parent = root
            .join("2026")
            .join("09")
            .join("09")
            .join("renamed-parent.jsonl");
        let child = root
            .join("2026")
            .join("09")
            .join("17")
            .join("guardian-child.jsonl");
        write_session(&parent, "parent-thread");
        write_session(&child, "child-thread");

        assert_eq!(
            locate_session_in_roots("parent-thread", std::slice::from_ref(&root)),
            SessionLocation::Found(fs::canonicalize(&parent).expect("canonical parent"))
        );
        let canonical_root = fs::canonicalize(&root).expect("canonical root");
        assert_eq!(
            observable_session_roots(&child)
                .first()
                .map(PathBuf::as_path),
            Some(canonical_root.as_path())
        );

        fs::remove_dir_all(root.parent().expect("test root")).expect("remove test root");
    }

    #[test]
    fn missing_parent_is_reported_without_guessing_a_path() {
        let root = test_root("missing").join("sessions");
        write_session(&root.join("2026/09/17/child.jsonl"), "child-thread");

        assert_eq!(
            locate_session_in_roots("missing-parent", std::slice::from_ref(&root)),
            SessionLocation::NotFound
        );

        fs::remove_dir_all(root.parent().expect("test root")).expect("remove test root");
    }

    #[test]
    fn duplicate_metadata_ids_are_ambiguous() {
        let base = test_root("ambiguous");
        let sessions = base.join("sessions");
        let archived = base.join("archived_sessions");
        write_session(&sessions.join("2026/09/17/first.jsonl"), "parent-thread");
        write_session(&archived.join("second.jsonl"), "parent-thread");

        assert_eq!(
            locate_session_in_roots("parent-thread", &[sessions, archived]),
            SessionLocation::Ambiguous
        );

        fs::remove_dir_all(base).expect("remove test root");
    }
}
