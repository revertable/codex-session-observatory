//! Transport contract for the file-backed Session Navigator; no transcript bodies.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TitleSource {
    DatabaseName,
    SessionIndex,
    DatabaseTitle,
    ThreadId,
    FileName,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TimeSource {
    DatabaseCreatedAtMs,
    SessionMetadata,
    SessionEnvelope,
    StorageDate,
    ConversationMessage,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SessionSummaryDto {
    pub entry_key: String,
    pub thread_id: Option<String>,
    pub path: String,
    pub title: String,
    pub title_source: TitleSource,
    pub created_at_ms: Option<i64>,
    pub created_at_source: TimeSource,
    pub last_conversation_at_ms: Option<i64>,
    pub last_conversation_at_source: TimeSource,
    pub storage_date: Option<String>,
    pub classification: super::SessionClassificationDto,
    pub thread_source: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct NavigatorDiagnosticsDto {
    pub discovered_files: usize,
    pub guardian_sessions: usize,
    pub duplicate_files: usize,
    pub unreadable_files: usize,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SessionPageDto {
    pub snapshot_id: String,
    pub sessions_root: String,
    pub total: usize,
    pub items: Vec<SessionSummaryDto>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    pub diagnostics: NavigatorDiagnosticsDto,
}

#[derive(Clone, Debug, Deserialize)]
pub struct FlatSessionsRequestDto {
    pub snapshot_id: String,
    pub cursor: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct HierarchicalSessionsRequestDto {
    pub snapshot_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SessionDayDto {
    pub day: u8,
    pub items: Vec<SessionSummaryDto>,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SessionMonthDto {
    pub month: u8,
    pub days: Vec<SessionDayDto>,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SessionYearDto {
    pub year: i32,
    pub months: Vec<SessionMonthDto>,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SessionHierarchyDto {
    pub snapshot_id: String,
    pub sessions_root: String,
    pub total: usize,
    pub years: Vec<SessionYearDto>,
    /// Files outside valid YYYY/MM/DD paths remain visible in Flat and here.
    pub unfiled_items: Vec<SessionSummaryDto>,
    pub diagnostics: NavigatorDiagnosticsDto,
}
