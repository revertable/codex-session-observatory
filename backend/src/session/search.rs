//! Read-only, parser-grounded search over the complete Navigator snapshot.
use super::{
    load_file,
    navigator::{NavigatorSnapshot, resolve_snapshot_item},
};
use crate::{
    api::{ApiResult, ErrorResponseDto, navigator::SessionPageDto},
    domain::RenderedEntryKind,
};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct SearchProgress {
    pub scanned: usize,
    pub total: usize,
    pub unreadable: usize,
}

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub page: SessionPageDto,
    pub scanned: usize,
    pub unreadable: usize,
}

pub fn search_snapshot(
    source: &NavigatorSnapshot,
    query: &str,
    current: impl Fn() -> bool,
    mut progress: impl FnMut(SearchProgress),
) -> ApiResult<(NavigatorSnapshot, usize, usize)> {
    let needle = query.trim().to_lowercase();
    let mut result = source.clone();
    result.items.clear();
    let mut unreadable = 0;
    let mut scanned = 0;
    for item in &source.items {
        if !current() {
            return Err(ErrorResponseDto::new(
                "navigator_search_superseded",
                "A newer search was requested.",
            ));
        }
        if needle.is_empty() {
            result.items.push(item.clone());
        } else {
            // Validate the immutable entry again before opening a potentially replaced source.
            let parsed = resolve_snapshot_item(source, item)
                .and_then(|path| load_file(path).map_err(ErrorResponseDto::from_io));
            match parsed {
                Ok(loaded) => {
                    if loaded
                        .into_compatible_chat_log()
                        .entries
                        .iter()
                        .any(|entry| {
                            entry.kind == RenderedEntryKind::You
                                && entry.content.to_lowercase().contains(&needle)
                        })
                    {
                        result.items.push(item.clone());
                    }
                }
                Err(_) => unreadable += 1,
            }
        }
        scanned += 1;
        if scanned == 1 || scanned % 16 == 0 || scanned == source.items.len() {
            progress(SearchProgress {
                scanned,
                total: source.items.len(),
                unreadable,
            });
        }
    }
    if unreadable > 0 {
        result
            .diagnostics
            .warnings
            .push("search_files_unreadable".into());
    }
    Ok((result, scanned, unreadable))
}
