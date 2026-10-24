use backend::{
    api::navigator::*,
    parser::jsonl::{parse_str, scan_conversation_activity},
    session::{
        navigator::{NavigatorService, collect_snapshot},
        source,
    },
};
use rusqlite::Connection;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/navigator-tests")
            .join(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
                    .to_string(),
            );
        fs::create_dir_all(path.join("sessions")).unwrap();
        Self(path)
    }
    fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.0.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes).unwrap();
        path
    }
    fn session(&self, name: &str, id: &str, kind: &str) -> PathBuf {
        let text = log(id, kind);
        let bytes = if name.ends_with(".zst") {
            zstd::stream::encode_all(text.as_bytes(), 3).unwrap()
        } else {
            text.into_bytes()
        };
        self.write(name, &bytes)
    }
    fn database(&self) -> Connection {
        let db = Connection::open(self.0.join("state_5.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE threads(id TEXT PRIMARY KEY, name TEXT, title TEXT, created_at_ms INTEGER, updated_at_ms INTEGER, recency_at_ms INTEGER)").unwrap();
        db
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn lines(values: Vec<Value>) -> String {
    values
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}
fn log(id: &str, kind: &str) -> String {
    lines(vec![
        json!({"type":"session_meta","timestamp":"2026-10-01T02:00:00Z","payload":{"id":id,"session_id":"not-the-thread-id","thread_source":kind,"timestamp":"2026-10-01T01:00:00Z"}}),
        json!({"type":"event_msg","timestamp":"2026-10-02T01:00:00Z","payload":{"type":"user_message","message":"Synthetic human request"}}),
        json!({"type":"event_msg","timestamp":"2026-10-03T01:00:00Z","payload":{"type":"agent_message","message":"Synthetic assistant reply"}}),
    ])
}
fn flat_request(id: &str, cursor: Option<String>) -> FlatSessionsRequestDto {
    FlatSessionsRequestDto {
        snapshot_id: id.into(),
        cursor,
    }
}

#[test]
fn context_targets_revalidate_identity_formats_and_snapshot_without_changing_the_list() {
    let f = Fixture::new();
    let plain = f.session("sessions/2026/10/01/a.jsonl", "one", "user");
    let compressed = f.session("sessions/2026/10/01/b.jsonl.zst", "two", "chatgpt_handoff");
    let service = NavigatorService::default();
    let page = service
        .install(service.begin_reload(), collect_snapshot(&f.0).unwrap())
        .unwrap();
    let target = |key: &str| NavigatorTargetRequestDto {
        snapshot_id: page.snapshot_id.clone(),
        entry_key: key.into(),
    };
    assert_eq!(
        service.resolve_target(target("thread:one")).unwrap(),
        fs::canonicalize(&plain).unwrap()
    );
    assert_eq!(
        service.resolve_target(target("thread:two")).unwrap(),
        fs::canonicalize(&compressed).unwrap()
    );
    assert_eq!(
        service
            .resolve_target(target("thread:missing"))
            .unwrap_err()
            .error
            .code,
        "navigator_entry_missing"
    );
    f.session("sessions/2026/10/01/a.jsonl.zst", "one", "user");
    fs::remove_file(&plain).unwrap();
    assert!(
        service
            .resolve_target(target("thread:one"))
            .unwrap()
            .to_string_lossy()
            .ends_with(".jsonl.zst")
    );
    f.session("sessions/2026/10/01/a.jsonl", "replacement", "user");
    assert_eq!(
        service
            .resolve_target(target("thread:one"))
            .unwrap_err()
            .error
            .code,
        "navigator_source_changed"
    );
    fs::remove_file(&compressed).unwrap();
    assert_eq!(
        service
            .resolve_target(target("thread:two"))
            .unwrap_err()
            .error
            .code,
        "navigator_source_unavailable"
    );
    assert_eq!(
        service.flat(flat_request(&page.snapshot_id, None)).unwrap(),
        page
    );
    service
        .install(service.begin_reload(), collect_snapshot(&f.0).unwrap())
        .unwrap();
    assert_eq!(
        service
            .resolve_target(target("thread:one"))
            .unwrap_err()
            .error
            .code,
        "navigator_snapshot_expired"
    );
}

#[test]
fn context_target_rejects_replaced_guardian_and_non_file_sources() {
    let f = Fixture::new();
    let path = f.session("sessions/a.jsonl", "one", "user");
    let service = NavigatorService::default();
    let page = service
        .install(service.begin_reload(), collect_snapshot(&f.0).unwrap())
        .unwrap();
    let request = NavigatorTargetRequestDto {
        snapshot_id: page.snapshot_id,
        entry_key: "thread:one".into(),
    };
    f.session("sessions/a.jsonl", "one", "guardian_review");
    assert_eq!(
        service
            .resolve_target(request.clone())
            .unwrap_err()
            .error
            .code,
        "navigator_source_changed"
    );
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert_eq!(
        service.resolve_target(request).unwrap_err().error.code,
        "navigator_source_unavailable"
    );
}
fn timestamp(value: &str) -> i64 {
    (time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .unwrap()
        .unix_timestamp_nanos()
        / 1_000_000) as i64
}

#[test]
fn discovers_both_formats_deduplicates_by_metadata_id_and_excludes_guardians_and_archives() {
    let f = Fixture::new();
    f.session("sessions/2026/10/01/plain.jsonl", "one", "user");
    f.session("sessions/2026/10/01/plain.jsonl.zst", "one", "user");
    f.session("sessions/2026/10/02/renamed.jsonl.zst", "one", "user");
    f.session(
        "sessions/2026/10/02/handoff.jsonl.zst",
        "two",
        "chatgpt_handoff",
    );
    f.session(
        "sessions/2026/10/03/guardian.jsonl.zst",
        "guardian",
        "guardian_review",
    );
    f.session("archived_sessions/old.jsonl.zst", "archive", "user");
    f.session("sessions/archived_sessions/nested.jsonl", "nested", "user");
    let snapshot = collect_snapshot(&f.0).unwrap();
    assert_eq!(snapshot.items.len(), 2);
    assert_eq!(snapshot.diagnostics.discovered_files, 5);
    assert_eq!(snapshot.diagnostics.duplicate_files, 2);
    assert_eq!(snapshot.diagnostics.guardian_sessions, 1);
    assert!(
        snapshot
            .items
            .iter()
            .any(|item| item.thread_source.as_deref() == Some("chatgpt_handoff"))
    );
    assert!(
        snapshot
            .items
            .iter()
            .find(|item| item.thread_id.as_deref() == Some("one"))
            .unwrap()
            .path
            .ends_with("plain.jsonl")
    );
    assert!(
        !snapshot
            .items
            .iter()
            .any(|item| item.thread_id.as_deref() == Some("not-the-thread-id"))
    );
}

#[test]
fn title_precedence_uses_last_valid_index_row_and_falls_back_without_an_id() {
    let f = Fixture::new();
    let db = f.database();
    for id in ["name", "index", "title", "short-thread-id"] {
        f.session(&format!("sessions/2026/10/01/{id}.jsonl"), id, "user");
    }
    db.execute("INSERT INTO threads(id,name,title) VALUES('name','DB name','DB title'),('index','  ','DB title'),('title',NULL,'DB title')",[]).unwrap();
    drop(db);
    let mut index=b"{\"id\":\"name\",\"thread_name\":\"Index name\"}\n{\"id\":\"index\",\"thread_name\":\"Old\"}\n".to_vec();
    index.extend(b"\xff invalid\n{\"id\":\"index\",\"thread_name\":\"Last valid\"}\n{\"id\":\"index\",\"thread_name\":\" \"}\n{broken\n");
    f.write("session_index.jsonl", &index);
    f.write(
        "sessions/2026/10/01/legacy.jsonl",
        b"{\"role\":\"user\",\"content\":\"Legacy request\"}\n",
    );
    let before = fs::read(f.0.join("state_5.sqlite")).unwrap();
    let snapshot = collect_snapshot(&f.0).unwrap();
    for (id, title, source) in [
        ("name", "DB name", TitleSource::DatabaseName),
        ("index", "Last valid", TitleSource::SessionIndex),
        ("title", "DB title", TitleSource::DatabaseTitle),
        ("short-thread-id", "short-th", TitleSource::ThreadId),
    ] {
        let item = snapshot
            .items
            .iter()
            .find(|item| item.thread_id.as_deref() == Some(id))
            .unwrap();
        assert_eq!(item.title, title);
        assert_eq!(item.title_source, source);
    }
    let legacy = snapshot
        .items
        .iter()
        .find(|item| item.thread_id.is_none())
        .unwrap();
    assert_eq!(legacy.title, "legacy.jsonl");
    assert_eq!(legacy.title_source, TitleSource::FileName);
    assert_eq!(
        fs::read(f.0.join("state_5.sqlite")).unwrap(),
        before,
        "database modified"
    );
}

#[test]
fn creation_sort_ignores_updates_settings_and_new_conversations_and_breaks_ties() {
    let f = Fixture::new();
    let db = f.database();
    for (id, created) in [("b", 2000), ("a", 2000), ("c", 1000)] {
        f.session(&format!("sessions/2026/10/20/{id}.jsonl"), id, "user");
        db.execute("INSERT INTO threads(id,created_at_ms,updated_at_ms,recency_at_ms) VALUES(?1,?2,999999,999999)",rusqlite::params![id,created]).unwrap();
    }
    let before = collect_snapshot(&f.0).unwrap();
    let order = |snapshot: &backend::session::navigator::NavigatorSnapshot| {
        snapshot
            .items
            .iter()
            .map(|item| item.thread_id.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        order(&before),
        vec![Some("a".into()), Some("b".into()), Some("c".into())]
    );
    let path = f.0.join("sessions/2026/10/20/c.jsonl");
    let mut text = fs::read_to_string(&path).unwrap();
    text += &lines(vec![
        json!({"type":"event_msg","timestamp":"2026-10-23T23:00:00Z","payload":{"type":"thread_settings_applied"}}),
    ]);
    fs::write(&path, &text).unwrap();
    let settings = collect_snapshot(&f.0).unwrap();
    assert_eq!(order(&before), order(&settings));
    assert_eq!(
        before.items[2].last_conversation_at_ms,
        settings.items[2].last_conversation_at_ms
    );
    text += &lines(vec![
        json!({"type":"event_msg","timestamp":"2026-10-23T03:00:00Z","payload":{"type":"user_message","message":"New request"}}),
    ]);
    fs::write(&path, text).unwrap();
    let after = collect_snapshot(&f.0).unwrap();
    assert_eq!(order(&before), order(&after));
    assert_eq!(
        after.items[2].last_conversation_at_ms,
        Some(timestamp("2026-10-23T03:00:00Z"))
    );
    db.execute(
        "UPDATE threads SET updated_at_ms=123456789,recency_at_ms=123456789",
        [],
    )
    .unwrap();
    drop(db);
    assert_eq!(order(&after), order(&collect_snapshot(&f.0).unwrap()));
}

#[test]
fn creation_fallbacks_and_storage_dates_are_separate() {
    let f = Fixture::new();
    f.session("sessions/2026/10/20/meta.jsonl", "meta", "user");
    f.write("sessions/2026/10/20/envelope.jsonl",lines(vec![json!({"type":"session_meta","timestamp":"2026-09-10T02:00:00Z","payload":{"id":"envelope"}})]).as_bytes());
    f.write(
        "sessions/2026/10/20/folder.jsonl",
        b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"folder\"}}\n",
    );
    f.write(
        "sessions/unfiled.jsonl",
        b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"unfiled\"}}\n",
    );
    let snapshot = collect_snapshot(&f.0).unwrap();
    for (id, source, date) in [
        (
            "meta",
            TimeSource::SessionMetadata,
            Some(timestamp("2026-10-01T01:00:00Z")),
        ),
        (
            "envelope",
            TimeSource::SessionEnvelope,
            Some(timestamp("2026-09-10T02:00:00Z")),
        ),
        (
            "folder",
            TimeSource::StorageDate,
            Some(timestamp("2026-10-20T00:00:00Z")),
        ),
        ("unfiled", TimeSource::Unavailable, None),
    ] {
        let item = snapshot
            .items
            .iter()
            .find(|item| item.thread_id.as_deref() == Some(id))
            .unwrap();
        assert_eq!(item.created_at_source, source);
        assert_eq!(item.created_at_ms, date);
        if id != "unfiled" {
            assert_eq!(item.storage_date.as_deref(), Some("2026-10-20"));
        }
    }
    assert!(snapshot.items.last().unwrap().created_at_ms.is_none());
}

#[test]
fn activity_reuses_human_context_and_question_rules_without_counting_other_events() {
    let human = json!({"type":"response_item","timestamp":"2026-10-05T02:00:00+09:00","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Actual request"}]}});
    let assistant = json!({"type":"response_item","timestamp":"2026-10-05T03:00:00+09:00","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Actual answer"}]}});
    let text = lines(vec![
        human,
        assistant,
        json!({"type":"event_msg","timestamp":"2026-10-20T00:00:00Z","payload":{"type":"user_message","message":"# AGENTS.md instructions for synthetic\n\n<INSTRUCTIONS>\nContext only\n</INSTRUCTIONS>"}}),
        json!({"type":"event_msg","timestamp":"2026-10-21T00:00:00Z","payload":{"type":"thread_settings_applied"}}),
        json!({"type":"response_item","timestamp":"2026-10-22T00:00:00Z","payload":{"type":"function_call_output","output":"Tool output"}}),
        json!({"type":"event_msg","timestamp":"2026-10-23T00:00:00Z","payload":{"type":"task_complete"}}),
    ]);
    let activity = scan_conversation_activity(Cursor::new(text.as_bytes())).unwrap();
    assert_eq!(
        activity.last_conversation_at_ms,
        Some(timestamp("2026-10-05T03:00:00+09:00"))
    );
    let parsed = parse_str(&text);
    let expected = parsed
        .entries
        .iter()
        .zip(parsed.entry_timestamps.iter())
        .filter(|(entry, _)| {
            matches!(
                entry.kind,
                backend::domain::RenderedEntryKind::You | backend::domain::RenderedEntryKind::Codex
            )
        })
        .filter_map(|(_, time)| time.as_deref())
        .map(timestamp)
        .max();
    assert_eq!(activity.last_conversation_at_ms, expected);
    let question = lines(vec![
        json!({"type":"event_msg","timestamp":"2026-10-06T01:00:00Z","payload":{"type":"item_completed","item":{"id":"q","questions":[{"title":"Choose","options":["A","B"]}]}}}),
    ]);
    assert_eq!(
        scan_conversation_activity(Cursor::new(question))
            .unwrap()
            .last_conversation_at_ms,
        Some(timestamp("2026-10-06T01:00:00Z"))
    );
    let legacy = lines(vec![
        json!({"role":"model","timestamp":"2026-10-07T01:00:00Z","content":"Legacy answer"}),
    ]);
    assert_eq!(
        scan_conversation_activity(Cursor::new(legacy))
            .unwrap()
            .last_conversation_at_ms,
        Some(timestamp("2026-10-07T01:00:00Z"))
    );
}

#[test]
fn stable_message_replay_uses_transcript_replacement_rules_instead_of_restore_time() {
    let text = lines(vec![
        json!({"type":"event_msg","timestamp":"2026-10-01T00:00:00Z","payload":{"id":"same-message","type":"user_message","message":"Stable request"}}),
        json!({"type":"response_item","timestamp":"2026-10-02T00:00:00Z","payload":{"id":"same-message","type":"message","role":"user","content":"Stable request"}}),
        json!({"type":"response_item","timestamp":"2026-10-23T00:00:00Z","payload":{"id":"same-message","type":"message","role":"user","content":"Stable request"}}),
    ]);
    let activity = scan_conversation_activity(Cursor::new(&text)).unwrap();
    assert_eq!(
        activity.last_conversation_at_ms,
        Some(timestamp("2026-10-02T00:00:00Z"))
    );
    let parsed = parse_str(&text);
    let expected = parsed
        .entries
        .iter()
        .zip(&parsed.entry_timestamps)
        .filter(|(entry, _)| {
            matches!(
                entry.kind,
                backend::domain::RenderedEntryKind::You | backend::domain::RenderedEntryKind::Codex
            )
        })
        .filter_map(|(_, time)| time.as_deref())
        .map(timestamp)
        .max();
    assert_eq!(activity.last_conversation_at_ms, expected);
}

#[test]
fn pages_remain_immutable_and_hierarchy_shares_membership_until_explicit_reload() {
    let f = Fixture::new();
    for n in 0..45 {
        f.session(
            &format!("sessions/2026/10/20/{n:03}.jsonl.zst"),
            &format!("id-{n:03}"),
            "user",
        );
    }
    fs::create_dir_all(f.0.join("sessions/2025/01/01")).unwrap();
    f.session(
        "sessions/2024/01/01/guardian.jsonl",
        "guardian",
        "guardian_review",
    );
    let service = NavigatorService::default();
    let first = service
        .install(service.begin_reload(), collect_snapshot(&f.0).unwrap())
        .unwrap();
    assert_eq!(first.items.len(), 20);
    f.session("sessions/2026/10/21/new.jsonl", "new", "user");
    fs::remove_file(f.0.join("sessions/2026/10/20/000.jsonl.zst")).unwrap();
    let second = service
        .flat(flat_request(&first.snapshot_id, first.next_cursor.clone()))
        .unwrap();
    let third = service
        .flat(flat_request(&first.snapshot_id, second.next_cursor.clone()))
        .unwrap();
    assert_eq!(second.items.len(), 20);
    assert_eq!(third.items.len(), 5);
    assert!(!third.has_more);
    assert!(third.next_cursor.is_none());
    let ids = first
        .items
        .iter()
        .chain(&second.items)
        .chain(&third.items)
        .map(|item| item.entry_key.clone())
        .collect::<HashSet<_>>();
    assert_eq!(ids.len(), 45);
    let tree = service
        .hierarchy(HierarchicalSessionsRequestDto {
            snapshot_id: first.snapshot_id.clone(),
        })
        .unwrap();
    assert_eq!(tree.years.len(), 1);
    assert_eq!(tree.years[0].year, 2026);
    assert_eq!(tree.years[0].months[0].days.len(), 1);
    let treeids = tree
        .years
        .iter()
        .flat_map(|year| &year.months)
        .flat_map(|month| &month.days)
        .flat_map(|day| &day.items)
        .map(|item| item.entry_key.clone())
        .collect::<HashSet<_>>();
    assert_eq!(ids, treeids);
    assert!(
        service
            .flat(flat_request(&first.snapshot_id, Some("foreign:20".into())))
            .is_err()
    );
    assert!(
        service
            .flat(flat_request(
                &first.snapshot_id,
                Some(format!("{}:21", first.snapshot_id))
            ))
            .is_err()
    );
    let next = service
        .install(service.begin_reload(), collect_snapshot(&f.0).unwrap())
        .unwrap();
    assert_ne!(next.snapshot_id, first.snapshot_id);
    assert!(
        service
            .flat(flat_request(&first.snapshot_id, None))
            .is_err()
    );
    assert!(
        service
            .hierarchy(HierarchicalSessionsRequestDto {
                snapshot_id: first.snapshot_id
            })
            .is_err()
    );
    let reloaded = service
        .hierarchy(HierarchicalSessionsRequestDto {
            snapshot_id: next.snapshot_id,
        })
        .unwrap();
    assert_eq!(reloaded.years[0].months[0].days.len(), 2);
}

#[test]
fn superseded_reload_cannot_replace_newer_snapshot_and_empty_pages_are_valid() {
    let f = Fixture::new();
    let service = NavigatorService::default();
    let old = service.begin_reload();
    let new = service.begin_reload();
    let page = service
        .install(new, collect_snapshot(&f.0).unwrap())
        .unwrap();
    assert!(
        service
            .install(new, collect_snapshot(&f.0).unwrap())
            .is_err(),
        "publishing the same reload twice must not mutate a snapshot"
    );
    assert_eq!(page.total, 0);
    assert!(!page.has_more);
    assert!(
        service
            .install(old, collect_snapshot(&f.0).unwrap())
            .is_err()
    );
    assert_eq!(
        service.flat(flat_request(&page.snapshot_id, None)).unwrap(),
        page
    );
}

#[test]
fn optional_sources_and_schema_failures_never_hide_actual_files() {
    let f = Fixture::new();
    f.session("sessions/2026/10/20/sample.jsonl.zst", "sample", "user");
    let snapshot = collect_snapshot(&f.0).unwrap();
    assert_eq!(snapshot.items.len(), 1);
    assert!(!f.0.join("state_5.sqlite").exists());
    assert!(
        snapshot
            .diagnostics
            .warnings
            .contains(&"database_unavailable".into())
    );
    f.write("state_5.sqlite", b"not a sqlite database");
    fs::create_dir(f.0.join("session_index.jsonl")).unwrap();
    let snapshot = collect_snapshot(&f.0).unwrap();
    assert_eq!(snapshot.items.len(), 1);
    assert!(
        snapshot
            .diagnostics
            .warnings
            .iter()
            .any(|warning| warning.starts_with("session_index_"))
    );
    fs::remove_file(f.0.join("state_5.sqlite")).unwrap();
    let db = Connection::open(f.0.join("state_5.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE threads(id TEXT PRIMARY KEY, title TEXT); INSERT INTO threads VALUES('sample','Legacy title');").unwrap();
    drop(db);
    let snapshot = collect_snapshot(&f.0).unwrap();
    assert_eq!(snapshot.items[0].title, "Legacy title");
    assert!(
        snapshot
            .diagnostics
            .warnings
            .contains(&"database_schema_partial".into())
    );
    f.write(
        "sessions/2026/10/20/corrupt.jsonl.zst",
        b"invalid compressed data",
    );
    let snapshot = collect_snapshot(&f.0).unwrap();
    assert_eq!(snapshot.items.len(), 1);
    assert_eq!(snapshot.diagnostics.unreadable_files, 1);
}

#[test]
fn wal_committed_metadata_is_visible_and_sources_are_not_modified() {
    let f = Fixture::new();
    let db = f.database();
    db.pragma_update(None, "journal_mode", "WAL").unwrap();
    db.execute(
        "INSERT INTO threads(id,name,created_at_ms) VALUES('sample','WAL title',123456789)",
        [],
    )
    .unwrap();
    let path = f.session("sessions/2026/10/20/sample.jsonl.zst", "sample", "user");
    let bytes = fs::read(&path).unwrap();
    let meta = fs::metadata(&path).unwrap();
    let snapshot = collect_snapshot(&f.0).unwrap();
    assert_eq!(snapshot.items[0].title, "WAL title");
    assert_eq!(snapshot.items[0].created_at_ms, Some(123456789));
    assert_eq!(bytes, fs::read(&path).unwrap());
    assert_eq!(
        meta.modified().unwrap(),
        fs::metadata(&path).unwrap().modified().unwrap()
    );
    assert_eq!(
        meta.created().ok(),
        fs::metadata(&path).unwrap().created().ok()
    );
    assert!(!source::plain_path(&path).exists());
    drop(db);
}

#[test]
fn missing_root_is_empty_and_unfiled_sessions_remain_available_in_both_modes() {
    let f = Fixture::new();
    let service = NavigatorService::default();
    let missing = collect_snapshot(&f.0.join("missing-home")).unwrap();
    assert!(missing.items.is_empty());
    assert!(!f.0.join("missing-home").exists());
    f.session("sessions/unfiled.jsonl", "unfiled", "user");
    let page = service
        .install(service.begin_reload(), collect_snapshot(&f.0).unwrap())
        .unwrap();
    let tree = service
        .hierarchy(HierarchicalSessionsRequestDto {
            snapshot_id: page.snapshot_id,
        })
        .unwrap();
    assert!(tree.years.is_empty());
    assert_eq!(tree.unfiled_items.len(), 1);
}

#[cfg(windows)]
#[test]
fn sharing_failures_in_database_and_index_keep_file_listing_available() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    let db = f.database();
    drop(db);
    let index = f.write(
        "session_index.jsonl",
        b"{\"id\":\"sample\",\"thread_name\":\"Index title\"}\n",
    );
    f.session("sessions/2026/10/20/sample.jsonl", "sample", "user");
    let _db_lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(f.0.join("state_5.sqlite"))
        .unwrap();
    let _index_lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(index)
        .unwrap();
    let snapshot = collect_snapshot(&f.0).unwrap();
    assert_eq!(snapshot.items.len(), 1);
    assert_eq!(snapshot.items[0].title_source, TitleSource::ThreadId);
    assert!(
        snapshot
            .diagnostics
            .warnings
            .contains(&"database_unavailable".into())
    );
    assert!(
        snapshot
            .diagnostics
            .warnings
            .contains(&"session_index_unavailable".into())
    );
}

#[test]
fn guardian_source_classification_is_preserved_without_thread_source() {
    let f = Fixture::new();
    f.write("sessions/2026/10/20/guardian.jsonl",lines(vec![json!({"type":"session_meta","payload":{"id":"guardian","source":{"subagent":{"other":"guardian"}}}})]).as_bytes());
    let snapshot = collect_snapshot(&f.0).unwrap();
    assert!(snapshot.items.is_empty());
    assert_eq!(snapshot.diagnostics.guardian_sessions, 1);
}

#[test]
fn activity_excludes_delegation_transport_and_counts_only_real_handoff_request() {
    let text = lines(vec![
        json!({"type":"response_item","timestamp":"2026-10-23T10:00:00Z","payload":{"type":"message","role":"user","content":"<in-app-browser-context source=\"ambient-ui-state\">\nAutomatic context\n</in-app-browser-context>\n\n## My request:\nActual handoff request"}}),
    ]);
    // The scanner shares even conservative fallback decisions with the parser.
    let parsed = parse_str(&text);
    let activity = scan_conversation_activity(Cursor::new(&text)).unwrap();
    let expected = parsed
        .entries
        .iter()
        .zip(&parsed.entry_timestamps)
        .filter(|(entry, _)| {
            matches!(
                entry.kind,
                backend::domain::RenderedEntryKind::You | backend::domain::RenderedEntryKind::Codex
            )
        })
        .filter_map(|(_, time)| time.as_deref())
        .map(timestamp)
        .max();
    assert_eq!(activity.last_conversation_at_ms, expected);
    assert_eq!(
        activity.last_conversation_at_ms,
        Some(timestamp("2026-10-23T10:00:00Z"))
    );
    let delegated = "## Referenced ChatGPT conversation:\nTransport guidance.\n{\"conversationId\":\"synthetic-conversation\",\"title\":\"Synthetic title\"}\n## My request:\nContinuing from [Synthetic title](chatgpt-conversation://synthetic-conversation): delegated task.";
    let text = lines(vec![
        json!({"type":"response_item","timestamp":"2026-10-24T10:00:00Z","payload":{"type":"message","role":"user","content":delegated}}),
    ]);
    assert_eq!(
        scan_conversation_activity(Cursor::new(text))
            .unwrap()
            .last_conversation_at_ms,
        None
    );
    let empty = log("sample", "user")
        .lines()
        .take(1)
        .collect::<Vec<_>>()
        .join("\n");
    assert_eq!(
        scan_conversation_activity(Cursor::new(empty))
            .unwrap()
            .last_conversation_at_ms,
        None
    );
}

/// Local observation is opt-in and never fixes the session count to a historical
/// value or prints titles, message bodies, or per-session paths.
#[test]
#[ignore = "requires OBSERVATORY_NAVIGATOR_HOME for a read-only local audit"]
fn local_navigator_matches_independent_file_inventory() {
    use backend::inspection::{SessionClassification, inspect_reader};
    let home =
        PathBuf::from(std::env::var_os("OBSERVATORY_NAVIGATOR_HOME").expect("local Codex home"));
    let mut all = Vec::new();
    let mut pending = vec![home.join("sessions")];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory).unwrap() {
            let entry = entry.unwrap();
            let kind = entry.file_type().unwrap();
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() && source::is_session_file(&entry.path()) {
                all.push(entry.path());
            }
        }
    }
    let before = all
        .iter()
        .map(|path| {
            let meta = fs::metadata(path).unwrap();
            (
                path.clone(),
                meta.len(),
                meta.modified().unwrap(),
                meta.created().ok(),
            )
        })
        .collect::<Vec<_>>();
    let mut seen = HashSet::new();
    let mut expected = HashSet::new();
    let mut guardians = 0;
    for path in &all {
        let physical = fs::canonicalize(source::resolve_path(path).unwrap()).unwrap();
        if !seen.insert(physical.clone()) {
            continue;
        }
        let inspection = inspect_reader(source::open_reader(&physical).unwrap()).unwrap();
        if inspection.classification == SessionClassification::GuardianReview {
            guardians += 1;
            continue;
        }
        if let Some(id) = inspection.identity.and_then(|identity| identity.thread_id) {
            expected.insert(id);
        }
    }
    let start = std::time::Instant::now();
    let snapshot = collect_snapshot(&home).unwrap();
    let actual = snapshot
        .items
        .iter()
        .filter_map(|item| item.thread_id.clone())
        .collect::<HashSet<_>>();
    assert!(
        actual == expected,
        "Navigator membership differs from independent inventory"
    );
    assert_eq!(snapshot.diagnostics.unreadable_files, 0);
    // The current conversation keeps appending while this read-only audit runs.
    // Report concurrent source changes; do not misattribute them to the reader.
    // Strict non-mutation assertions belong to the controlled synthetic fixtures.
    let mut concurrent_changes = 0;
    for (path, length, modified, created) in before {
        match fs::metadata(path) {
            Ok(meta)
                if meta.len() == length
                    && meta.modified().ok() == Some(modified)
                    && meta.created().ok() == created => {}
            _ => concurrent_changes += 1,
        }
    }
    println!("concurrently_changed_sources={concurrent_changes}");
    println!(
        "local audit: plain={}, compressed={}, unique_files={}, guardians={}, navigator={}, elapsed_ms={}, warnings={:?}",
        all.iter()
            .filter(|path| !source::is_compressed(path))
            .count(),
        all.iter()
            .filter(|path| source::is_compressed(path))
            .count(),
        seen.len(),
        guardians,
        snapshot.items.len(),
        start.elapsed().as_millis(),
        snapshot.diagnostics.warnings
    );
}
