use backend::{
    api::{self, FilterDto, LocateParentSessionRequestDto, ParseRequestDto},
    session::{
        self,
        locator::{self, SessionLocation},
        source,
    },
};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const ID: &str = "11111111-2222-4333-8444-555555555555";
const CHILD: &str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/compressed-tests")
            .join(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
                    .to_string(),
            );
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }
    fn write(&self, relative: &str, bytes: &[u8]) -> PathBuf {
        let path = self.0.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes).unwrap();
        path
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn ordinary() -> String {
    format!("{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{ID}\",\"source\":\"cli\"}}}}\n")
        + "{\"timestamp\":\"2026-10-20T01:00:00Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"synthetic request **bold**\"}}\n"
        + "{\"timestamp\":\"2026-10-20T01:00:10Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"agent_message\",\"message\":\"synthetic response\"}}\n"
}
fn guardian() -> String {
    format!(
        "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{CHILD}\",\"parent_thread_id\":\"{ID}\",\"thread_source\":\"guardian_review\"}}}}\n"
    ) + &ordinary()
}
fn compressed(text: &str) -> Vec<u8> {
    zstd::stream::encode_all(text.as_bytes(), 3).unwrap()
}
fn parse(path: &Path) -> api::ParseResponseDto {
    api::parse_selected_file(ParseRequestDto {
        path: path.to_string_lossy().into_owned(),
        filter: FilterDto::default(),
    })
    .unwrap()
}

#[test]
fn plain_and_compressed_use_identical_identity_classification_and_transcript() {
    let f = Fixture::new();
    for (label, text) in [(ID, ordinary()), (CHILD, guardian())] {
        let plain = f.write(&format!("plain/{label}.jsonl"), text.as_bytes());
        let packed = f.write(&format!("packed/{label}.jsonl.zst"), &compressed(&text));
        let a = parse(&plain);
        let b = parse(&packed);
        assert_eq!(a.session, b.session);
        assert_eq!(a.parsed_chat_log.to_json(), b.parsed_chat_log.to_json());
        assert_eq!(a.source.session_id, b.source.session_id);
        if label == CHILD {
            assert!(b.parsed_chat_log.transcript_blocks.is_empty());
            assert!(!b.session.capabilities.can_export_worklog);
        }
    }
}

#[test]
fn refresh_resolves_both_directions_and_prefers_plain_siblings() {
    let f = Fixture::new();
    let plain = f.write(&format!("{ID}.jsonl"), ordinary().as_bytes());
    let expected = parse(&plain).parsed_chat_log.to_json();
    let packed = f.write(&format!("{ID}.jsonl.zst"), &compressed(&ordinary()));
    assert_eq!(source::resolve_path(&packed).unwrap(), plain);
    fs::remove_file(&plain).unwrap();
    assert_eq!(parse(&plain).parsed_chat_log.to_json(), expected);
    assert!(parse(&plain).source.absolute_path.ends_with(".jsonl.zst"));
    f.write(&format!("{ID}.jsonl"), ordinary().as_bytes());
    fs::remove_file(&packed).unwrap();
    assert_eq!(parse(&packed).parsed_chat_log.to_json(), expected);
}

#[test]
fn guardian_navigation_finds_compressed_parent_and_deduplicates_siblings() {
    let f = Fixture::new();
    let parent = f.write(
        &format!("sessions/2026/10/20/{ID}.jsonl.zst"),
        &compressed(&ordinary()),
    );
    let child = f.write(
        &format!("sessions/2026/10/21/{CHILD}.jsonl.zst"),
        &compressed(&guardian()),
    );
    let roots = [f.0.join("sessions")];
    assert_eq!(
        locator::locate_session_in_roots(ID, &roots),
        SessionLocation::Found(fs::canonicalize(&parent).unwrap())
    );
    // The transport must inspect a compressed Guardian before searching.
    let result = api::locate_parent_session_for_transport(LocateParentSessionRequestDto {
        current_path: child.to_string_lossy().into_owned(),
        parent_thread_id: ID.into(),
    })
    .unwrap();
    assert!(result.path.is_some());
    let plain = f.write(
        &format!("sessions/2026/10/20/{ID}.jsonl"),
        ordinary().as_bytes(),
    );
    assert_eq!(
        locator::locate_session_in_roots(ID, &roots),
        SessionLocation::Found(fs::canonicalize(plain).unwrap())
    );
}

#[test]
fn malformed_truncated_and_missing_sources_return_errors() {
    let f = Fixture::new();
    let bad = f.write("bad.jsonl.zst", b"not zstandard");
    assert!(session::load_file(&bad).is_err());
    for text in [ordinary(), guardian()] {
        let mut bytes = compressed(&text);
        bytes.pop();
        let cut = f.write("cut.jsonl.zst", &bytes);
        assert!(session::load_file(&cut).is_err());
    }
    assert!(source::open_reader(&f.0.join("missing.jsonl")).is_err());
    assert!(source::open_reader(&f.0).is_err());
    let error = api::parse_selected_file(ParseRequestDto {
        path: bad.to_string_lossy().into_owned(),
        filter: FilterDto::default(),
    })
    .unwrap_err();
    assert_eq!(error.to_json()["error"]["code"], "parse_file_failed");
}

#[test]
fn repeated_reads_do_not_modify_source_or_create_plain_files() {
    let f = Fixture::new();
    let path = f.write(&format!("{ID}.jsonl.zst"), &compressed(&ordinary()));
    let before = fs::metadata(&path).unwrap();
    let bytes = fs::read(&path).unwrap();
    for _ in 0..2 {
        parse(&path);
        let mut decoded = String::new();
        source::open_reader(&path)
            .unwrap()
            .read_to_string(&mut decoded)
            .unwrap();
        assert_eq!(decoded, ordinary());
    }
    let after = fs::metadata(&path).unwrap();
    assert_eq!(bytes, fs::read(&path).unwrap());
    assert_eq!(before.modified().unwrap(), after.modified().unwrap());
    assert_eq!(before.created().ok(), after.created().ok());
    assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
    assert!(!source::plain_path(&path).exists());
}

#[cfg(windows)]
#[test]
fn sharing_violation_is_reported_without_falling_back_to_a_sibling() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    let path = f.write("locked.jsonl", ordinary().as_bytes());
    f.write("locked.jsonl.zst", &compressed(&ordinary()));
    let _exclusive = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&path)
        .unwrap();
    assert!(source::open_reader(&path).is_err());
    assert!(session::load_file(&path).is_err());
}

#[test]
fn corrupt_export_and_guardian_export_do_not_create_output() {
    use backend::export::{ExportWorklogRequest, export_worklog};
    let f = Fixture::new();
    for (name, bytes) in [
        ("bad.jsonl.zst", b"broken".to_vec()),
        ("guardian.jsonl.zst", compressed(&guardian())),
    ] {
        let path = f.write(name, &bytes);
        assert!(
            export_worklog(ExportWorklogRequest {
                source_path: path,
                parent_directory: f.0.clone()
            })
            .is_err()
        );
        assert!(!f.0.join("codex-worklog").exists());
    }
}

/// Opt-in local compatibility check. No private fixture or body is persisted or
/// included in assertion output.
#[test]
#[ignore = "requires OBSERVATORY_SESSION_SMOKE_PATH pointing to a private compressed sample"]
fn local_compressed_sample_is_read_only_and_matches_in_memory_loading() {
    let path =
        PathBuf::from(std::env::var_os("OBSERVATORY_SESSION_SMOKE_PATH").expect("sample path"));
    assert!(source::is_compressed(&path));
    let before = fs::metadata(&path).unwrap();
    let original = fs::read(&path).unwrap();
    let mut decoded = Vec::new();
    source::open_reader(&path)
        .unwrap()
        .read_to_end(&mut decoded)
        .unwrap();
    let actual = session::load_file(&path).unwrap();
    assert!(
        actual == session::load_bytes(&decoded),
        "decoded and streamed session results differ"
    );
    let after = fs::metadata(&path).unwrap();
    assert!(original == fs::read(&path).unwrap(), "source bytes changed");
    assert_eq!(before.modified().unwrap(), after.modified().unwrap());
    assert_eq!(before.created().ok(), after.created().ok());
    assert!(
        !source::plain_path(&path).exists(),
        "plain file was materialized"
    );
}
