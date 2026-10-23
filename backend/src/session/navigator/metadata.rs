use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{BufRead, BufReader},
    path::Path,
    time::Duration,
};

#[derive(Default)]
pub(super) struct ThreadMetadata {
    pub name: Option<String>,
    pub title: Option<String>,
    pub created_at_ms: Option<i64>,
}

pub(super) fn nonempty(text: Option<String>) -> Option<String> {
    text.map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

pub(super) fn database(home: &Path, warnings: &mut Vec<String>) -> HashMap<String, ThreadMetadata> {
    match read_database(&home.join("state_5.sqlite"), warnings) {
        Ok(rows) => rows,
        Err(_) => {
            warnings.push("database_unavailable".into());
            HashMap::new()
        }
    }
}

fn read_database(
    path: &Path,
    warnings: &mut Vec<String>,
) -> rusqlite::Result<HashMap<String, ThreadMetadata>> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    connection.busy_timeout(Duration::from_millis(100))?;
    // Do not use immutable=1: the live Codex database may have committed WAL data.
    connection.execute_batch("PRAGMA query_only=ON; BEGIN;")?;
    let columns = connection
        .prepare("PRAGMA table_info(threads)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<HashSet<_>>>()?;
    if !columns.contains("id") {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let fields = ["name", "title", "created_at_ms"].map(|field| {
        if columns.contains(field) {
            field
        } else {
            "NULL"
        }
    });
    if fields.contains(&"NULL") {
        warnings.push("database_schema_partial".into());
    }
    let sql = format!(
        "SELECT id, {}, {}, {} FROM threads",
        fields[0], fields[1], fields[2]
    );
    let mut statement = connection.prepare(&sql)?;
    let mut query = statement.query([])?;
    let mut output = HashMap::new();
    while let Some(row) = query.next()? {
        let id: String = row.get(0)?;
        output.insert(
            id,
            ThreadMetadata {
                name: nonempty(row.get::<_, Option<String>>(1).ok().flatten()),
                title: nonempty(row.get::<_, Option<String>>(2).ok().flatten()),
                created_at_ms: row.get::<_, Option<i64>>(3).ok().flatten(),
            },
        );
    }
    Ok(output)
}

#[derive(Deserialize)]
struct IndexRow {
    id: String,
    thread_name: String,
}

pub(super) fn index(home: &Path, warnings: &mut Vec<String>) -> HashMap<String, String> {
    let Ok(file) = File::open(home.join("session_index.jsonl")) else {
        warnings.push("session_index_unavailable".into());
        return HashMap::new();
    };
    let mut names = HashMap::new();
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) => break,
            Ok(_) => match serde_json::from_slice::<IndexRow>(&line) {
                Ok(row) if !row.id.trim().is_empty() && !row.thread_name.trim().is_empty() => {
                    names.insert(row.id.trim().to_owned(), row.thread_name.trim().to_owned());
                }
                _ => {
                    if !warnings
                        .iter()
                        .any(|value| value == "session_index_invalid_rows")
                    {
                        warnings.push("session_index_invalid_rows".into());
                    }
                }
            },
            Err(_) => {
                warnings.push("session_index_read_failed".into());
                break;
            }
        }
    }
    names
}
