//! Read-only access to plain and Zstandard session rollouts.
use std::{
    fs::File,
    io::{self, Read},
    path::{Path, PathBuf},
};

pub fn is_session_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            let name = name.to_ascii_lowercase();
            name.ends_with(".jsonl") || name.ends_with(".jsonl.zst")
        })
}

pub fn plain_path(path: &Path) -> PathBuf {
    if is_compressed(path) {
        path.with_extension("")
    } else {
        path.to_path_buf()
    }
}

pub fn is_compressed(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.to_ascii_lowercase().ends_with(".jsonl.zst"))
}

/// Prefer an existing plain sibling; only fall back on NotFound. Permission and
/// other I/O failures must remain visible rather than silently selecting a copy.
pub fn resolve_path(path: &Path) -> io::Result<PathBuf> {
    let plain = plain_path(path);
    match std::fs::metadata(&plain) {
        Ok(meta) if meta.is_file() => return Ok(plain),
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Session source is not a file",
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let compressed = if is_session_file(path) {
        let mut name = plain.as_os_str().to_os_string();
        name.push(".zst");
        PathBuf::from(name)
    } else {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Session source not found",
        ));
    };
    let meta = std::fs::metadata(&compressed)?;
    if !meta.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Session source is not a file",
        ));
    }
    Ok(compressed)
}

/// Every call creates a fresh stream at byte zero, including after inspection.
/// No decoded file is materialized and the source is opened read-only.
pub fn open_reader(path: &Path) -> io::Result<Box<dyn Read>> {
    let path = resolve_path(path)?;
    let file = File::open(&path)?;
    if is_compressed(&path) {
        Ok(Box::new(zstd::stream::read::Decoder::new(file)?))
    } else {
        Ok(Box::new(file))
    }
}
