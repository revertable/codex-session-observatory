use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::Serialize;
use serde_json::Value;

use crate::{
    domain::{ChatEntryFilter, ParsedChatLog, ReferencedConversation, RenderedEntryKind},
    inspection::{SessionClassification, SessionIdentity, SessionSourceIdentity, inspect_reader},
    session,
    session::locator::SessionLocation,
};

const SESSION_ID_HEX_GROUPS: [usize; 5] = [8, 4, 4, 4, 12];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParseRequestDto {
    pub path: String,
    pub filter: FilterDto,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FilterDto {
    pub show_you: bool,
    pub show_codex: bool,
    pub show_tool_call: bool,
    pub show_tool_result: bool,
    pub show_meta: bool,
}

impl Default for FilterDto {
    fn default() -> Self {
        Self::from(ChatEntryFilter::all())
    }
}

impl From<FilterDto> for ChatEntryFilter {
    fn from(filter: FilterDto) -> Self {
        Self {
            show_you: filter.show_you,
            show_codex: filter.show_codex,
            show_tool_call: filter.show_tool_call,
            show_tool_result: filter.show_tool_result,
            show_meta: filter.show_meta,
        }
    }
}

impl From<ChatEntryFilter> for FilterDto {
    fn from(filter: ChatEntryFilter) -> Self {
        Self {
            show_you: filter.show_you,
            show_codex: filter.show_codex,
            show_tool_call: filter.show_tool_call,
            show_tool_result: filter.show_tool_result,
            show_meta: filter.show_meta,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ParseResponseDto {
    pub source: LoadedFileMetadataDto,
    pub session: SessionDescriptorDto,
    pub parsed_chat_log: ParsedChatLogDto,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SessionDescriptorDto {
    pub classification: SessionClassificationDto,
    pub identity: Option<SessionIdentityDto>,
    pub capabilities: SessionCapabilitiesDto,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionClassificationDto {
    Unclassified,
    GuardianReview,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SessionIdentityDto {
    pub thread_id: Option<String>,
    pub session_id: Option<String>,
    pub parent_thread_id: Option<String>,
    pub originator: Option<String>,
    pub thread_source: Option<String>,
    pub source: SessionSourceDto,
    pub history_mode: Option<String>,
    pub subagent_history_start_ordinal: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SessionSourceDto {
    pub kind: &'static str,
    pub value: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct SessionCapabilitiesDto {
    pub can_show_transcript: bool,
    pub can_resume: bool,
    pub can_export_worklog: bool,
    pub can_open_parent_session: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocateParentSessionRequestDto {
    pub current_path: String,
    pub parent_thread_id: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ParentSessionLocationStatusDto {
    Found,
    NotFound,
    Ambiguous,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct LocateParentSessionResponseDto {
    pub status: ParentSessionLocationStatusDto,
    pub path: Option<String>,
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct LoadedFileMetadataDto {
    pub file_name: Option<String>,
    pub absolute_path: String,
    pub session_id: Option<String>,
    pub resume_command: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ParsedChatLogDto {
    pub entries: Vec<RenderedEntryDto>,
    pub transcript_blocks: Vec<TranscriptBlockDto>,
    pub referenced_conversations: Vec<ReferencedConversationDto>,
    pub counters: ParseCountersDto,
    pub observed_event_counts: Vec<ObservedEventCountDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RenderedEntryDto {
    pub kind: EntryKindDto,
    pub label: &'static str,
    pub content: Arc<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct TranscriptBlockDto {
    pub entry_type: EntryKindDto,
    pub label: &'static str,
    pub title: &'static str,
    pub timestamp: Option<String>,
    pub content: Arc<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ReferencedConversationDto {
    pub conversation_id: Option<String>,
    pub title: Option<String>,
    pub preview_available: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKindDto {
    Context,
    Task,
    You,
    Codex,
    ToolCall,
    ToolResult,
    System,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ParseCountersDto {
    pub parsed_candidates: usize,
    pub total_entries: usize,
    pub visible_entries: usize,
    pub ignored_lines: usize,
    pub malformed_lines: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ObservedEventCountDto {
    pub event: String,
    pub count: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ErrorResponseDto {
    pub error: ApiErrorDto,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ApiErrorDto {
    pub code: String,
    pub message: String,
}

pub type ApiResult<T> = Result<T, ErrorResponseDto>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParseBoundaryRequest {
    pub path: String,
    pub filter: Option<FilterDto>,
}

pub fn parse_for_transport(request: ParseBoundaryRequest) -> ApiResult<ParseResponseDto> {
    parse_selected_file(ParseRequestDto {
        path: request.path,
        filter: request.filter.unwrap_or_default(),
    })
}

pub fn parse_selected_file(request: ParseRequestDto) -> ApiResult<ParseResponseDto> {
    let path = PathBuf::from(&request.path);
    let loaded = session::load_file(&path).map_err(ErrorResponseDto::from_io)?;
    let route_capabilities = loaded.descriptor.capabilities();
    let mut source = LoadedFileMetadataDto::from_path(&path).map_err(ErrorResponseDto::from_io)?;
    if !route_capabilities.can_resume {
        source.resume_command = None;
    }
    let session = SessionDescriptorDto::from_domain(
        &loaded.descriptor,
        route_capabilities.can_resume && source.resume_command.is_some(),
    );
    let parsed = loaded.into_compatible_chat_log();
    let filter = ChatEntryFilter::from(request.filter);

    Ok(ParseResponseDto {
        source,
        session,
        parsed_chat_log: ParsedChatLogDto::from_domain_owned(parsed, &filter),
    })
}

pub fn locate_parent_session_for_transport(
    request: LocateParentSessionRequestDto,
) -> ApiResult<LocateParentSessionResponseDto> {
    let current_path = PathBuf::from(&request.current_path);
    let current_file = fs::File::open(&current_path).map_err(ErrorResponseDto::from_io)?;
    let inspection = inspect_reader(current_file).map_err(ErrorResponseDto::from_io)?;
    let observed_parent_thread_id = inspection
        .identity
        .as_ref()
        .and_then(|identity| identity.parent_thread_id.as_deref());

    if inspection.classification != SessionClassification::GuardianReview
        || observed_parent_thread_id != Some(request.parent_thread_id.trim())
    {
        return Err(ErrorResponseDto::new(
            "parent_session_navigation_unavailable",
            "The selected file does not expose the requested Guardian parent session.",
        ));
    }

    Ok(LocateParentSessionResponseDto::from_domain(
        session::locator::locate_parent_session(&current_path, &request.parent_thread_id),
    ))
}

pub fn project_parsed_chat_log(
    parsed: &ParsedChatLog,
    filter: Option<FilterDto>,
) -> ParsedChatLogDto {
    let filter = filter.unwrap_or_default();
    ParsedChatLogDto::from_domain(parsed, &ChatEntryFilter::from(filter))
}

fn serialize_dto<T: Serialize>(dto: &T) -> Value {
    serde_json::to_value(dto).expect("API DTO serialization is infallible")
}

impl LoadedFileMetadataDto {
    pub fn from_path(path: &Path) -> io::Result<Self> {
        let absolute_path = absolute_path(path)?;
        let session_id = detect_session_id(path);
        let resume_command = session_id
            .as_ref()
            .map(|session_id| format!("codex resume {session_id}"));

        Ok(Self {
            file_name: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned()),
            absolute_path: absolute_path.to_string_lossy().into_owned(),
            session_id,
            resume_command,
        })
    }
}

impl ParseResponseDto {
    pub fn to_json(&self) -> Value {
        serialize_dto(self)
    }
}

impl SessionDescriptorDto {
    fn from_domain(descriptor: &session::SessionDescriptor, can_resume: bool) -> Self {
        let capabilities = descriptor.capabilities();
        Self {
            classification: SessionClassificationDto::from(descriptor.classification),
            identity: descriptor
                .identity
                .as_ref()
                .map(SessionIdentityDto::from_domain),
            capabilities: SessionCapabilitiesDto {
                can_show_transcript: capabilities.can_show_transcript,
                can_resume,
                can_export_worklog: capabilities.can_export_worklog,
                can_open_parent_session: capabilities.can_open_parent_session,
            },
        }
    }

    pub fn to_json(&self) -> Value {
        serialize_dto(self)
    }
}

impl From<SessionClassification> for SessionClassificationDto {
    fn from(classification: SessionClassification) -> Self {
        match classification {
            SessionClassification::Unclassified => Self::Unclassified,
            SessionClassification::GuardianReview => Self::GuardianReview,
        }
    }
}

impl SessionClassificationDto {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unclassified => "unclassified",
            Self::GuardianReview => "guardian_review",
        }
    }
}

impl SessionIdentityDto {
    fn from_domain(identity: &SessionIdentity) -> Self {
        Self {
            thread_id: identity.thread_id.clone(),
            session_id: identity.session_id.clone(),
            parent_thread_id: identity.parent_thread_id.clone(),
            originator: identity.originator.clone(),
            thread_source: identity.thread_source.clone(),
            source: SessionSourceDto::from_domain(&identity.source),
            history_mode: identity.history_mode.clone(),
            subagent_history_start_ordinal: identity.subagent_history_start_ordinal,
        }
    }
}

impl SessionSourceDto {
    fn from_domain(source: &SessionSourceIdentity) -> Self {
        match source {
            SessionSourceIdentity::Named(value) => Self {
                kind: "named",
                value: Some(value.clone()),
            },
            SessionSourceIdentity::Subagent(value) => Self {
                kind: "subagent",
                value: Some(value.clone()),
            },
            SessionSourceIdentity::Unknown => Self {
                kind: "unknown",
                value: None,
            },
        }
    }
}

impl LocateParentSessionResponseDto {
    fn from_domain(location: SessionLocation) -> Self {
        match location {
            SessionLocation::Found(path) => Self {
                status: ParentSessionLocationStatusDto::Found,
                path: Some(path.to_string_lossy().into_owned()),
                message: "Parent session found locally.".to_owned(),
            },
            SessionLocation::NotFound => Self {
                status: ParentSessionLocationStatusDto::NotFound,
                path: None,
                message: "Parent session not found locally.".to_owned(),
            },
            SessionLocation::Ambiguous => Self {
                status: ParentSessionLocationStatusDto::Ambiguous,
                path: None,
                message: "A unique parent session could not be identified locally.".to_owned(),
            },
            SessionLocation::Unavailable => Self {
                status: ParentSessionLocationStatusDto::Unavailable,
                path: None,
                message: "The local parent session search could not be completed reliably."
                    .to_owned(),
            },
        }
    }

    pub fn to_json(&self) -> Value {
        serialize_dto(self)
    }
}

impl ParentSessionLocationStatusDto {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Found => "found",
            Self::NotFound => "not_found",
            Self::Ambiguous => "ambiguous",
            Self::Unavailable => "unavailable",
        }
    }
}

impl LoadedFileMetadataDto {
    pub fn to_json(&self) -> Value {
        serialize_dto(self)
    }
}

impl ParsedChatLogDto {
    pub fn from_domain(parsed: &ParsedChatLog, filter: &ChatEntryFilter) -> Self {
        let mut entries = Vec::new();
        let mut transcript_blocks = Vec::new();
        for (index, entry) in parsed
            .entries
            .iter()
            .enumerate()
            .filter(|(_, entry)| filter.allows(entry.kind))
        {
            push_entry_dtos(
                &mut entries,
                &mut transcript_blocks,
                entry.kind,
                parsed.entry_timestamps.get(index).cloned().flatten(),
                Arc::new(entry.content.clone()),
            );
        }
        let visible_entries = entries.len();
        let referenced_conversations = parsed
            .session_provenance
            .referenced_conversations
            .iter()
            .map(ReferencedConversationDto::from_domain)
            .collect();
        let observed_event_counts = parsed
            .observed_event_counts
            .iter()
            .map(|(event, count)| ObservedEventCountDto {
                event: event.clone(),
                count: *count,
            })
            .collect();

        Self {
            entries,
            transcript_blocks,
            referenced_conversations,
            counters: ParseCountersDto {
                parsed_candidates: parsed.parsed_candidates,
                total_entries: parsed.entries.len(),
                visible_entries,
                ignored_lines: parsed.ignored_lines,
                malformed_lines: parsed.malformed_lines,
            },
            observed_event_counts,
        }
    }

    pub fn from_domain_owned(parsed: ParsedChatLog, filter: &ChatEntryFilter) -> Self {
        let total_entries = parsed.entries.len();
        let entry_timestamps = parsed.entry_timestamps;
        let mut entries = Vec::new();
        let mut transcript_blocks = Vec::new();
        for (index, entry) in parsed
            .entries
            .into_iter()
            .enumerate()
            .filter(|(_, entry)| filter.allows(entry.kind))
        {
            push_entry_dtos(
                &mut entries,
                &mut transcript_blocks,
                entry.kind,
                entry_timestamps.get(index).cloned().flatten(),
                Arc::new(entry.content),
            );
        }
        let visible_entries = entries.len();
        let referenced_conversations = parsed
            .session_provenance
            .referenced_conversations
            .into_iter()
            .map(|reference| ReferencedConversationDto {
                conversation_id: reference.conversation_id,
                title: reference.title,
                preview_available: reference.preview_available,
            })
            .collect();
        let observed_event_counts = parsed
            .observed_event_counts
            .into_iter()
            .map(|(event, count)| ObservedEventCountDto { event, count })
            .collect();

        Self {
            entries,
            transcript_blocks,
            referenced_conversations,
            counters: ParseCountersDto {
                parsed_candidates: parsed.parsed_candidates,
                total_entries,
                visible_entries,
                ignored_lines: parsed.ignored_lines,
                malformed_lines: parsed.malformed_lines,
            },
            observed_event_counts,
        }
    }

    pub fn to_json(&self) -> Value {
        serialize_dto(self)
    }
}

fn push_entry_dtos(
    entries: &mut Vec<RenderedEntryDto>,
    transcript_blocks: &mut Vec<TranscriptBlockDto>,
    kind: RenderedEntryKind,
    timestamp: Option<String>,
    content: Arc<String>,
) {
    let label = kind.label();
    entries.push(RenderedEntryDto {
        kind: EntryKindDto::from(kind),
        label,
        content: Arc::clone(&content),
    });
    transcript_blocks.push(TranscriptBlockDto {
        entry_type: EntryKindDto::from(kind),
        label,
        title: label,
        timestamp,
        content,
    });
}

impl RenderedEntryDto {
    pub fn to_json(&self) -> Value {
        serialize_dto(self)
    }
}

impl ReferencedConversationDto {
    fn from_domain(reference: &ReferencedConversation) -> Self {
        Self {
            conversation_id: reference.conversation_id.clone(),
            title: reference.title.clone(),
            preview_available: reference.preview_available,
        }
    }
}

impl TranscriptBlockDto {
    pub fn to_json(&self) -> Value {
        serialize_dto(self)
    }
}

impl From<RenderedEntryKind> for EntryKindDto {
    fn from(kind: RenderedEntryKind) -> Self {
        match kind {
            RenderedEntryKind::Context => Self::Context,
            RenderedEntryKind::Task => Self::Task,
            RenderedEntryKind::You => Self::You,
            RenderedEntryKind::Codex => Self::Codex,
            RenderedEntryKind::ToolCall => Self::ToolCall,
            RenderedEntryKind::ToolResult => Self::ToolResult,
            RenderedEntryKind::System => Self::System,
        }
    }
}

impl EntryKindDto {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Context => "context",
            Self::Task => "task",
            Self::You => "you",
            Self::Codex => "codex",
            Self::ToolCall => "tool_call",
            Self::ToolResult => "tool_result",
            Self::System => "system",
        }
    }
}

impl ParseCountersDto {
    pub fn to_json(&self) -> Value {
        serialize_dto(self)
    }
}

impl ObservedEventCountDto {
    pub fn to_json(&self) -> Value {
        serialize_dto(self)
    }
}

impl ErrorResponseDto {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            error: ApiErrorDto {
                code: code.into(),
                message: message.into(),
            },
        }
    }

    pub fn from_io(error: io::Error) -> Self {
        Self::new("parse_file_failed", error.to_string())
    }

    pub fn to_json(&self) -> Value {
        serialize_dto(self)
    }
}

fn absolute_path(path: &Path) -> io::Result<PathBuf> {
    match fs::canonicalize(path) {
        Ok(path) => Ok(path),
        Err(_) if path.is_absolute() => Ok(path.to_path_buf()),
        Err(_) => Ok(std::env::current_dir()?.join(path)),
    }
}

fn detect_session_id(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .and_then(first_uuid)
        .or_else(|| {
            path.ancestors()
                .skip(1)
                .filter_map(|ancestor| ancestor.file_name()?.to_str())
                .find_map(first_uuid)
        })
}

fn first_uuid(value: &str) -> Option<String> {
    value
        .char_indices()
        .filter_map(|(start, character)| character.is_ascii_hexdigit().then_some(start))
        .find_map(|start| uuid_at(value, start))
}

fn uuid_at(value: &str, start: usize) -> Option<String> {
    let bytes = value.as_bytes();
    let mut index = start;

    if start > 0 && is_word_byte(bytes[start - 1]) {
        return None;
    }

    for (group_index, group_len) in SESSION_ID_HEX_GROUPS.iter().enumerate() {
        for _ in 0..*group_len {
            if index >= bytes.len() || !bytes[index].is_ascii_hexdigit() {
                return None;
            }
            index += 1;
        }

        if group_index < SESSION_ID_HEX_GROUPS.len() - 1 {
            if index >= bytes.len() || bytes[index] != b'-' {
                return None;
            }
            index += 1;
        }
    }

    if index < bytes.len() && is_word_byte(bytes[index]) {
        return None;
    }

    Some(value[start..index].to_owned())
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{
        ReferencedConversation, RenderedEntry, RenderedEntryKind, SessionProvenance,
    };
    use indexmap::IndexMap;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn api_test_file(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("api-tests")
            .join(format!("{name}-{nonce}"))
            .join("11111111-2222-3333-4444-555555555555.jsonl")
    }

    fn parsed_log() -> ParsedChatLog {
        let mut observed_event_counts = IndexMap::new();
        observed_event_counts.insert("event_msg/user_message".to_owned(), 2);
        observed_event_counts.insert("response_item/message".to_owned(), 1);

        ParsedChatLog {
            entries: vec![
                RenderedEntry {
                    kind: RenderedEntryKind::You,
                    content: "hello".to_owned(),
                },
                RenderedEntry {
                    kind: RenderedEntryKind::Codex,
                    content: "hi".to_owned(),
                },
                RenderedEntry {
                    kind: RenderedEntryKind::ToolCall,
                    content: "run tests".to_owned(),
                },
                RenderedEntry {
                    kind: RenderedEntryKind::Task,
                    content: "task".to_owned(),
                },
                RenderedEntry {
                    kind: RenderedEntryKind::System,
                    content: "session".to_owned(),
                },
            ],
            entry_timestamps: vec![
                Some("2026-09-18T23:59:58Z".to_owned()),
                Some("2026-09-19T00:00:02Z".to_owned()),
                None,
                Some("2026-09-20T08:15:00+09:00".to_owned()),
                None,
            ],
            session_provenance: SessionProvenance::default(),
            parsed_candidates: 5,
            ignored_lines: 3,
            malformed_lines: 1,
            observed_event_counts,
        }
    }

    fn ordinary_session(can_resume: bool) -> SessionDescriptorDto {
        SessionDescriptorDto {
            classification: SessionClassificationDto::Unclassified,
            identity: None,
            capabilities: SessionCapabilitiesDto {
                can_show_transcript: true,
                can_resume,
                can_export_worklog: true,
                can_open_parent_session: false,
            },
        }
    }

    #[test]
    fn parsed_chat_log_dto_preserves_domain_counts_and_visible_count() {
        let dto = ParsedChatLogDto::from_domain(
            &parsed_log(),
            &ChatEntryFilter {
                show_tool_call: false,
                show_meta: false,
                ..ChatEntryFilter::all()
            },
        );

        assert_eq!(dto.counters.parsed_candidates, 5);
        assert_eq!(dto.counters.total_entries, 5);
        assert_eq!(dto.counters.visible_entries, 2);
        assert_eq!(dto.counters.ignored_lines, 3);
        assert_eq!(dto.counters.malformed_lines, 1);
        assert_eq!(
            dto.entries
                .iter()
                .map(|entry| entry.kind)
                .collect::<Vec<_>>(),
            vec![EntryKindDto::You, EntryKindDto::Codex]
        );
        assert_eq!(dto.entries[0].label, "[YOU]");
        assert_eq!(dto.transcript_blocks[1].title, "[CODEX]");
        assert_eq!(
            dto.transcript_blocks[0].timestamp.as_deref(),
            Some("2026-09-18T23:59:58Z")
        );
        assert_eq!(
            dto.transcript_blocks[1].timestamp.as_deref(),
            Some("2026-09-19T00:00:02Z")
        );
        assert!(Arc::ptr_eq(
            &dto.entries[0].content,
            &dto.transcript_blocks[0].content
        ));
        assert_eq!(
            dto.observed_event_counts,
            vec![
                ObservedEventCountDto {
                    event: "event_msg/user_message".to_owned(),
                    count: 2,
                },
                ObservedEventCountDto {
                    event: "response_item/message".to_owned(),
                    count: 1,
                }
            ]
        );
    }

    #[test]
    fn dto_keeps_visible_entries_when_timestamp_vector_is_shorter() {
        let mut parsed = parsed_log();
        parsed.entry_timestamps.truncate(1);

        let dto = ParsedChatLogDto::from_domain_owned(parsed, &ChatEntryFilter::all());

        assert_eq!(dto.transcript_blocks.len(), 5);
        assert_eq!(
            dto.transcript_blocks[0].timestamp.as_deref(),
            Some("2026-09-18T23:59:58Z")
        );
        assert!(
            dto.transcript_blocks[1..]
                .iter()
                .all(|block| block.timestamp.is_none())
        );
    }

    #[test]
    fn api_projects_minimal_session_reference_without_preview_body() {
        let mut parsed = parsed_log();
        parsed.session_provenance = SessionProvenance {
            referenced_conversations: vec![ReferencedConversation {
                conversation_id: Some("conversation-1".to_owned()),
                title: Some("Design discussion".to_owned()),
                preview_available: true,
            }],
        };

        let dto = ParsedChatLogDto::from_domain(&parsed, &ChatEntryFilter::all());
        let json = dto.to_json();
        let reference = &json["referenced_conversations"][0];

        assert_eq!(reference["conversation_id"], "conversation-1");
        assert_eq!(reference["title"], "Design discussion");
        assert_eq!(reference["preview_available"], true);
        assert!(reference.get("preview_messages").is_none());
    }

    #[test]
    fn api_filter_treats_task_as_meta_for_source_app_parity() {
        let dto = ParsedChatLogDto::from_domain(
            &parsed_log(),
            &ChatEntryFilter {
                show_you: false,
                show_meta: true,
                ..ChatEntryFilter::all()
            },
        );

        assert_eq!(
            dto.entries
                .iter()
                .map(|entry| entry.kind)
                .collect::<Vec<_>>(),
            vec![
                EntryKindDto::Codex,
                EntryKindDto::ToolCall,
                EntryKindDto::Task,
                EntryKindDto::System,
            ]
        );
    }

    #[test]
    fn serialized_contract_uses_stable_field_names_and_entry_kinds() {
        let response = ParseResponseDto {
            source: LoadedFileMetadataDto {
                file_name: Some("session.jsonl".to_owned()),
                absolute_path: "C:\\sessions\\session.jsonl".to_owned(),
                session_id: Some("11111111-2222-3333-4444-555555555555".to_owned()),
                resume_command: Some(
                    "codex resume 11111111-2222-3333-4444-555555555555".to_owned(),
                ),
            },
            session: ordinary_session(true),
            parsed_chat_log: ParsedChatLogDto::from_domain(&parsed_log(), &ChatEntryFilter::all()),
        };

        let json = response.to_json();

        assert_eq!(json["source"]["file_name"], "session.jsonl");
        assert_eq!(
            json["source"]["absolute_path"],
            "C:\\sessions\\session.jsonl"
        );
        assert_eq!(
            json["source"]["session_id"],
            "11111111-2222-3333-4444-555555555555"
        );
        assert_eq!(
            json["source"]["resume_command"],
            "codex resume 11111111-2222-3333-4444-555555555555"
        );
        assert_eq!(json["session"]["classification"], "unclassified");
        assert_eq!(json["session"]["capabilities"]["can_resume"], true);
        assert_eq!(json["parsed_chat_log"]["entries"][0]["kind"], "you");
        assert_eq!(json["parsed_chat_log"]["entries"][0]["label"], "[YOU]");
        assert_eq!(
            json["parsed_chat_log"]["transcript_blocks"][0]["timestamp"],
            "2026-09-18T23:59:58Z"
        );
        assert_eq!(
            json["parsed_chat_log"]["counters"]["visible_entries"],
            json["parsed_chat_log"]["entries"]
                .as_array()
                .expect("entries is an array")
                .len()
        );
        assert_eq!(
            json["parsed_chat_log"]["observed_event_counts"][0]["event"],
            "event_msg/user_message"
        );
    }

    #[test]
    fn loaded_file_metadata_detects_session_id_from_file_stem_first() {
        let path = Path::new(
            "E:\\sessions\\aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\\11111111-2222-3333-4444-555555555555.jsonl",
        );

        let metadata = LoadedFileMetadataDto::from_path(path).expect("metadata builds");

        assert_eq!(
            metadata.file_name,
            Some("11111111-2222-3333-4444-555555555555.jsonl".to_owned())
        );
        assert_eq!(
            metadata.session_id,
            Some("11111111-2222-3333-4444-555555555555".to_owned())
        );
        assert_eq!(
            metadata.resume_command,
            Some("codex resume 11111111-2222-3333-4444-555555555555".to_owned())
        );
    }

    #[test]
    fn loaded_file_metadata_detects_session_id_from_parent_when_file_has_none() {
        let path = Path::new("E:\\sessions\\aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\\codex.jsonl");

        let metadata = LoadedFileMetadataDto::from_path(path).expect("metadata builds");

        assert_eq!(
            metadata.session_id,
            Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".to_owned())
        );
        assert_eq!(
            metadata.resume_command,
            Some("codex resume aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".to_owned())
        );
    }

    #[test]
    fn loaded_file_metadata_omits_resume_command_without_session_id() {
        let path = Path::new("E:\\sessions\\codex.jsonl");

        let metadata = LoadedFileMetadataDto::from_path(path).expect("metadata builds");

        assert_eq!(metadata.session_id, None);
        assert_eq!(metadata.resume_command, None);
    }

    #[test]
    fn error_response_shape_is_serializable_for_frontend_display() {
        let response = ErrorResponseDto::from_io(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "permission denied",
        ));

        let json = response.to_json();

        assert_eq!(json["error"]["code"], "parse_file_failed");
        assert_eq!(json["error"]["message"], "permission denied");
    }

    #[test]
    fn parsed_response_keeps_each_message_timestamp_across_resumed_dates() {
        let path = api_test_file("message-timestamps");
        fs::create_dir_all(path.parent().expect("test parent")).expect("create test parent");
        fs::write(
            &path,
            concat!(
                r#"{"timestamp":"2026-09-18T23:58:00Z","type":"session_meta","payload":{"id":"11111111-2222-3333-4444-555555555555"}}"#,
                "\n",
                r#"{"timestamp":"2026-09-18T23:59:58Z","type":"event_msg","payload":{"type":"user_message","message":"before resume"}}"#,
                "\n",
                r#"{"timestamp":"2026-09-20T08:15:00+09:00","type":"event_msg","payload":{"type":"agent_message","message":"after resume"}}"#,
            ),
        )
        .expect("write timestamp fixture");

        let response = parse_selected_file(ParseRequestDto {
            path: path.to_string_lossy().into_owned(),
            filter: FilterDto {
                show_meta: false,
                ..FilterDto::default()
            },
        })
        .expect("parse timestamp fixture");

        assert_eq!(response.parsed_chat_log.transcript_blocks.len(), 2);
        assert_eq!(
            response.parsed_chat_log.transcript_blocks[0]
                .timestamp
                .as_deref(),
            Some("2026-09-18T23:59:58Z")
        );
        assert_eq!(
            response.parsed_chat_log.transcript_blocks[1]
                .timestamp
                .as_deref(),
            Some("2026-09-20T08:15:00+09:00")
        );

        fs::remove_dir_all(path.parent().expect("test parent")).expect("remove timestamp fixture");
    }

    #[test]
    fn guardian_load_does_not_project_ordinary_transcript_entries() {
        let path = api_test_file("guardian-routing");
        fs::create_dir_all(path.parent().expect("test parent")).expect("create test parent");
        fs::write(
            &path,
            concat!(
                r#"{"type":"session_meta","payload":{"id":"guardian-thread","session_id":"root-session","parent_thread_id":"parent-thread","originator":"codex_work_desktop","thread_source":"guardian_review","source":{"subagent":{"other":"guardian"}},"history_mode":"paginated","subagent_history_start_ordinal":110}}"#,
                "\n",
                r#"{"type":"response_item","payload":{"type":"message","role":"user","content":"must not become YOU"}}"#,
                "\n",
                r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":"must not become CODEX"}}"#,
            ),
        )
        .expect("write guardian fixture");

        let response = parse_selected_file(ParseRequestDto {
            path: path.to_string_lossy().into_owned(),
            filter: FilterDto::default(),
        })
        .expect("guardian load preserves the API contract");

        assert!(response.parsed_chat_log.entries.is_empty());
        assert!(response.parsed_chat_log.transcript_blocks.is_empty());
        assert_eq!(response.parsed_chat_log.counters.total_entries, 0);
        assert_eq!(response.session.classification.as_str(), "guardian_review");
        let identity = response
            .session
            .identity
            .as_ref()
            .expect("guardian identity");
        assert_eq!(identity.thread_id.as_deref(), Some("guardian-thread"));
        assert_eq!(identity.parent_thread_id.as_deref(), Some("parent-thread"));
        assert_eq!(identity.session_id.as_deref(), Some("root-session"));
        assert!(!response.session.capabilities.can_show_transcript);
        assert!(!response.session.capabilities.can_resume);
        assert!(!response.session.capabilities.can_export_worklog);
        assert!(response.session.capabilities.can_open_parent_session);
        assert_eq!(
            response.source.session_id.as_deref(),
            Some("11111111-2222-3333-4444-555555555555")
        );
        assert_eq!(response.source.resume_command, None);
        let json = response.to_json();
        assert_eq!(json["session"]["classification"], "guardian_review");
        assert_eq!(json["session"]["identity"]["thread_id"], "guardian-thread");
        assert_eq!(
            json["session"]["identity"]["parent_thread_id"],
            "parent-thread"
        );
        assert_eq!(json["session"]["capabilities"]["can_resume"], false);
        assert_eq!(json["session"]["capabilities"]["can_export_worklog"], false);
        assert_eq!(
            json["session"]["capabilities"]["can_open_parent_session"],
            true
        );

        fs::remove_dir_all(path.parent().expect("test parent")).expect("remove guardian fixture");
    }

    #[test]
    fn parent_locator_finds_verified_parent_outside_child_date_directory() {
        let root = api_test_file("parent-locator")
            .parent()
            .expect("api test root")
            .join("sessions");
        let parent_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        let child = root
            .join("2026")
            .join("09")
            .join("17")
            .join("guardian-child.jsonl");
        let parent = root
            .join("2026")
            .join("09")
            .join("09")
            .join("parent-without-id-in-name.jsonl");
        fs::create_dir_all(child.parent().expect("child parent")).expect("create child parent");
        fs::create_dir_all(parent.parent().expect("parent parent")).expect("create parent parent");
        fs::write(
            &child,
            format!(
                r#"{{"type":"session_meta","payload":{{"id":"guardian","parent_thread_id":"{parent_id}","thread_source":"guardian_review","source":{{"subagent":{{"other":"guardian"}}}}}}}}"#
            ),
        )
        .expect("write guardian");
        fs::write(
            &parent,
            format!(
                r#"{{"type":"session_meta","payload":{{"id":"{parent_id}","originator":"codex_cli"}}}}"#
            ),
        )
        .expect("write parent");

        let response = locate_parent_session_for_transport(LocateParentSessionRequestDto {
            current_path: child.to_string_lossy().into_owned(),
            parent_thread_id: parent_id.to_owned(),
        })
        .expect("locate parent");

        assert_eq!(response.status, ParentSessionLocationStatusDto::Found);
        let canonical_parent = fs::canonicalize(&parent)
            .expect("canonical parent")
            .to_string_lossy()
            .into_owned();
        assert_eq!(response.path.as_deref(), Some(canonical_parent.as_str()));

        fs::remove_dir_all(root.parent().expect("fixture root")).expect("remove fixture");
    }

    #[test]
    fn transport_boundary_defaults_to_all_filters() {
        let dto = project_parsed_chat_log(&parsed_log(), None);

        assert_eq!(dto.counters.total_entries, 5);
        assert_eq!(dto.counters.visible_entries, 5);
        assert_eq!(
            dto.entries
                .iter()
                .map(|entry| entry.kind)
                .collect::<Vec<_>>(),
            vec![
                EntryKindDto::You,
                EntryKindDto::Codex,
                EntryKindDto::ToolCall,
                EntryKindDto::Task,
                EntryKindDto::System,
            ]
        );
    }

    #[test]
    fn canonical_question_projects_as_codex_with_existing_filter() {
        let parsed = crate::parser::jsonl::parse_str(concat!(
            "{\"timestamp\":\"2026-10-08T08:50:52.772Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"item_completed\",\"item\":{\"id\":\"call-question\",\"questions\":[{\"title\":\"Choose?\",\"options\":[\"a\",\"b\"]}]}}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":\"a\"}}"
        ));
        let dto = project_parsed_chat_log(&parsed, None);
        assert_eq!(dto.entries.len(), 2);
        assert_eq!(dto.entries[0].kind, EntryKindDto::Codex);
        assert_eq!(
            dto.transcript_blocks[0].content.as_str(),
            "Choose?\n- a\n- b"
        );
        assert_eq!(
            dto.transcript_blocks[0].timestamp.as_deref(),
            Some("2026-10-08T08:50:52.772Z")
        );
        assert_eq!(dto.entries[1].kind, EntryKindDto::You);
        let filter = FilterDto {
            show_codex: false,
            ..FilterDto::default()
        };
        let hidden = project_parsed_chat_log(&parsed, Some(filter));
        assert_eq!(hidden.entries.len(), 1);
        assert_eq!(hidden.entries[0].kind, EntryKindDto::You);
    }

    #[test]
    fn transport_boundary_projects_explicit_filter_without_reparse() {
        let dto = project_parsed_chat_log(
            &parsed_log(),
            Some(FilterDto {
                show_you: false,
                show_codex: true,
                show_tool_call: false,
                show_tool_result: true,
                show_meta: true,
            }),
        );

        assert_eq!(dto.counters.parsed_candidates, 5);
        assert_eq!(dto.counters.ignored_lines, 3);
        assert_eq!(dto.counters.malformed_lines, 1);
        assert_eq!(dto.counters.total_entries, 5);
        assert_eq!(dto.counters.visible_entries, 3);
        assert_eq!(
            dto.entries
                .iter()
                .map(|entry| entry.kind)
                .collect::<Vec<_>>(),
            vec![
                EntryKindDto::Codex,
                EntryKindDto::Task,
                EntryKindDto::System
            ]
        );
    }

    #[test]
    fn transport_boundary_request_defaults_filter_before_parse() {
        let request = ParseBoundaryRequest {
            path: "E:\\sessions\\codex.jsonl".to_owned(),
            filter: None,
        };

        let selected = ParseRequestDto {
            path: request.path.clone(),
            filter: request.filter.unwrap_or_default(),
        };

        assert_eq!(selected.filter, FilterDto::default());
        assert_eq!(selected.filter, FilterDto::from(ChatEntryFilter::all()));
    }

    #[test]
    fn transport_boundary_json_shape_stays_dto_compatible() {
        let response = ParseResponseDto {
            source: LoadedFileMetadataDto {
                file_name: Some("codex.jsonl".to_owned()),
                absolute_path: "E:\\sessions\\codex.jsonl".to_owned(),
                session_id: None,
                resume_command: None,
            },
            session: ordinary_session(false),
            parsed_chat_log: project_parsed_chat_log(&parsed_log(), None),
        };

        let json = response.to_json();

        assert_eq!(json["source"]["file_name"], "codex.jsonl");
        assert!(json["source"]["session_id"].is_null());
        assert!(json["source"]["resume_command"].is_null());
        assert_eq!(json["parsed_chat_log"]["counters"]["total_entries"], 5);
        assert_eq!(json["parsed_chat_log"]["counters"]["visible_entries"], 5);
        assert_eq!(json["parsed_chat_log"]["entries"][3]["kind"], "task");
    }
}
