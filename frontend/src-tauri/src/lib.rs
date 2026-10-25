use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use backend::api::{self, LocateParentSessionRequestDto, ParseBoundaryRequest};
use backend::export::{self, ExportWorklogError, ExportWorklogRequest, ExportWorklogResult};
use backend::{
    api::navigator::*,
    session::navigator::{self, NavigatorService},
};
use serde::{Deserialize, Serialize};

mod system_fonts;

#[tauri::command]
async fn list_system_fonts() -> api::ApiResult<Vec<system_fonts::SystemFont>> {
    tauri::async_runtime::spawn_blocking(system_fonts::list)
        .await
        .map_err(|e| api::ErrorResponseDto::new("font_list_failed", e.to_string()))?
        .map_err(|e| api::ErrorResponseDto::new("font_list_failed", e))
}

#[derive(Default)]
struct NavigatorState(Arc<NavigatorService>);

// Await the shared gate before scheduling blocking work. Keep its owned guard in
// the worker so dropping a command future cannot allow overlapping file jobs.
#[derive(Default, Clone)]
struct FileCommandTasks(Arc<tauri::async_runtime::Mutex<()>>);

impl FileCommandTasks {
    async fn run<T: Send + 'static>(
        &self,
        work: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, tauri::Error> {
        let permit = Arc::clone(&self.0).lock_owned().await;
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            work()
        })
        .await
    }
}

fn navigator_task_error(error: impl std::fmt::Display) -> api::ErrorResponseDto {
    api::ErrorResponseDto::new("navigator_task_failed", error.to_string())
}

#[tauri::command]
async fn reload_session_navigator(
    state: tauri::State<'_, NavigatorState>,
) -> api::ApiResult<SessionPageDto> {
    let service = Arc::clone(&state.inner().0);
    let generation = service.begin_reload();
    tauri::async_runtime::spawn_blocking(move || {
        let home = navigator::codex_home().map_err(navigator_task_error)?;
        let snapshot = navigator::collect_snapshot(&home).map_err(navigator_task_error)?;
        service.install(generation, snapshot)
    })
    .await
    .map_err(navigator_task_error)?
}

#[tauri::command]
async fn list_sessions_flat(
    state: tauri::State<'_, NavigatorState>,
    request: FlatSessionsRequestDto,
) -> api::ApiResult<SessionPageDto> {
    let service = Arc::clone(&state.inner().0);
    tauri::async_runtime::spawn_blocking(move || service.flat(request))
        .await
        .map_err(navigator_task_error)?
}

#[tauri::command]
async fn list_sessions_hierarchy(
    state: tauri::State<'_, NavigatorState>,
    request: HierarchicalSessionsRequestDto,
) -> api::ApiResult<SessionHierarchyDto> {
    let service = Arc::clone(&state.inner().0);
    tauri::async_runtime::spawn_blocking(move || service.hierarchy(request))
        .await
        .map_err(navigator_task_error)?
}

#[tauri::command]
async fn resolve_navigator_session(
    state: tauri::State<'_, NavigatorState>,
    request: NavigatorTargetRequestDto,
) -> api::ApiResult<String> {
    let service = Arc::clone(&state.inner().0);
    tauri::async_runtime::spawn_blocking(move || {
        service
            .resolve_target(request)
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(navigator_task_error)?
}

#[tauri::command]
async fn open_navigator_containing_folder(
    state: tauri::State<'_, NavigatorState>,
    request: NavigatorTargetRequestDto,
) -> api::ApiResult<()> {
    let service = Arc::clone(&state.inner().0);
    tauri::async_runtime::spawn_blocking(move || {
        let path = service.resolve_target(request)?;
        let parent = path
            .parent()
            .ok_or_else(|| navigator_task_error("Session folder is unavailable."))?;
        tauri_plugin_opener::open_path(parent, None::<&str>).map_err(|error| {
            api::ErrorResponseDto::new("navigator_folder_open_failed", error.to_string())
        })
    })
    .await
    .map_err(navigator_task_error)?
}

#[tauri::command]
async fn export_navigator_worklog(
    state: tauri::State<'_, NavigatorState>,
    tasks: tauri::State<'_, FileCommandTasks>,
    request: NavigatorTargetRequestDto,
    parent_directory: String,
) -> api::ApiResult<ExportWorklogResponse> {
    let service = Arc::clone(&state.inner().0);
    tasks
        .run(move || {
            let path = service.resolve_target(request)?;
            export_worklog_blocking(path.to_string_lossy().into_owned(), parent_directory)
                .map_err(|error| api::ErrorResponseDto::new(error.error.code, error.error.message))
        })
        .await
        .map_err(navigator_task_error)?
}

#[derive(Clone, Debug, Deserialize)]
struct TauriFilterDto {
    show_you: bool,
    show_codex: bool,
    show_tool_call: bool,
    show_tool_result: bool,
    show_meta: bool,
}

impl From<TauriFilterDto> for api::FilterDto {
    fn from(filter: TauriFilterDto) -> Self {
        Self {
            show_you: filter.show_you,
            show_codex: filter.show_codex,
            show_tool_call: filter.show_tool_call,
            show_tool_result: filter.show_tool_result,
            show_meta: filter.show_meta,
        }
    }
}

#[tauri::command]
async fn parse_selected_jsonl(
    tasks: tauri::State<'_, FileCommandTasks>,
    path: String,
    filter: TauriFilterDto,
) -> api::ApiResult<api::ParseResponseDto> {
    tasks
        .run(move || {
            api::parse_for_transport(ParseBoundaryRequest {
                path,
                filter: Some(filter.into()),
            })
        })
        .await
        .map_err(|error| api::ErrorResponseDto::new("parse_file_failed", error.to_string()))?
}

#[tauri::command]
fn locate_parent_session(
    parent_thread_id: String,
    current_path: String,
) -> api::ApiResult<api::LocateParentSessionResponseDto> {
    api::locate_parent_session_for_transport(LocateParentSessionRequestDto {
        current_path,
        parent_thread_id,
    })
}

#[derive(Debug, Serialize)]
struct TauriErrorResponse {
    error: TauriApiError,
}

#[derive(Debug, Serialize)]
struct TauriApiError {
    code: &'static str,
    message: String,
}

impl From<ExportWorklogError> for TauriErrorResponse {
    fn from(error: ExportWorklogError) -> Self {
        Self {
            error: TauriApiError {
                code: error.code,
                message: error.message,
            },
        }
    }
}

#[derive(Debug, Serialize)]
struct ExportWorklogResponse {
    status: &'static str,
    bundle_path: String,
    generated_files: Vec<String>,
    refreshed: bool,
    folder_opened: bool,
    folder_open_error: Option<String>,
}

#[tauri::command]
async fn export_worklog(
    tasks: tauri::State<'_, FileCommandTasks>,
    source_path: String,
    parent_directory: String,
) -> Result<ExportWorklogResponse, TauriErrorResponse> {
    tasks
        .run(move || export_worklog_blocking(source_path, parent_directory))
        .await
        .map_err(|error| TauriErrorResponse {
            error: TauriApiError {
                code: "worklog_export_failed",
                message: error.to_string(),
            },
        })?
}

fn export_worklog_blocking(
    source_path: String,
    parent_directory: String,
) -> Result<ExportWorklogResponse, TauriErrorResponse> {
    let response = export::export_worklog(ExportWorklogRequest {
        source_path: PathBuf::from(source_path),
        parent_directory: PathBuf::from(parent_directory),
    })
    .map_err(TauriErrorResponse::from)?;
    let folder_open_result = tauri_plugin_opener::open_path(&response.bundle_path, None::<&str>)
        .map_err(|error| error.to_string());

    Ok(export_worklog_response(response, folder_open_result))
}

fn export_worklog_response(
    response: ExportWorklogResult,
    folder_open_result: Result<(), String>,
) -> ExportWorklogResponse {
    let (folder_opened, folder_open_error) = match folder_open_result {
        Ok(()) => (true, None),
        Err(error) => (false, Some(error)),
    };
    ExportWorklogResponse {
        status: "exported",
        bundle_path: response.bundle_path,
        generated_files: response.generated_files,
        refreshed: response.refreshed,
        folder_opened,
        folder_open_error,
    }
}

#[tauri::command]
fn resolve_jsonl_initial_directory(remembered_directory: Option<String>) -> String {
    if let Some(remembered_directory) = remembered_directory
        .as_deref()
        .filter(|path| !path.trim().is_empty())
        .map(Path::new)
        .filter(|path| path.is_dir())
    {
        return remembered_directory.to_string_lossy().into_owned();
    }

    let codex_home = std::env::var_os("CODEX_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let user_home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);

    let candidates = [
        codex_home.as_ref().map(|path| path.join("sessions")),
        user_home
            .as_ref()
            .map(|path| path.join(".codex").join("sessions")),
        user_home,
    ];

    candidates
        .into_iter()
        .flatten()
        .find(|path| path.is_dir())
        .unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .canonicalize()
                .unwrap_or_else(|_| PathBuf::from("."))
        })
        .to_string_lossy()
        .into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(NavigatorState::default())
        .manage(FileCommandTasks::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_system_fonts,
            reload_session_navigator,
            list_sessions_flat,
            list_sessions_hierarchy,
            resolve_navigator_session,
            open_navigator_containing_folder,
            export_navigator_worklog,
            export_worklog,
            locate_parent_session,
            parse_selected_jsonl,
            resolve_jsonl_initial_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_jobs_run_off_the_calling_thread_and_preserve_errors() {
        let caller = std::thread::current().id();
        let tasks = FileCommandTasks::default();
        let result = tauri::async_runtime::block_on(tasks.run(move || {
            assert_ne!(std::thread::current().id(), caller);
            Err::<(), _>("original failure")
        }))
        .unwrap();
        assert_eq!(result, Err("original failure"));
    }

    #[test]
    fn file_jobs_serialize_shared_command_work() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let tasks = FileCommandTasks::default();
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        tauri::async_runtime::block_on(async {
            let mut jobs = Vec::new();
            for value in 0..8 {
                let tasks = tasks.clone();
                let active = Arc::clone(&active);
                let peak = Arc::clone(&peak);
                jobs.push(tauri::async_runtime::spawn(async move {
                    tasks
                        .run(move || {
                            let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                            peak.fetch_max(count, Ordering::SeqCst);
                            std::thread::sleep(std::time::Duration::from_millis(5));
                            active.fetch_sub(1, Ordering::SeqCst);
                            value
                        })
                        .await
                        .unwrap()
                }));
            }
            for (expected, job) in jobs.into_iter().enumerate() {
                assert_eq!(job.await.unwrap(), expected);
            }
        });
        assert_eq!(peak.load(Ordering::SeqCst), 1);
        assert_eq!(active.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn dropping_command_future_keeps_gate_until_worker_finishes() {
        let tasks = FileCommandTasks::default();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let running_tasks = tasks.clone();
        let job = tauri::async_runtime::spawn(async move {
            running_tasks
                .run(move || {
                    started_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                })
                .await
        });
        started_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        job.abort();
        assert!(tasks.0.try_lock().is_err());
        release_tx.send(()).unwrap();
        assert_eq!(
            tauri::async_runtime::block_on(tasks.run(|| 42)).unwrap(),
            42
        );
    }

    #[test]
    fn panicked_file_job_releases_gate_for_next_command() {
        let tasks = FileCommandTasks::default();
        let result = tauri::async_runtime::block_on(tasks.run(|| panic!("synthetic worker panic")));
        assert!(result.is_err());
        assert_eq!(tauri::async_runtime::block_on(tasks.run(|| 7)).unwrap(), 7);
    }

    #[test]
    fn navigator_transport_contract_shares_snapshot_and_serializes_sources() {
        let service = NavigatorService::default();
        let first = service
            .install(
                service.begin_reload(),
                navigator::NavigatorSnapshot {
                    sessions_root: "synthetic/sessions".into(),
                    diagnostics: NavigatorDiagnosticsDto::default(),
                    items: vec![SessionSummaryDto {
                        entry_key: "thread:synthetic".into(),
                        thread_id: Some("synthetic".into()),
                        path: "synthetic/sessions/2026/10/20/sample.jsonl.zst".into(),
                        title: "Synthetic session".into(),
                        title_source: TitleSource::DatabaseName,
                        created_at_ms: Some(1_792_454_400_000),
                        created_at_source: TimeSource::DatabaseCreatedAtMs,
                        last_conversation_at_ms: None,
                        last_conversation_at_source: TimeSource::Unavailable,
                        storage_date: Some("2026-10-20".into()),
                        classification: api::SessionClassificationDto::Unclassified,
                        thread_source: Some("user".into()),
                    }],
                },
            )
            .unwrap();
        let request: FlatSessionsRequestDto = serde_json::from_value(
            serde_json::json!({"snapshot_id":first.snapshot_id,"cursor":null}),
        )
        .unwrap();
        let json = serde_json::to_value(service.flat(request).unwrap()).unwrap();
        assert_eq!(json["items"][0]["title_source"], "database_name");
        assert_eq!(
            json["items"][0]["created_at_source"],
            "database_created_at_ms"
        );
        assert!(json["items"][0]["last_conversation_at_ms"].is_null());
        assert!(json["items"][0].get("content").is_none());
        assert_eq!(json["has_more"], false);
        assert!(json["next_cursor"].is_null());
        let request: HierarchicalSessionsRequestDto =
            serde_json::from_value(serde_json::json!({"snapshot_id":first.snapshot_id})).unwrap();
        let hierarchy = serde_json::to_value(service.hierarchy(request).unwrap()).unwrap();
        assert_eq!(hierarchy["snapshot_id"], json["snapshot_id"]);
        assert_eq!(
            hierarchy["years"][0]["months"][0]["days"][0]["items"][0],
            json["items"][0]
        );
        let error = service
            .flat(FlatSessionsRequestDto {
                snapshot_id: "expired".into(),
                cursor: None,
            })
            .unwrap_err();
        assert_eq!(
            error.to_json()["error"]["code"],
            "navigator_snapshot_expired"
        );
    }

    fn export_result(refreshed: bool) -> ExportWorklogResult {
        ExportWorklogResult {
            bundle_path: "E:\\exports\\codex-worklog\\2026-06-19\\161859_session-019ee0ad"
                .to_owned(),
            generated_files: vec!["000_index.md".to_owned(), "manifest.json".to_owned()],
            refreshed,
        }
    }

    fn response_json(response: ExportWorklogResponse) -> serde_json::Value {
        serde_json::to_value(response).expect("typed export response serializes")
    }

    #[test]
    fn export_response_reports_folder_open_success() {
        let response = response_json(export_worklog_response(export_result(false), Ok(())));

        assert_eq!(response["status"], "exported");
        assert_eq!(response["folder_opened"], true);
        assert!(response["folder_open_error"].is_null());
    }

    #[test]
    fn export_response_preserves_success_when_folder_open_fails() {
        let response = response_json(export_worklog_response(
            export_result(false),
            Err("Explorer unavailable".to_owned()),
        ));

        assert_eq!(response["status"], "exported");
        assert_eq!(response["folder_opened"], false);
        assert_eq!(response["folder_open_error"], "Explorer unavailable");
    }

    #[test]
    fn refreshed_export_preserves_success_when_folder_open_fails() {
        let response = response_json(export_worklog_response(
            export_result(true),
            Err("Explorer unavailable".to_owned()),
        ));

        assert_eq!(response["status"], "exported");
        assert_eq!(response["refreshed"], true);
        assert_eq!(response["folder_opened"], false);
    }
}
