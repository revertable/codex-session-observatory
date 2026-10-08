use std::borrow::Cow;
use std::fs::File;
use std::io::{self, BufRead, BufReader, Cursor, Read};
use std::path::Path;

use indexmap::IndexMap;
use serde::Deserialize;
use serde_json::{Value, value::RawValue};

use crate::domain::{
    ParsedChatLog, ReferencedConversation, RenderedEntry, RenderedEntryKind, SessionProvenance,
};

use super::user_transport::{
    BorrowedUserTransport, DecodedUserTransport, decode_user_transport,
    decode_user_transport_borrowed,
};

#[derive(Clone, Debug)]
struct ParsedCandidate {
    entry: RenderedEntry,
    stable_slot: Option<usize>,
    source: CandidateSource,
    timestamp: Option<String>,
}

#[derive(Default)]
struct CandidateAccumulator {
    candidates: Vec<ParsedCandidate>,
    stable_slots: IndexMap<String, usize>,
}

impl CandidateAccumulator {
    fn push(&mut self, mut candidate: ParsedCandidate, stable_key: Option<String>) {
        let Some(stable_key) = stable_key else {
            self.candidates.push(candidate);
            return;
        };

        if let Some(&slot) = self.stable_slots.get(&stable_key) {
            candidate.stable_slot = Some(slot);
            let selected = &mut self.candidates[slot];
            if should_replace_candidate(selected, &candidate) {
                *selected = candidate;
            }
            return;
        }

        let slot = self.candidates.len();
        candidate.stable_slot = Some(slot);
        self.stable_slots.insert(stable_key, slot);
        self.candidates.push(candidate);
    }

    fn finish(self) -> Vec<ParsedCandidate> {
        suppress_adjacent_duplicates(self.candidates)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CandidateSource {
    ResponseMessage,
    ResponseToolResult,
    EventToolResult,
    ResponseToolCall,
    EventUserMessage,
    EventAgentMessage,
    EventUserQuestion,
    EventSystem,
    Fallback,
}

impl CandidateSource {
    fn priority(self) -> u8 {
        match self {
            Self::ResponseMessage | Self::ResponseToolResult => 4,
            Self::EventToolResult | Self::ResponseToolCall | Self::EventUserMessage => 3,
            Self::EventAgentMessage | Self::EventUserQuestion | Self::EventSystem => 2,
            Self::Fallback => 1,
        }
    }
}

enum CandidateEntry<'a> {
    Ready(RenderedEntry),
    User(Cow<'a, str>),
}

struct CandidateSeed<'a> {
    entry: CandidateEntry<'a>,
    source: CandidateSource,
    stable_id: Option<String>,
    timestamp: Option<String>,
    is_user_message: bool,
}

#[derive(Deserialize)]
struct EnvelopeFields<'a> {
    #[serde(rename = "type", borrow)]
    type_name: Option<&'a RawValue>,
    #[serde(borrow)]
    payload: Option<&'a RawValue>,
    #[serde(borrow)]
    timestamp: Option<&'a RawValue>,
    #[serde(borrow)]
    time: Option<&'a RawValue>,
    #[serde(borrow)]
    created_at: Option<&'a RawValue>,
    #[serde(rename = "createdAt", borrow)]
    created_at_camel: Option<&'a RawValue>,
}

#[derive(Deserialize)]
struct PayloadFields<'a> {
    #[serde(borrow)]
    item: Option<&'a RawValue>,
    #[serde(rename = "type", borrow)]
    type_name: Option<&'a RawValue>,
    #[serde(borrow)]
    role: Option<&'a RawValue>,
    #[serde(borrow)]
    id: Option<&'a RawValue>,
    #[serde(borrow)]
    call_id: Option<&'a RawValue>,
    #[serde(borrow)]
    turn_id: Option<&'a RawValue>,
    #[serde(rename = "turnId", borrow)]
    turn_id_camel: Option<&'a RawValue>,
    #[serde(borrow)]
    timestamp: Option<&'a RawValue>,
    #[serde(borrow)]
    time: Option<&'a RawValue>,
    #[serde(borrow)]
    created_at: Option<&'a RawValue>,
    #[serde(rename = "createdAt", borrow)]
    created_at_camel: Option<&'a RawValue>,
    #[serde(borrow)]
    message: Option<&'a RawValue>,
    #[serde(borrow)]
    content: Option<&'a RawValue>,
    #[serde(borrow)]
    text: Option<&'a RawValue>,
    #[serde(borrow)]
    output: Option<&'a RawValue>,
    #[serde(borrow)]
    result: Option<&'a RawValue>,
    #[serde(borrow)]
    summary: Option<&'a RawValue>,
    #[serde(borrow)]
    name: Option<&'a RawValue>,
    #[serde(borrow)]
    arguments: Option<&'a RawValue>,
    #[serde(borrow)]
    input: Option<&'a RawValue>,
    #[serde(borrow)]
    command: Option<&'a RawValue>,
    #[serde(borrow)]
    cmd: Option<&'a RawValue>,
    #[serde(borrow)]
    status: Option<&'a RawValue>,
    #[serde(borrow)]
    exit_code: Option<&'a RawValue>,
    #[serde(rename = "exitCode", borrow)]
    exit_code_camel: Option<&'a RawValue>,
    #[serde(borrow)]
    aggregated_output: Option<&'a RawValue>,
    #[serde(borrow)]
    formatted_output: Option<&'a RawValue>,
    #[serde(borrow)]
    stdout: Option<&'a RawValue>,
    #[serde(borrow)]
    stderr: Option<&'a RawValue>,
    #[serde(borrow)]
    model_provider: Option<&'a RawValue>,
    #[serde(borrow)]
    cli_version: Option<&'a RawValue>,
}

pub fn parse_str(input: &str) -> ParsedChatLog {
    parse_bufread(Cursor::new(input.as_bytes())).expect("in-memory JSONL parsing cannot fail")
}

pub fn parse_reader<R: Read>(reader: R) -> io::Result<ParsedChatLog> {
    parse_bufread(BufReader::new(reader))
}

pub fn parse_file(path: impl AsRef<Path>) -> io::Result<ParsedChatLog> {
    let path = path.as_ref();
    if !path.is_file() {
        return Ok(ParsedChatLog::empty());
    }

    parse_reader(File::open(path)?)
}

fn parse_bufread<R: BufRead>(mut reader: R) -> io::Result<ParsedChatLog> {
    let mut candidates = CandidateAccumulator::default();
    let mut session_provenance = SessionProvenance::default();
    let mut parsed_candidates = 0;
    let mut ignored_lines = 0;
    let mut malformed_lines = 0;
    let mut observed_event_counts = IndexMap::new();
    let mut line_buffer = Vec::new();

    loop {
        line_buffer.clear();
        if reader.read_until(b'\n', &mut line_buffer)? == 0 {
            break;
        }

        let decoded_line = String::from_utf8_lossy(&line_buffer);
        let line = decoded_line.trim();
        if line.is_empty() {
            continue;
        }

        let extracted = match serde_json::from_str::<EnvelopeFields<'_>>(line) {
            Ok(envelope) => {
                let top_type = json_string(envelope.type_name);
                let payload = envelope.payload.and_then(|payload| {
                    serde_json::from_str::<PayloadFields<'_>>(payload.get()).ok()
                });
                if envelope.payload.is_some() && payload.is_none() {
                    let value = serde_json::from_str::<Value>(line)
                        .expect("validated JSON object must deserialize as Value");
                    increment_observed_event_count(&mut observed_event_counts, &value);
                    extract_candidate_seeds(&value)
                } else {
                    let payload_type = payload
                        .as_ref()
                        .and_then(|payload| json_string(payload.type_name));
                    increment_observed_event_parts(
                        &mut observed_event_counts,
                        top_type.as_deref(),
                        payload_type.as_deref(),
                    );

                    match extract_typed_focused_seed(
                        line,
                        &envelope,
                        payload.as_ref(),
                        top_type.as_deref(),
                        payload_type.as_deref(),
                    ) {
                        Some(Some(seed)) => vec![seed],
                        Some(None) => Vec::new(),
                        None => {
                            let value = serde_json::from_str::<Value>(line)
                                .expect("validated JSON object must deserialize as Value");
                            extract_candidate_seeds(&value)
                        }
                    }
                }
            }
            Err(_) => {
                let value = match serde_json::from_str::<Value>(line) {
                    Ok(value) => value,
                    Err(_) => {
                        malformed_lines += 1;
                        continue;
                    }
                };
                increment_observed_event_count(&mut observed_event_counts, &value);
                extract_candidate_seeds(&value)
            }
        };
        if extracted.is_empty() {
            ignored_lines += 1;
        } else {
            parsed_candidates += extracted.len();
            for seed in extracted {
                let (candidate, stable_key, reference) = parsed_candidate(seed);
                if let Some(reference) = reference {
                    session_provenance.observe_reference(reference);
                }
                if let Some(candidate) = candidate {
                    candidates.push(candidate, stable_key);
                }
            }
        }
    }

    let (entries, entry_timestamps) = candidates
        .finish()
        .into_iter()
        .map(|candidate| (candidate.entry, candidate.timestamp))
        .unzip();

    Ok(ParsedChatLog {
        parsed_candidates,
        entries,
        entry_timestamps,
        session_provenance,
        ignored_lines,
        malformed_lines,
        observed_event_counts,
    })
}

fn increment_observed_event_count(counts: &mut IndexMap<String, usize>, value: &Value) {
    let top_type = string_field(value, "type");
    let payload_type = value
        .get("payload")
        .and_then(|payload| string_field(payload, "type"));

    increment_observed_event_parts(counts, top_type, payload_type);
}

fn increment_observed_event_parts(
    counts: &mut IndexMap<String, usize>,
    top_type: Option<&str>,
    payload_type: Option<&str>,
) {
    let key = match (top_type, payload_type) {
        (Some(top_type), Some(payload_type)) => format!("{top_type}/{payload_type}"),
        (None, Some(payload_type)) => payload_type.to_owned(),
        (Some(top_type), None) => top_type.to_owned(),
        (None, None) => "unknown".to_owned(),
    };

    *counts.entry(key).or_insert(0) += 1;
}

fn extract_typed_focused_seed<'a>(
    line: &'a str,
    envelope: &EnvelopeFields<'a>,
    payload: Option<&PayloadFields<'a>>,
    top_type: Option<&str>,
    payload_type: Option<&str>,
) -> Option<Option<CandidateSeed<'a>>> {
    if top_type == Some("session_meta") {
        let root_payload;
        let payload = match payload {
            Some(payload) => payload,
            None if envelope.payload.is_none() => {
                root_payload = serde_json::from_str::<PayloadFields<'a>>(line).ok()?;
                &root_payload
            }
            None => return Some(None),
        };
        return Some(typed_session_meta(payload).map(|entry| CandidateSeed {
            entry: CandidateEntry::Ready(entry),
            source: CandidateSource::EventSystem,
            stable_id: typed_stable_id(payload),
            timestamp: typed_timestamp(envelope).or_else(|| typed_payload_timestamp(payload)),
            is_user_message: false,
        }));
    }

    let payload = payload?;
    if top_type == Some("event_msg") && payload_type == Some("item_completed") {
        let item: Value = serde_json::from_str(payload.item?.get()).ok()?;
        item.get("questions")?;
        return Some(question_seed(&item, typed_timestamp(envelope)));
    }
    let source = match (top_type, payload_type) {
        (Some("event_msg"), Some("user_message")) => CandidateSource::EventUserMessage,
        (Some("event_msg"), Some("agent_message")) => CandidateSource::EventAgentMessage,
        (Some("event_msg"), Some("exec_command_end" | "patch_apply_end")) => {
            CandidateSource::EventToolResult
        }
        (Some("event_msg"), Some("task_started" | "task_complete")) => CandidateSource::EventSystem,
        (Some("response_item"), Some("message")) => CandidateSource::ResponseMessage,
        (Some("response_item"), Some("function_call" | "custom_tool_call")) => {
            CandidateSource::ResponseToolCall
        }
        (Some("response_item"), Some("function_call_output" | "custom_tool_call_output")) => {
            CandidateSource::ResponseToolResult
        }
        _ => return None,
    };

    let entry = match (top_type, payload_type) {
        (Some("event_msg"), Some("user_message")) => {
            typed_string(payload.message).map(CandidateEntry::User)
        }
        (Some("event_msg"), Some("agent_message")) => typed_string(payload.message).map(|text| {
            CandidateEntry::Ready(RenderedEntry {
                kind: RenderedEntryKind::Codex,
                content: text.into_owned(),
            })
        }),
        (Some("event_msg"), Some("exec_command_end")) => {
            typed_exec_command_end(payload).map(CandidateEntry::Ready)
        }
        (Some("event_msg"), Some("patch_apply_end")) => {
            typed_patch_apply_end(payload).map(CandidateEntry::Ready)
        }
        (Some("event_msg"), Some("task_started")) => Some(CandidateEntry::Ready(
            typed_task_lifecycle("Task started", payload),
        )),
        (Some("event_msg"), Some("task_complete")) => Some(CandidateEntry::Ready(
            typed_task_lifecycle("Task complete", payload),
        )),
        (Some("response_item"), Some("message")) => typed_response_message(payload),
        (Some("response_item"), Some("function_call")) => {
            typed_tool_call(payload, "Function call").map(CandidateEntry::Ready)
        }
        (Some("response_item"), Some("custom_tool_call")) => {
            typed_tool_call(payload, "Custom tool call").map(CandidateEntry::Ready)
        }
        (Some("response_item"), Some("function_call_output")) => {
            typed_tool_result(payload, "Function call output").map(CandidateEntry::Ready)
        }
        (Some("response_item"), Some("custom_tool_call_output")) => {
            typed_tool_result(payload, "Custom tool call output").map(CandidateEntry::Ready)
        }
        _ => unreachable!("typed focused source already matched supported envelope types"),
    };

    Some(entry.map(|entry| CandidateSeed {
        is_user_message: matches!(
            (top_type, payload_type),
            (Some("event_msg"), Some("user_message"))
        ) || matches!(
            (top_type, payload_type, json_string(payload.role).as_deref()),
            (Some("response_item"), Some("message"), Some("user"))
        ),
        entry,
        source,
        stable_id: typed_focused_stable_id(payload_type, payload),
        timestamp: typed_timestamp(envelope).or_else(|| typed_payload_timestamp(payload)),
    }))
}

fn json_string(raw: Option<&RawValue>) -> Option<Cow<'_, str>> {
    serde_json::from_str::<Cow<'_, str>>(raw?.get()).ok()
}

fn typed_string(raw: Option<&RawValue>) -> Option<Cow<'_, str>> {
    trimmed_nonempty(json_string(raw)?)
}

fn typed_text(raw: Option<&RawValue>) -> Option<Cow<'_, str>> {
    let raw = raw?;
    if raw.get().trim_start().starts_with('"') {
        return json_string(Some(raw));
    }
    let value = serde_json::from_str::<Value>(raw.get()).ok()?;
    text_from_value(&value).map(Cow::Owned)
}

fn trimmed_nonempty(text: Cow<'_, str>) -> Option<Cow<'_, str>> {
    match text {
        Cow::Borrowed(text) => {
            let text = text.trim();
            (!text.is_empty()).then_some(Cow::Borrowed(text))
        }
        Cow::Owned(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else if trimmed.len() == text.len() {
                Some(Cow::Owned(text))
            } else {
                Some(Cow::Owned(trimmed.to_owned()))
            }
        }
    }
}

fn typed_extract_text<'a>(payload: &PayloadFields<'a>) -> Option<Cow<'a, str>> {
    [
        payload.content,
        payload.text,
        payload.message,
        payload.output,
        payload.result,
        payload.summary,
    ]
    .into_iter()
    .find_map(typed_text)
}

fn typed_stable_id(payload: &PayloadFields<'_>) -> Option<String> {
    [
        payload.id,
        payload.call_id,
        payload.turn_id,
        payload.turn_id_camel,
    ]
    .into_iter()
    .find_map(typed_string)
    .map(Cow::into_owned)
}

fn typed_focused_stable_id(
    payload_type: Option<&str>,
    payload: &PayloadFields<'_>,
) -> Option<String> {
    match payload_type {
        Some(payload_type @ ("task_started" | "task_complete")) => {
            typed_stable_id(payload).map(|stable_id| format!("{payload_type}:{stable_id}"))
        }
        _ => typed_stable_id(payload),
    }
}

fn typed_timestamp(envelope: &EnvelopeFields<'_>) -> Option<String> {
    [
        envelope.timestamp,
        envelope.time,
        envelope.created_at,
        envelope.created_at_camel,
    ]
    .into_iter()
    .find_map(typed_string)
    .map(Cow::into_owned)
}

fn typed_payload_timestamp(payload: &PayloadFields<'_>) -> Option<String> {
    [
        payload.timestamp,
        payload.time,
        payload.created_at,
        payload.created_at_camel,
    ]
    .into_iter()
    .find_map(typed_string)
    .map(Cow::into_owned)
}

fn typed_response_message<'a>(payload: &PayloadFields<'a>) -> Option<CandidateEntry<'a>> {
    let role = json_string(payload.role)?;
    let content = trimmed_nonempty(typed_extract_text(payload)?)?;
    if role == "user" {
        return Some(CandidateEntry::User(content));
    }

    let kind = match role.as_ref() {
        "assistant" | "model" => RenderedEntryKind::Codex,
        "tool" => RenderedEntryKind::ToolResult,
        "system" => RenderedEntryKind::System,
        _ => return None,
    };
    Some(CandidateEntry::Ready(RenderedEntry {
        kind,
        content: content.into_owned(),
    }))
}

fn typed_exec_command_end(payload: &PayloadFields<'_>) -> Option<RenderedEntry> {
    let mut lines = vec!["Exec command finished".to_owned()];
    if let Some(command) = typed_string(payload.command).or_else(|| typed_string(payload.cmd)) {
        lines.push(format!("Command: {command}"));
    }
    if let Some(status) = typed_string(payload.status) {
        lines.push(format!("Status: {status}"));
    }
    if let Some(exit_code) = typed_scalar_to_string(payload.exit_code)
        .or_else(|| typed_scalar_to_string(payload.exit_code_camel))
    {
        lines.push(format!("Exit code: {exit_code}"));
    }
    if let Some(output) = [
        payload.aggregated_output,
        payload.formatted_output,
        payload.stdout,
        payload.stderr,
    ]
    .into_iter()
    .find_map(|raw| typed_text(raw).and_then(trimmed_nonempty))
    {
        lines.push(output.into_owned());
    }
    (lines.len() > 1).then(|| RenderedEntry {
        kind: RenderedEntryKind::ToolResult,
        content: lines.join("\n"),
    })
}

fn typed_patch_apply_end(payload: &PayloadFields<'_>) -> Option<RenderedEntry> {
    let status = typed_string(payload.status)?;
    Some(RenderedEntry {
        kind: RenderedEntryKind::ToolResult,
        content: format!("Patch apply status: {status}"),
    })
}

fn typed_task_lifecycle(label: &str, payload: &PayloadFields<'_>) -> RenderedEntry {
    let mut content = label.to_owned();
    if let Some(turn_id) =
        typed_string(payload.turn_id).or_else(|| typed_string(payload.turn_id_camel))
    {
        content.push_str("\nTurn: ");
        content.push_str(&turn_id);
    }
    RenderedEntry {
        kind: RenderedEntryKind::System,
        content,
    }
}

fn typed_session_meta(payload: &PayloadFields<'_>) -> Option<RenderedEntry> {
    let mut lines = Vec::new();
    if let Some(id) = typed_string(payload.id) {
        lines.push(format!("Session: {id}"));
    }
    if let Some(provider) = typed_string(payload.model_provider) {
        lines.push(format!("Model provider: {provider}"));
    }
    if let Some(version) = typed_string(payload.cli_version) {
        lines.push(format!("CLI version: {version}"));
    }
    (!lines.is_empty()).then(|| RenderedEntry {
        kind: RenderedEntryKind::System,
        content: lines.join("\n"),
    })
}

fn typed_tool_call(payload: &PayloadFields<'_>, label: &str) -> Option<RenderedEntry> {
    let name = json_string(payload.name)
        .or_else(|| json_string(payload.call_id))
        .or_else(|| json_string(payload.id))?;
    let mut content = format!("{label}: {name}");
    if let Some(arguments) = typed_tool_arguments(payload) {
        content.push('\n');
        content.push_str(&arguments);
    }
    Some(RenderedEntry {
        kind: RenderedEntryKind::ToolCall,
        content,
    })
}

fn typed_tool_result(payload: &PayloadFields<'_>, label: &str) -> Option<RenderedEntry> {
    let content = match typed_extract_text(payload) {
        Some(content) => content,
        None => Cow::Owned(format!("{label}: {}", json_string(payload.call_id)?)),
    };
    let content = trimmed_nonempty(content)?.into_owned();
    Some(RenderedEntry {
        kind: RenderedEntryKind::ToolResult,
        content,
    })
}

fn typed_tool_arguments(payload: &PayloadFields<'_>) -> Option<String> {
    if let Some(arguments) = payload.arguments {
        if let Some(arguments) = typed_string(Some(arguments)) {
            return Some(arguments.into_owned());
        }
        let value = serde_json::from_str::<Value>(arguments.get()).ok()?;
        return matches!(value, Value::Object(_) | Value::Array(_)).then(|| value.to_string());
    }
    typed_string(payload.input)
        .map(Cow::into_owned)
        .or_else(|| typed_extract_text(payload).map(Cow::into_owned))
}

fn typed_scalar_to_string(raw: Option<&RawValue>) -> Option<String> {
    let raw = raw?;
    if let Some(text) = typed_string(Some(raw)) {
        return Some(text.into_owned());
    }
    let value = serde_json::from_str::<Value>(raw.get()).ok()?;
    value.as_number().map(ToString::to_string)
}

fn parsed_candidate(
    seed: CandidateSeed,
) -> (
    Option<ParsedCandidate>,
    Option<String>,
    Option<ReferencedConversation>,
) {
    let (entry, reference) = match seed.entry {
        CandidateEntry::User(content) => match decode_user_transport_borrowed(&content) {
            Some(BorrowedUserTransport::HumanRequest { request, reference }) => {
                (Some(classify_user_message(&request)), reference)
            }
            Some(BorrowedUserTransport::DelegatedHandoff { reference }) => (None, Some(reference)),
            None => (Some(classify_user_message(&content)), None),
        },
        CandidateEntry::Ready(entry) if seed.is_user_message => {
            match decode_user_transport(&entry.content) {
                Some(DecodedUserTransport::HumanRequest { request, reference }) => {
                    (Some(classify_user_message(&request)), reference)
                }
                Some(DecodedUserTransport::DelegatedHandoff { reference }) => {
                    (None, Some(reference))
                }
                None => (Some(entry), None),
            }
        }
        CandidateEntry::Ready(entry) => (Some(entry), None),
    };
    let Some(entry) = entry else {
        return (None, None, reference);
    };
    let stable_key = seed
        .stable_id
        .map(|stable_id| format!("{}:{stable_id}", rendered_kind_key(entry.kind)));

    let candidate = ParsedCandidate {
        entry,
        stable_slot: None,
        source: seed.source,
        timestamp: seed.timestamp,
    };
    (Some(candidate), stable_key, reference)
}

fn extract_candidate_seeds(value: &Value) -> Vec<CandidateSeed<'static>> {
    match extract_focused_seed(value) {
        Some(Some(entry)) => vec![entry],
        Some(None) => Vec::new(),
        None => extract_fallback_seeds(value),
    }
}

fn extract_focused_seed(value: &Value) -> Option<Option<CandidateSeed<'static>>> {
    let top_type = string_field(value, "type")?;
    if top_type == "session_meta" {
        let payload = value.get("payload").unwrap_or(value);
        return Some(extract_session_meta(payload).map(|entry| CandidateSeed {
            entry: CandidateEntry::Ready(entry),
            source: CandidateSource::EventSystem,
            stable_id: stable_id(payload),
            timestamp: timestamp(value).or_else(|| timestamp(payload)),
            is_user_message: false,
        }));
    }

    let payload = value.get("payload")?;
    let payload_type = string_field(payload, "type");

    if top_type == "event_msg" && payload_type == Some("item_completed") {
        let item = payload.get("item")?;
        item.get("questions")?;
        return Some(question_seed(item, timestamp(value)));
    }

    let source = match (top_type, payload_type) {
        ("event_msg", Some("user_message")) => CandidateSource::EventUserMessage,
        ("event_msg", Some("agent_message")) => CandidateSource::EventAgentMessage,
        ("event_msg", Some("exec_command_end" | "patch_apply_end")) => {
            CandidateSource::EventToolResult
        }
        ("event_msg", Some("task_started" | "task_complete")) => CandidateSource::EventSystem,
        ("response_item", Some("message")) => CandidateSource::ResponseMessage,
        ("response_item", Some("function_call" | "custom_tool_call")) => {
            CandidateSource::ResponseToolCall
        }
        ("response_item", Some("function_call_output" | "custom_tool_call_output")) => {
            CandidateSource::ResponseToolResult
        }
        _ => return None,
    };

    let entry = match (top_type, payload_type) {
        ("event_msg", Some("user_message")) => string_field(payload, "message")
            .map(str::trim)
            .filter(|content| !content.is_empty())
            .map(classify_user_message),
        ("event_msg", Some("agent_message")) => string_field(payload, "message")
            .map(str::trim)
            .filter(|content| !content.is_empty())
            .map(|content| RenderedEntry {
                kind: RenderedEntryKind::Codex,
                content: content.to_owned(),
            }),
        ("event_msg", Some("exec_command_end")) => extract_exec_command_end(payload),
        ("event_msg", Some("patch_apply_end")) => extract_patch_apply_end(payload),
        ("event_msg", Some("task_started")) => {
            Some(extract_task_lifecycle("Task started", payload))
        }
        ("event_msg", Some("task_complete")) => {
            Some(extract_task_lifecycle("Task complete", payload))
        }
        ("response_item", Some("message")) => extract_response_message(payload),
        ("response_item", Some("function_call")) => extract_tool_call(payload, "Function call"),
        ("response_item", Some("custom_tool_call")) => {
            extract_tool_call(payload, "Custom tool call")
        }
        ("response_item", Some("function_call_output")) => {
            extract_tool_result(payload, "Function call output")
        }
        ("response_item", Some("custom_tool_call_output")) => {
            extract_tool_result(payload, "Custom tool call output")
        }
        _ => unreachable!("focused source already matched supported envelope types"),
    };

    Some(entry.map(|entry| CandidateSeed {
        is_user_message: matches!(
            (top_type, payload_type),
            ("event_msg", Some("user_message"))
        ) || matches!(
            (top_type, payload_type, string_field(payload, "role")),
            ("response_item", Some("message"), Some("user"))
        ),
        entry: CandidateEntry::Ready(entry),
        source,
        stable_id: focused_stable_id(payload_type, payload),
        timestamp: timestamp(value).or_else(|| timestamp(payload)),
    }))
}

fn question_seed(item: &Value, timestamp: Option<String>) -> Option<CandidateSeed<'static>> {
    let questions = item.get("questions")?.as_array()?;
    let mut parts = Vec::new();
    for question in questions {
        let title = question.get("title")?.as_str()?;
        if title.trim().is_empty() {
            return None;
        }
        let mut content = title.to_owned();
        match question.get("options") {
            None | Some(Value::Null) => {}
            Some(Value::Array(options)) => {
                for option in options {
                    content.push_str("\n- ");
                    content.push_str(option.as_str()?);
                }
            }
            _ => return None,
        }
        parts.push(content);
    }
    if parts.is_empty() {
        return None;
    }
    Some(CandidateSeed {
        entry: CandidateEntry::Ready(RenderedEntry {
            kind: RenderedEntryKind::Codex,
            content: parts.join("\n\n"),
        }),
        source: CandidateSource::EventUserQuestion,
        stable_id: string_field(item, "id")
            .filter(|id| !id.trim().is_empty())
            .map(|id| format!("question:{id}")),
        timestamp,
        is_user_message: false,
    })
}

fn extract_fallback_seeds(value: &Value) -> Vec<CandidateSeed<'static>> {
    let mut seeds = Vec::new();

    if let Some(seed) = extract_fallback_seed(value) {
        seeds.push(seed);
    }

    for field in ["message", "item", "delta"] {
        if let Some(seed) = value.get(field).and_then(extract_fallback_seed) {
            seeds.push(seed);
        }
    }

    if let Some(output) = value.get("output").and_then(Value::as_array) {
        seeds.extend(output.iter().filter_map(extract_fallback_seed));
    }

    seeds
}

fn extract_fallback_seed(value: &Value) -> Option<CandidateSeed<'static>> {
    extract_role_based_entry(value)
        .or_else(|| extract_type_based_entry(value))
        .map(|entry| CandidateSeed {
            is_user_message: is_fallback_user_message(value),
            entry: CandidateEntry::Ready(entry),
            source: CandidateSource::Fallback,
            stable_id: stable_id(value),
            timestamp: timestamp(value),
        })
}

fn is_fallback_user_message(value: &Value) -> bool {
    string_field(value, "role") == Some("user")
        || string_field(value, "type")
            .is_some_and(|type_name| type_name.to_ascii_lowercase().contains("user"))
}

fn extract_role_based_entry(value: &Value) -> Option<RenderedEntry> {
    let role = string_field(value, "role")?;
    let content = extract_text(value)?.trim().to_owned();
    if content.is_empty() {
        return None;
    }

    if role == "user" {
        return Some(classify_user_message(&content));
    }

    let kind = match role {
        "assistant" | "model" => RenderedEntryKind::Codex,
        "tool" => RenderedEntryKind::ToolResult,
        "system" => RenderedEntryKind::System,
        _ => return None,
    };

    Some(RenderedEntry { kind, content })
}

fn extract_type_based_entry(value: &Value) -> Option<RenderedEntry> {
    let type_name = string_field(value, "type")?;
    let normalized_type = type_name.to_ascii_lowercase();
    let content = fallback_type_content(value, &normalized_type)?;

    if normalized_type.contains("user") {
        return Some(classify_user_message(&content));
    }

    let kind = if normalized_type.contains("assistant")
        || normalized_type.contains("model")
        || normalized_type.contains("agent")
    {
        RenderedEntryKind::Codex
    } else if normalized_type.contains("system") || normalized_type.contains("session") {
        RenderedEntryKind::System
    } else if is_tool_call_type(&normalized_type) {
        RenderedEntryKind::ToolCall
    } else if is_tool_result_type(&normalized_type) {
        RenderedEntryKind::ToolResult
    } else {
        return None;
    };

    Some(RenderedEntry { kind, content })
}

fn fallback_type_content(value: &Value, normalized_type: &str) -> Option<String> {
    if is_tool_call_type(normalized_type) {
        if let Some(name) = string_field(value, "name")
            .or_else(|| string_field(value, "call_id"))
            .or_else(|| string_field(value, "id"))
            .map(str::trim)
            .filter(|name| !name.is_empty())
        {
            let mut content = format!("Tool call: {name}");
            if let Some(arguments) = extract_tool_arguments(value) {
                content.push('\n');
                content.push_str(&arguments);
            }
            return Some(content);
        }
    }

    extract_text(value)
        .map(|content| content.trim().to_owned())
        .filter(|content| !content.is_empty())
}

fn is_tool_call_type(normalized_type: &str) -> bool {
    (normalized_type.contains("tool_call")
        || normalized_type.contains("function_call")
        || normalized_type.contains("command"))
        && !normalized_type.contains("output")
        && !normalized_type.contains("result")
        && !normalized_type.contains("end")
}

fn is_tool_result_type(normalized_type: &str) -> bool {
    normalized_type.contains("tool_result")
        || normalized_type.contains("function_result")
        || normalized_type.contains("command_result")
        || normalized_type.contains("output")
        || normalized_type.contains("end")
}

fn suppress_adjacent_duplicates(candidates: Vec<ParsedCandidate>) -> Vec<ParsedCandidate> {
    let mut deduped: Vec<ParsedCandidate> = Vec::new();

    for candidate in candidates {
        if let Some(previous) = deduped.last_mut() {
            if should_suppress_adjacent_duplicate(previous, &candidate) {
                if should_replace_candidate(previous, &candidate) {
                    *previous = candidate;
                }
                continue;
            }
        }

        deduped.push(candidate);
    }

    deduped
}

fn should_suppress_adjacent_duplicate(
    previous: &ParsedCandidate,
    candidate: &ParsedCandidate,
) -> bool {
    if previous.source == CandidateSource::EventUserQuestion
        || candidate.source == CandidateSource::EventUserQuestion
    {
        return false;
    }
    if previous.entry.kind != candidate.entry.kind
        || !normalized_text_eq(&previous.entry.content, &candidate.entry.content)
    {
        return false;
    }

    if let (Some(previous_slot), Some(candidate_slot)) =
        (previous.stable_slot, candidate.stable_slot)
        && previous_slot != candidate_slot
    {
        return false;
    }

    if previous.timestamp.is_some()
        && candidate.timestamp.is_some()
        && previous.timestamp == candidate.timestamp
    {
        return true;
    }

    is_known_duplicate_source_pair(previous.source, candidate.source)
}

fn is_known_duplicate_source_pair(left: CandidateSource, right: CandidateSource) -> bool {
    matches!(
        (left, right),
        (
            CandidateSource::EventUserMessage,
            CandidateSource::ResponseMessage
        ) | (
            CandidateSource::ResponseMessage,
            CandidateSource::EventUserMessage
        ) | (
            CandidateSource::EventAgentMessage,
            CandidateSource::ResponseMessage
        ) | (
            CandidateSource::ResponseMessage,
            CandidateSource::EventAgentMessage
        ) | (
            CandidateSource::EventToolResult,
            CandidateSource::ResponseToolResult
        ) | (
            CandidateSource::ResponseToolResult,
            CandidateSource::EventToolResult
        )
    )
}

fn should_replace_candidate(current: &ParsedCandidate, candidate: &ParsedCandidate) -> bool {
    let current_priority = current.source.priority();
    let candidate_priority = candidate.source.priority();

    candidate_priority > current_priority
        || (candidate_priority == current_priority
            && candidate.entry.content.len() > current.entry.content.len())
}

fn focused_stable_id(payload_type: Option<&str>, payload: &Value) -> Option<String> {
    match payload_type {
        Some(payload_type @ ("task_started" | "task_complete")) => {
            stable_id(payload).map(|stable_id| format!("{payload_type}:{stable_id}"))
        }
        _ => stable_id(payload),
    }
}

fn stable_id(value: &Value) -> Option<String> {
    for field in ["id", "call_id", "turn_id", "turnId"] {
        if let Some(id) = string_field(value, field)
            .map(str::trim)
            .filter(|id| !id.is_empty())
        {
            return Some(id.to_owned());
        }
    }

    None
}

fn timestamp(value: &Value) -> Option<String> {
    for field in ["timestamp", "time", "created_at", "createdAt"] {
        if let Some(timestamp) = string_field(value, field)
            .map(str::trim)
            .filter(|timestamp| !timestamp.is_empty())
        {
            return Some(timestamp.to_owned());
        }
    }

    None
}

fn normalized_text_eq(left: &str, right: &str) -> bool {
    let mut left = left.split_whitespace();
    let mut right = right.split_whitespace();

    loop {
        match (left.next(), right.next()) {
            (Some(left), Some(right)) if left.eq_ignore_ascii_case(right) => {}
            (None, None) => return true,
            _ => return false,
        }
    }
}

fn rendered_kind_key(kind: RenderedEntryKind) -> &'static str {
    match kind {
        RenderedEntryKind::Context => "Context",
        RenderedEntryKind::Task => "Task",
        RenderedEntryKind::You => "You",
        RenderedEntryKind::Codex => "Codex",
        RenderedEntryKind::ToolCall => "ToolCall",
        RenderedEntryKind::ToolResult => "ToolResult",
        RenderedEntryKind::System => "System",
    }
}

fn extract_exec_command_end(payload: &Value) -> Option<RenderedEntry> {
    let mut lines = vec!["Exec command finished".to_owned()];

    if let Some(command) = string_field(payload, "command")
        .or_else(|| string_field(payload, "cmd"))
        .map(str::trim)
        .filter(|command| !command.is_empty())
    {
        lines.push(format!("Command: {command}"));
    }

    if let Some(status) = string_field(payload, "status")
        .map(str::trim)
        .filter(|status| !status.is_empty())
    {
        lines.push(format!("Status: {status}"));
    }

    if let Some(exit_code) = value_field_to_string(payload, "exit_code")
        .or_else(|| value_field_to_string(payload, "exitCode"))
    {
        lines.push(format!("Exit code: {exit_code}"));
    }

    if let Some(output) = extract_first_text_field(
        payload,
        &["aggregated_output", "formatted_output", "stdout", "stderr"],
    ) {
        lines.push(output);
    }

    if lines.len() == 1 {
        None
    } else {
        Some(RenderedEntry {
            kind: RenderedEntryKind::ToolResult,
            content: lines.join("\n"),
        })
    }
}

fn extract_patch_apply_end(payload: &Value) -> Option<RenderedEntry> {
    let status = string_field(payload, "status")?.trim();
    if status.is_empty() {
        return None;
    }

    Some(RenderedEntry {
        kind: RenderedEntryKind::ToolResult,
        content: format!("Patch apply status: {status}"),
    })
}

fn extract_task_lifecycle(label: &str, payload: &Value) -> RenderedEntry {
    let mut content = label.to_owned();
    if let Some(turn_id) = string_field(payload, "turn_id")
        .or_else(|| string_field(payload, "turnId"))
        .map(str::trim)
        .filter(|turn_id| !turn_id.is_empty())
    {
        content.push('\n');
        content.push_str("Turn: ");
        content.push_str(turn_id);
    }

    RenderedEntry {
        kind: RenderedEntryKind::System,
        content,
    }
}

fn extract_session_meta(payload: &Value) -> Option<RenderedEntry> {
    let mut lines = Vec::new();

    if let Some(id) = string_field(payload, "id")
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        lines.push(format!("Session: {id}"));
    }

    if let Some(provider) = string_field(payload, "model_provider")
        .map(str::trim)
        .filter(|provider| !provider.is_empty())
    {
        lines.push(format!("Model provider: {provider}"));
    }

    if let Some(version) = string_field(payload, "cli_version")
        .map(str::trim)
        .filter(|version| !version.is_empty())
    {
        lines.push(format!("CLI version: {version}"));
    }

    if lines.is_empty() {
        None
    } else {
        Some(RenderedEntry {
            kind: RenderedEntryKind::System,
            content: lines.join("\n"),
        })
    }
}

fn extract_response_message(payload: &Value) -> Option<RenderedEntry> {
    let role = string_field(payload, "role")?;
    let content = extract_text(payload)?.trim().to_owned();
    if content.is_empty() {
        return None;
    }

    if role == "user" {
        return Some(classify_user_message(&content));
    }

    let kind = match role {
        "assistant" | "model" => RenderedEntryKind::Codex,
        "tool" => RenderedEntryKind::ToolResult,
        "system" => RenderedEntryKind::System,
        _ => return None,
    };

    Some(RenderedEntry { kind, content })
}

fn extract_tool_call(payload: &Value, label: &str) -> Option<RenderedEntry> {
    let name = string_field(payload, "name")
        .or_else(|| string_field(payload, "call_id"))
        .or_else(|| string_field(payload, "id"))?;

    let mut content = format!("{label}: {name}");
    if let Some(arguments) = extract_tool_arguments(payload) {
        content.push('\n');
        content.push_str(&arguments);
    }

    Some(RenderedEntry {
        kind: RenderedEntryKind::ToolCall,
        content,
    })
}

fn extract_tool_result(payload: &Value, label: &str) -> Option<RenderedEntry> {
    let content = extract_text(payload)
        .or_else(|| string_field(payload, "call_id").map(|call_id| format!("{label}: {call_id}")))?
        .trim()
        .to_owned();

    if content.is_empty() {
        None
    } else {
        Some(RenderedEntry {
            kind: RenderedEntryKind::ToolResult,
            content,
        })
    }
}

fn extract_tool_arguments(payload: &Value) -> Option<String> {
    if let Some(arguments) = payload.get("arguments") {
        return match arguments {
            Value::String(arguments) => {
                let arguments = arguments.trim();
                (!arguments.is_empty()).then(|| arguments.to_owned())
            }
            Value::Object(_) | Value::Array(_) => Some(arguments.to_string()),
            _ => None,
        };
    }

    string_field(payload, "input")
        .map(str::trim)
        .filter(|input| !input.is_empty())
        .map(str::to_owned)
        .or_else(|| extract_text(payload))
}

fn classify_user_message(content: &str) -> RenderedEntry {
    let trimmed = content.trim();
    let kind = classify_user_message_kind(trimmed);

    RenderedEntry {
        kind,
        content: match kind {
            RenderedEntryKind::Context => "AGENTS.md project instructions loaded".to_owned(),
            RenderedEntryKind::Task => "Task or prompt instructions loaded".to_owned(),
            _ => trimmed.to_owned(),
        },
    }
}

fn classify_user_message_kind(content: &str) -> RenderedEntryKind {
    if is_agents_instructions(content) {
        RenderedEntryKind::Context
    } else if is_structured_task_or_prompt(content) {
        RenderedEntryKind::Task
    } else {
        RenderedEntryKind::You
    }
}

fn is_agents_instructions(content: &str) -> bool {
    content.contains("# AGENTS.md")
        || content.contains("AGENTS.md instructions")
        || content.contains("<INSTRUCTIONS>")
}

fn is_structured_task_or_prompt(content: &str) -> bool {
    [
        "<environment_context>",
        "<user_instructions>",
        "<developer_context>",
        "<task>",
        "<prompt>",
    ]
    .iter()
    .any(|marker| content.contains(marker))
}

fn extract_text(value: &Value) -> Option<String> {
    for field in ["content", "text", "message", "output", "result", "summary"] {
        if let Some(raw_value) = value.get(field) {
            if let Some(text) = text_from_value(raw_value) {
                return Some(text);
            }
        }
    }

    None
}

fn extract_first_text_field(value: &Value, fields: &[&str]) -> Option<String> {
    fields.iter().find_map(|field| {
        value
            .get(*field)
            .and_then(text_from_value)
            .map(|text| text.trim().to_owned())
            .filter(|text| !text.is_empty())
    })
}

fn text_from_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Array(values) => {
            let text = values
                .iter()
                .filter_map(text_from_value)
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_owned();

            (!text.is_empty()).then_some(text)
        }
        Value::Object(_) => {
            if let Some(nested) = value.get("text").and_then(text_from_value) {
                return Some(nested);
            }

            for field in ["value", "content", "message"] {
                if let Some(nested) = value.get(field).and_then(text_from_value) {
                    return Some(nested);
                }
            }

            None
        }
        _ => None,
    }
}

fn value_field_to_string(value: &Value, field: &str) -> Option<String> {
    let value = value.get(field)?;
    match value {
        Value::String(text) => {
            let text = text.trim();
            (!text.is_empty()).then(|| text.to_owned())
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn string_field<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field)?.as_str()
}

#[cfg(test)]
mod tests {
    use std::{
        cell::Cell,
        fs,
        io::{Cursor, Read},
        rc::Rc,
    };

    use super::*;

    fn parse_legacy_for_differential_test(input: &str) -> ParsedChatLog {
        let mut candidates = CandidateAccumulator::default();
        let mut session_provenance = SessionProvenance::default();
        let mut parsed_candidates = 0;
        let mut ignored_lines = 0;
        let mut malformed_lines = 0;
        let mut observed_event_counts = IndexMap::new();

        for raw_line in input.lines() {
            let line = raw_line.trim();
            if line.is_empty() {
                continue;
            }
            let value = match serde_json::from_str::<Value>(line) {
                Ok(value) => value,
                Err(_) => {
                    malformed_lines += 1;
                    continue;
                }
            };
            increment_observed_event_count(&mut observed_event_counts, &value);
            let extracted = extract_candidate_seeds(&value);
            if extracted.is_empty() {
                ignored_lines += 1;
                continue;
            }
            parsed_candidates += extracted.len();
            for seed in extracted {
                let (candidate, stable_key, reference) = parsed_candidate(seed);
                if let Some(reference) = reference {
                    session_provenance.observe_reference(reference);
                }
                if let Some(candidate) = candidate {
                    candidates.push(candidate, stable_key);
                }
            }
        }

        let (entries, entry_timestamps) = candidates
            .finish()
            .into_iter()
            .map(|candidate| (candidate.entry, candidate.timestamp))
            .unzip();
        ParsedChatLog {
            entries,
            entry_timestamps,
            session_provenance,
            parsed_candidates,
            ignored_lines,
            malformed_lines,
            observed_event_counts,
        }
    }

    struct RepeatingJsonlReader {
        record: &'static [u8],
        remaining: usize,
        offset: usize,
        max_requested: Rc<Cell<usize>>,
    }

    impl Read for RepeatingJsonlReader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            self.max_requested
                .set(self.max_requested.get().max(buffer.len()));
            let mut written = 0;
            while written < buffer.len() && self.remaining > 0 {
                let available = self.record.len() - self.offset;
                let count = available.min(buffer.len() - written);
                buffer[written..written + count]
                    .copy_from_slice(&self.record[self.offset..self.offset + count]);
                written += count;
                self.offset += count;
                if self.offset == self.record.len() {
                    self.offset = 0;
                    self.remaining -= 1;
                }
            }
            Ok(written)
        }
    }
    use crate::domain::ChatEntryFilter;

    fn event_user_message_line(message: &str) -> String {
        serde_json::json!({
            "type": "event_msg",
            "payload": {
                "type": "user_message",
                "message": message
            }
        })
        .to_string()
    }

    fn response_user_message_line(content: &str) -> String {
        serde_json::json!({
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "content": content
            }
        })
        .to_string()
    }

    fn event_agent_message_line(message: &str) -> String {
        serde_json::json!({
            "type": "event_msg",
            "payload": {
                "type": "agent_message",
                "message": message
            }
        })
        .to_string()
    }

    fn event_msg_line(payload_type: &str, fields: serde_json::Value) -> String {
        let mut payload = serde_json::Map::new();
        payload.insert(
            "type".to_owned(),
            serde_json::Value::String(payload_type.to_owned()),
        );

        let serde_json::Value::Object(fields) = fields else {
            panic!("test fields must be a JSON object");
        };

        payload.extend(fields);

        serde_json::json!({
            "type": "event_msg",
            "payload": payload
        })
        .to_string()
    }

    fn response_message_line(role: &str, content: &str) -> String {
        serde_json::json!({
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": role,
                "content": content
            }
        })
        .to_string()
    }

    fn response_item_line(payload_type: &str, fields: serde_json::Value) -> String {
        let mut payload = serde_json::Map::new();
        payload.insert(
            "type".to_owned(),
            serde_json::Value::String(payload_type.to_owned()),
        );

        let serde_json::Value::Object(fields) = fields else {
            panic!("test fields must be a JSON object");
        };

        payload.extend(fields);

        serde_json::json!({
            "type": "response_item",
            "payload": payload
        })
        .to_string()
    }

    fn temp_file_path(name: &str) -> std::path::PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock is after Unix epoch")
            .as_nanos();

        std::env::temp_dir().join(format!(
            "codex-session-observatory-{name}-{}-{unique}.jsonl",
            std::process::id(),
        ))
    }

    #[test]
    fn parses_event_msg_user_message_from_string() {
        let parsed = parse_str(
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"hello"}}"#,
        );

        assert_eq!(parsed.malformed_lines, 0);
        assert_eq!(parsed.ignored_lines, 0);
        assert_eq!(parsed.parsed_candidates, 1);
        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::You,
                content: "hello".to_owned()
            }]
        );
    }

    #[test]
    fn parses_response_item_assistant_message_from_reader() {
        let input = Cursor::new(
            r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi from codex"}]}}"#,
        );

        let parsed = parse_reader(input).expect("reader parses");

        assert_eq!(parsed.parsed_candidates, 1);
        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::Codex,
                content: "hi from codex".to_owned()
            }]
        );
    }

    #[test]
    fn event_msg_agent_message_is_codex() {
        let parsed = parse_str(&event_agent_message_line("I can help with that."));

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::Codex,
                content: "I can help with that.".to_owned()
            }]
        );
    }

    #[test]
    fn response_item_assistant_message_is_codex() {
        let parsed = parse_str(&response_message_line("assistant", "Assistant response"));

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::Codex,
                content: "Assistant response".to_owned()
            }]
        );
    }

    #[test]
    fn response_item_model_message_is_codex() {
        let parsed = parse_str(&response_message_line("model", "Model response"));

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::Codex,
                content: "Model response".to_owned()
            }]
        );
    }

    #[test]
    fn response_item_system_message_is_system() {
        let parsed = parse_str(&response_message_line("system", "System message"));

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::System,
                content: "System message".to_owned()
            }]
        );
    }

    #[test]
    fn developer_messages_remain_ignored() {
        let parsed = parse_str(&response_message_line("developer", "Developer instruction"));

        assert_eq!(parsed.ignored_lines, 1);
        assert_eq!(parsed.parsed_candidates, 0);
        assert!(parsed.entries.is_empty());
    }

    #[test]
    fn event_msg_exec_command_end_is_tool_result() {
        let parsed = parse_str(&event_msg_line(
            "exec_command_end",
            serde_json::json!({
                "command": "cargo test",
                "status": "completed",
                "exit_code": 0,
                "aggregated_output": "test output"
            }),
        ));

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::ToolResult,
                content:
                    "Exec command finished\nCommand: cargo test\nStatus: completed\nExit code: 0\ntest output"
                        .to_owned()
            }]
        );
    }

    #[test]
    fn event_msg_exec_command_end_uses_first_available_output() {
        let parsed = parse_str(&event_msg_line(
            "exec_command_end",
            serde_json::json!({
                "cmd": "cargo fmt",
                "formatted_output": "formatted",
                "stdout": "stdout",
                "stderr": "stderr"
            }),
        ));

        assert_eq!(parsed.entries[0].kind, RenderedEntryKind::ToolResult);
        assert_eq!(
            parsed.entries[0].content,
            "Exec command finished\nCommand: cargo fmt\nformatted"
        );
    }

    #[test]
    fn event_msg_patch_apply_end_is_tool_result() {
        let parsed = parse_str(&event_msg_line(
            "patch_apply_end",
            serde_json::json!({
                "status": "success"
            }),
        ));

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::ToolResult,
                content: "Patch apply status: success".to_owned()
            }]
        );
    }

    #[test]
    fn event_msg_task_started_and_complete_are_system_entries() {
        let parsed = parse_str(
            &[
                event_msg_line("task_started", serde_json::json!({"turn_id": "turn_1"})),
                event_msg_line("task_complete", serde_json::json!({"turn_id": "turn_1"})),
            ]
            .join("\n"),
        );

        assert_eq!(
            parsed.entries,
            vec![
                RenderedEntry {
                    kind: RenderedEntryKind::System,
                    content: "Task started\nTurn: turn_1".to_owned()
                },
                RenderedEntry {
                    kind: RenderedEntryKind::System,
                    content: "Task complete\nTurn: turn_1".to_owned()
                }
            ]
        );
    }

    #[test]
    fn session_meta_is_system_entry() {
        let parsed = parse_str(
            r#"{"type":"session_meta","payload":{"id":"session_1","model_provider":"openai","cli_version":"1.2.3"}}"#,
        );

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::System,
                content: "Session: session_1\nModel provider: openai\nCLI version: 1.2.3"
                    .to_owned()
            }]
        );
    }

    #[test]
    fn new_envelopes_preserve_counts_for_ignored_and_observed_lines() {
        let parsed = parse_str(
            &[
                event_msg_line("exec_command_end", serde_json::json!({})),
                event_msg_line("patch_apply_end", serde_json::json!({"status": ""})),
                r#"{"type":"session_meta","payload":{}}"#.to_owned(),
                event_msg_line("task_started", serde_json::json!({})),
            ]
            .join("\n"),
        );

        assert_eq!(parsed.malformed_lines, 0);
        assert_eq!(parsed.ignored_lines, 3);
        assert_eq!(parsed.parsed_candidates, 1);
        assert_eq!(
            parsed.observed_event_counts["event_msg/exec_command_end"],
            1
        );
        assert_eq!(parsed.observed_event_counts["event_msg/patch_apply_end"], 1);
        assert_eq!(parsed.observed_event_counts["session_meta"], 1);
        assert_eq!(parsed.observed_event_counts["event_msg/task_started"], 1);
    }

    #[test]
    fn response_item_function_call_is_tool_call() {
        let parsed = parse_str(&response_item_line(
            "function_call",
            serde_json::json!({
                "name": "read_file",
                "arguments": "{\"path\":\"README.md\"}"
            }),
        ));

        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].kind, RenderedEntryKind::ToolCall);
        assert_eq!(
            parsed.entries[0].content,
            "Function call: read_file\n{\"path\":\"README.md\"}"
        );
    }

    #[test]
    fn response_item_custom_tool_call_is_tool_call() {
        let parsed = parse_str(&response_item_line(
            "custom_tool_call",
            serde_json::json!({
                "name": "shell_command",
                "input": "cargo test"
            }),
        ));

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::ToolCall,
                content: "Custom tool call: shell_command\ncargo test".to_owned()
            }]
        );
    }

    #[test]
    fn response_item_function_call_output_is_tool_result() {
        let parsed = parse_str(&response_item_line(
            "function_call_output",
            serde_json::json!({
                "call_id": "call_1",
                "output": "file contents"
            }),
        ));

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::ToolResult,
                content: "file contents".to_owned()
            }]
        );
    }

    #[test]
    fn response_item_custom_tool_call_output_is_tool_result() {
        let parsed = parse_str(&response_item_line(
            "custom_tool_call_output",
            serde_json::json!({
                "call_id": "call_2",
                "content": [{"text": "command output"}]
            }),
        ));

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::ToolResult,
                content: "command output".to_owned()
            }]
        );
    }

    #[test]
    fn observed_event_counts_include_tool_lines() {
        let parsed = parse_str(
            &[
                response_item_line("function_call", serde_json::json!({"name": "read_file"})),
                response_item_line(
                    "custom_tool_call_output",
                    serde_json::json!({"output": "done"}),
                ),
            ]
            .join("\n"),
        );

        assert_eq!(
            parsed.observed_event_counts["response_item/function_call"],
            1
        );
        assert_eq!(
            parsed.observed_event_counts["response_item/custom_tool_call_output"],
            1
        );
    }

    #[test]
    fn incomplete_or_unsupported_tool_payloads_are_ignored_safely() {
        let parsed = parse_str(
            &[
                response_item_line("function_call", serde_json::json!({"arguments": "{}"})),
                response_item_line("custom_tool_call_output", serde_json::json!({})),
                response_item_line("unsupported_tool", serde_json::json!({"name": "noop"})),
            ]
            .join("\n"),
        );

        assert_eq!(parsed.malformed_lines, 0);
        assert_eq!(parsed.ignored_lines, 3);
        assert_eq!(parsed.parsed_candidates, 0);
        assert!(parsed.entries.is_empty());
    }

    #[test]
    fn fallback_extracts_role_based_entry_from_root_object() {
        let parsed =
            parse_str(r#"{"role":"user","content":"Please inspect this fallback shape."}"#);

        assert_eq!(parsed.ignored_lines, 0);
        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::You,
                content: "Please inspect this fallback shape.".to_owned()
            }]
        );
    }

    #[test]
    fn fallback_extracts_role_based_entry_from_nested_message() {
        let parsed = parse_str(
            r#"{"type":"unknown","message":{"role":"assistant","content":"Nested assistant text"}}"#,
        );

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::Codex,
                content: "Nested assistant text".to_owned()
            }]
        );
    }

    #[test]
    fn fallback_extracts_type_based_entry_from_nested_item() {
        let parsed =
            parse_str(r#"{"type":"unknown","item":{"type":"system_note","text":"System note"}}"#);

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::System,
                content: "System note".to_owned()
            }]
        );
    }

    #[test]
    fn fallback_extracts_type_based_tool_call_from_nested_delta() {
        let parsed = parse_str(
            r#"{"type":"unknown","delta":{"type":"function_call","name":"read_file","arguments":{"path":"README.md"}}}"#,
        );

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::ToolCall,
                content: r#"Tool call: read_file
{"path":"README.md"}"#
                    .to_owned()
            }]
        );
    }

    #[test]
    fn fallback_extracts_each_object_inside_root_output_array() {
        let parsed = parse_str(
            r#"{"type":"unknown","output":[{"type":"assistant_message","text":"Assistant output"},{"type":"command_output","output":"Command output"},{"type":"ignored"}]}"#,
        );

        assert_eq!(parsed.ignored_lines, 0);
        assert_eq!(parsed.parsed_candidates, 2);
        assert_eq!(
            parsed.entries,
            vec![
                RenderedEntry {
                    kind: RenderedEntryKind::Codex,
                    content: "Assistant output".to_owned()
                },
                RenderedEntry {
                    kind: RenderedEntryKind::ToolResult,
                    content: "Command output".to_owned()
                }
            ]
        );
    }

    #[test]
    fn fallback_role_based_developer_entries_remain_ignored() {
        let parsed = parse_str(r#"{"role":"developer","content":"Developer instruction"}"#);

        assert_eq!(parsed.ignored_lines, 1);
        assert_eq!(parsed.parsed_candidates, 0);
        assert!(parsed.entries.is_empty());
    }

    #[test]
    fn focused_envelope_empty_payload_does_not_fall_back() {
        let parsed = parse_str(
            r#"{"type":"event_msg","payload":{"type":"user_message"},"message":{"role":"assistant","content":"fallback should not render"}}"#,
        );

        assert_eq!(parsed.ignored_lines, 1);
        assert_eq!(parsed.parsed_candidates, 0);
        assert!(parsed.entries.is_empty());
    }

    #[test]
    fn realistic_inline_fixture_verifies_parser_output_contract_before_api() {
        let parsed = parse_str(
            &[
                event_user_message_line(
                    "# AGENTS.md instructions\n<INSTRUCTIONS>sanitized</INSTRUCTIONS>",
                ),
                r#"{"type":"event_msg","payload":{"type":"user_message","id":"user_1","message":"Please inspect this parser."}}"#.to_owned(),
                r#"{"type":"response_item","payload":{"type":"message","id":"user_1","role":"user","content":"Please inspect this parser."}}"#.to_owned(),
                event_agent_message_line("I will inspect it."),
                response_message_line("assistant", "I will inspect it."),
                r#"{"type":"session_meta","payload":{"id":"session_1","model_provider":"openai","cli_version":"1.0.0"}}"#.to_owned(),
                response_item_line(
                    "function_call",
                    serde_json::json!({
                        "call_id": "call_1",
                        "name": "read_file",
                        "arguments": "{\"path\":\"sanitized.jsonl\"}"
                    }),
                ),
                event_msg_line(
                    "exec_command_end",
                    serde_json::json!({
                        "call_id": "call_2",
                        "command": "cargo test",
                        "exit_code": 0,
                        "stdout": "tests ok"
                    }),
                ),
                response_item_line(
                    "function_call_output",
                    serde_json::json!({
                        "call_id": "call_2",
                        "output": "tests ok with details"
                    }),
                ),
                r#"{"type":"assistant_note","text":"Fallback Codex note"}"#.to_owned(),
                r#"{"type":"unknown","output":[{"type":"command_output","output":"Fallback command output"}]}"#.to_owned(),
                r#"{"type":"event_msg","payload":{"type":"unknown","message":"ignored"}}"#.to_owned(),
                r#"{"type":"response_item","payload":{"type":"message","role":"developer","content":"ignored"}}"#.to_owned(),
                "not json".to_owned(),
                String::new(),
            ]
            .join("\n"),
        );

        assert_eq!(parsed.parsed_candidates, 11);
        assert_eq!(parsed.entries.len(), 8);
        assert_eq!(parsed.ignored_lines, 2);
        assert_eq!(parsed.malformed_lines, 1);
        assert_eq!(parsed.observed_event_counts["event_msg/user_message"], 2);
        assert_eq!(parsed.observed_event_counts["response_item/message"], 3);
        assert_eq!(parsed.observed_event_counts["session_meta"], 1);
        assert_eq!(
            parsed.observed_event_counts["response_item/function_call"],
            1
        );
        assert_eq!(
            parsed.observed_event_counts["event_msg/exec_command_end"],
            1
        );
        assert_eq!(
            parsed.observed_event_counts["response_item/function_call_output"],
            1
        );
        assert_eq!(parsed.observed_event_counts["assistant_note"], 1);
        assert_eq!(parsed.observed_event_counts["unknown"], 1);
        assert_eq!(parsed.observed_event_counts["event_msg/unknown"], 1);

        assert_eq!(
            parsed.entries,
            vec![
                RenderedEntry {
                    kind: RenderedEntryKind::Context,
                    content: "AGENTS.md project instructions loaded".to_owned()
                },
                RenderedEntry {
                    kind: RenderedEntryKind::You,
                    content: "Please inspect this parser.".to_owned()
                },
                RenderedEntry {
                    kind: RenderedEntryKind::Codex,
                    content: "I will inspect it.".to_owned()
                },
                RenderedEntry {
                    kind: RenderedEntryKind::System,
                    content: "Session: session_1\nModel provider: openai\nCLI version: 1.0.0"
                        .to_owned()
                },
                RenderedEntry {
                    kind: RenderedEntryKind::ToolCall,
                    content: "Function call: read_file\n{\"path\":\"sanitized.jsonl\"}".to_owned()
                },
                RenderedEntry {
                    kind: RenderedEntryKind::ToolResult,
                    content: "tests ok with details".to_owned()
                },
                RenderedEntry {
                    kind: RenderedEntryKind::Codex,
                    content: "Fallback Codex note".to_owned()
                },
                RenderedEntry {
                    kind: RenderedEntryKind::ToolResult,
                    content: "Fallback command output".to_owned()
                },
            ]
        );
    }

    #[test]
    fn parse_file_empty_file_returns_safe_empty_result() {
        let path = temp_file_path("empty");
        fs::write(&path, "").expect("empty fixture file is written");

        let parsed = parse_file(&path).expect("empty file parses safely");
        let _ = fs::remove_file(&path);

        assert_eq!(parsed, ParsedChatLog::empty());
    }

    #[test]
    fn parse_file_non_file_returns_safe_empty_result() {
        let path = temp_file_path("missing");
        let _ = fs::remove_file(&path);

        let parsed = parse_file(&path).expect("missing file parses safely");

        assert_eq!(parsed, ParsedChatLog::empty());
    }

    #[test]
    fn contract_malformed_lines_do_not_affect_ignored_or_observed_counts() {
        let parsed = parse_str(
            &[
                "not json".to_owned(),
                event_user_message_line("still parsed"),
                "{".to_owned(),
            ]
            .join("\n"),
        );

        assert_eq!(parsed.malformed_lines, 2);
        assert_eq!(parsed.ignored_lines, 0);
        assert_eq!(parsed.parsed_candidates, 1);
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.observed_event_counts["event_msg/user_message"], 1);
        assert_eq!(parsed.observed_event_counts.len(), 1);
    }

    #[test]
    fn contract_ignored_valid_json_lines_count_once_per_line() {
        let parsed = parse_str(
            &[
                r#"{"type":"event_msg","payload":{"type":"unknown","message":"ignored"}}"#.to_owned(),
                r#"{"type":"response_item","payload":{"type":"message","role":"developer","content":"ignored"}}"#.to_owned(),
                r#"{"type":"unrecognized"}"#.to_owned(),
            ]
            .join("\n"),
        );

        assert_eq!(parsed.malformed_lines, 0);
        assert_eq!(parsed.ignored_lines, 3);
        assert_eq!(parsed.parsed_candidates, 0);
        assert!(parsed.entries.is_empty());
        assert_eq!(parsed.observed_event_counts["event_msg/unknown"], 1);
        assert_eq!(parsed.observed_event_counts["response_item/message"], 1);
        assert_eq!(parsed.observed_event_counts["unrecognized"], 1);
    }

    #[test]
    fn identical_codex_messages_with_different_stable_ids_are_not_collapsed() {
        let parsed = parse_str(
            &[
                r#"{"type":"response_item","payload":{"type":"message","id":"codex_a","role":"assistant","content":"Repeat Codex"}}"#,
                r#"{"type":"response_item","payload":{"type":"message","id":"codex_b","role":"assistant","content":"Repeat Codex"}}"#,
            ]
            .join("\n"),
        );

        assert_eq!(parsed.parsed_candidates, 2);
        assert_eq!(
            parsed.entries,
            vec![
                RenderedEntry {
                    kind: RenderedEntryKind::Codex,
                    content: "Repeat Codex".to_owned()
                },
                RenderedEntry {
                    kind: RenderedEntryKind::Codex,
                    content: "Repeat Codex".to_owned()
                }
            ]
        );
    }

    #[test]
    fn user_and_codex_blocks_remain_separate_for_realistic_envelope_shapes() {
        let parsed = parse_str(
            &[
                event_user_message_line("What changed?"),
                response_message_line("assistant", "The parser changed."),
            ]
            .join("\n"),
        );

        assert_eq!(
            parsed.entries,
            vec![
                RenderedEntry {
                    kind: RenderedEntryKind::You,
                    content: "What changed?".to_owned()
                },
                RenderedEntry {
                    kind: RenderedEntryKind::Codex,
                    content: "The parser changed.".to_owned()
                }
            ]
        );
        assert_eq!(parsed.transcript_blocks()[0].label, "[YOU]");
        assert_eq!(parsed.transcript_blocks()[1].label, "[CODEX]");
    }

    #[test]
    fn filtering_over_parsed_output_preserves_contract_counters() {
        let parsed = parse_str(
            &[
                event_user_message_line("show me"),
                response_message_line("assistant", "visible"),
                response_item_line(
                    "function_call",
                    serde_json::json!({"name": "read_file", "arguments": "{}"}),
                ),
                response_item_line(
                    "function_call_output",
                    serde_json::json!({"call_id": "call_1", "output": "hidden"}),
                ),
                r#"{"type":"session_meta","payload":{"id":"session_1"}}"#.to_owned(),
            ]
            .join("\n"),
        );

        let filtered = parsed.filtered(&ChatEntryFilter {
            show_you: false,
            show_tool_result: false,
            show_meta: false,
            ..ChatEntryFilter::all()
        });

        assert_eq!(filtered.parsed_candidates, parsed.parsed_candidates);
        assert_eq!(filtered.ignored_lines, parsed.ignored_lines);
        assert_eq!(filtered.malformed_lines, parsed.malformed_lines);
        assert_eq!(filtered.observed_event_counts, parsed.observed_event_counts);
        assert_eq!(
            filtered.entries,
            vec![
                RenderedEntry {
                    kind: RenderedEntryKind::Codex,
                    content: "visible".to_owned()
                },
                RenderedEntry {
                    kind: RenderedEntryKind::ToolCall,
                    content: "Function call: read_file\n{}".to_owned()
                }
            ]
        );
    }

    #[test]
    fn transcript_blocks_over_parsed_output_preserve_entry_contract() {
        let parsed = parse_str(
            &[
                event_user_message_line("hello"),
                response_message_line("assistant", "hi"),
            ]
            .join("\n"),
        );

        assert_eq!(parsed.transcript_blocks().len(), 2);
        assert_eq!(
            parsed.transcript_blocks()[0].entry_type,
            RenderedEntryKind::You
        );
        assert_eq!(parsed.transcript_blocks()[0].label, "[YOU]");
        assert_eq!(parsed.transcript_blocks()[0].title, "[YOU]");
        assert_eq!(parsed.transcript_blocks()[0].content, "hello");
        assert_eq!(
            parsed.transcript_blocks()[1].entry_type,
            RenderedEntryKind::Codex
        );
        assert_eq!(parsed.transcript_blocks()[1].label, "[CODEX]");
        assert_eq!(parsed.transcript_blocks()[1].title, "[CODEX]");
        assert_eq!(parsed.transcript_blocks()[1].content, "hi");
    }

    #[test]
    fn duplicate_user_message_across_event_and_response_shapes_is_rendered_once() {
        let parsed = parse_str(
            &[
                r#"{"type":"event_msg","payload":{"type":"user_message","id":"msg_1","message":"Hello user"}}"#,
                r#"{"type":"response_item","payload":{"type":"message","id":"msg_1","role":"user","content":"Hello user"}}"#,
            ]
            .join("\n"),
        );

        assert_eq!(parsed.parsed_candidates, 2);
        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::You,
                content: "Hello user".to_owned()
            }]
        );
    }

    #[test]
    fn duplicate_codex_message_across_event_and_response_shapes_is_rendered_once() {
        let parsed = parse_str(
            &[
                r#"{"type":"event_msg","payload":{"type":"agent_message","message":"Codex reply"}}"#,
                r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":"Codex reply"}}"#,
            ]
            .join("\n"),
        );

        assert_eq!(parsed.parsed_candidates, 2);
        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::Codex,
                content: "Codex reply".to_owned()
            }]
        );
    }

    #[test]
    fn duplicate_tool_results_with_same_call_id_prefer_response_source() {
        let parsed = parse_str(
            &[
                event_msg_line(
                    "exec_command_end",
                    serde_json::json!({
                        "call_id": "call_1",
                        "command": "cargo test",
                        "stdout": "short"
                    }),
                ),
                response_item_line(
                    "function_call_output",
                    serde_json::json!({
                        "call_id": "call_1",
                        "output": "longer response output"
                    }),
                ),
            ]
            .join("\n"),
        );

        assert_eq!(parsed.parsed_candidates, 2);
        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::ToolResult,
                content: "longer response output".to_owned()
            }]
        );
    }

    #[test]
    fn duplicate_entries_with_same_stable_id_prefer_longer_content_at_same_priority() {
        let parsed = parse_str(
            &[
                r#"{"type":"response_item","payload":{"type":"message","id":"msg_2","role":"assistant","content":"short"}}"#,
                r#"{"type":"response_item","payload":{"type":"message","id":"msg_2","role":"assistant","content":"longer assistant response"}}"#,
            ]
            .join("\n"),
        );

        assert_eq!(parsed.parsed_candidates, 2);
        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::Codex,
                content: "longer assistant response".to_owned()
            }]
        );
    }

    #[test]
    fn identical_user_messages_with_different_stable_ids_are_not_collapsed() {
        let parsed = parse_str(
            &[
                r#"{"type":"response_item","payload":{"type":"message","id":"msg_a","role":"user","content":"Repeat me"}}"#,
                r#"{"type":"response_item","payload":{"type":"message","id":"msg_b","role":"user","content":"Repeat me"}}"#,
            ]
            .join("\n"),
        );

        assert_eq!(parsed.parsed_candidates, 2);
        assert_eq!(
            parsed.entries,
            vec![
                RenderedEntry {
                    kind: RenderedEntryKind::You,
                    content: "Repeat me".to_owned()
                },
                RenderedEntry {
                    kind: RenderedEntryKind::You,
                    content: "Repeat me".to_owned()
                }
            ]
        );
    }

    #[test]
    fn adjacent_duplicates_with_matching_timestamps_are_suppressed() {
        let parsed = parse_str(
            &[
                r#"{"role":"assistant","timestamp":"2026-06-18T00:00:00Z","content":"Same text"}"#,
                r#"{"role":"assistant","timestamp":"2026-06-18T00:00:00Z","content":" same   text "}"#,
            ]
            .join("\n"),
        );

        assert_eq!(parsed.parsed_candidates, 2);
        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::Codex,
                content: "same   text".to_owned()
            }]
        );
    }

    #[test]
    fn identical_fallback_messages_without_documented_duplicate_signal_remain_separate() {
        let parsed = parse_str(
            &[
                r#"{"role":"assistant","content":"Same fallback text"}"#,
                r#"{"role":"assistant","content":"Same fallback text"}"#,
            ]
            .join("\n"),
        );

        assert_eq!(parsed.parsed_candidates, 2);
        assert_eq!(parsed.entries.len(), 2);
    }

    #[test]
    fn counts_malformed_non_empty_lines_and_continues() {
        let parsed = parse_str(
            "\nnot json\n{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"still parsed\"}}\n{",
        );

        assert_eq!(parsed.malformed_lines, 2);
        assert_eq!(parsed.ignored_lines, 0);
        assert_eq!(parsed.parsed_candidates, 1);
        assert_eq!(parsed.entries[0].content, "still parsed");
    }

    #[test]
    fn counts_ignored_valid_json_lines_once() {
        let parsed = parse_str(
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"unknown\",\"message\":\"ignored\"}}\n{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"developer\",\"content\":\"ignored\"}}",
        );

        assert_eq!(parsed.malformed_lines, 0);
        assert_eq!(parsed.ignored_lines, 2);
        assert_eq!(parsed.parsed_candidates, 0);
        assert!(parsed.entries.is_empty());
    }

    #[test]
    fn collects_observed_event_counts_for_valid_json_only() {
        let parsed = parse_str(
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"one\"}}\n{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"two\"}}\n{\"payload\":{\"type\":\"payload_only\"}}\n{\"type\":\"top_only\",\"payload\":{}}\n{\"payload\":{}}\nnot json",
        );

        assert_eq!(parsed.malformed_lines, 1);
        assert_eq!(parsed.observed_event_counts["event_msg/user_message"], 2);
        assert_eq!(parsed.observed_event_counts["payload_only"], 1);
        assert_eq!(parsed.observed_event_counts["top_only"], 1);
        assert_eq!(parsed.observed_event_counts["unknown"], 1);
    }

    #[test]
    fn empty_trimmed_lines_are_not_ignored_or_malformed() {
        let parsed = parse_str("\n  \n\t\n");

        assert_eq!(parsed.malformed_lines, 0);
        assert_eq!(parsed.ignored_lines, 0);
        assert_eq!(parsed.parsed_candidates, 0);
        assert!(parsed.entries.is_empty());
        assert!(parsed.observed_event_counts.is_empty());
    }

    #[test]
    fn classifies_agents_instructions_as_context_summary() {
        let parsed = parse_str(&event_user_message_line(
            "# AGENTS.md instructions\n<INSTRUCTIONS>observe</INSTRUCTIONS>",
        ));

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::Context,
                content: "AGENTS.md project instructions loaded".to_owned()
            }]
        );
    }

    #[test]
    fn classifies_structured_task_body_as_task_summary() {
        let parsed = parse_str(&response_user_message_line(
            "<environment_context>local</environment_context>\nBuild this",
        ));

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::Task,
                content: "Task or prompt instructions loaded".to_owned()
            }]
        );
    }

    #[test]
    fn classifies_ordinary_human_prompt_as_you() {
        let parsed = parse_str(&event_user_message_line(
            "Can you explain how this parser handles malformed JSONL?",
        ));

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::You,
                content: "Can you explain how this parser handles malformed JSONL?".to_owned()
            }]
        );
    }

    #[test]
    fn long_ordinary_human_prompt_stays_you() {
        let prompt = "Please review this parser behavior carefully. ".repeat(80);
        let parsed = parse_str(&response_user_message_line(&prompt));

        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].kind, RenderedEntryKind::You);
        assert_eq!(parsed.entries[0].content, prompt.trim());
    }

    #[test]
    fn korean_utf8_user_message_stays_intact() {
        let message = "\u{c548}\u{b155}\u{d558}\u{c138}\u{c694}. JSONL \u{d30c}\u{c11c}\u{b97c} \u{d655}\u{c778}\u{d574} \u{c8fc}\u{c138}\u{c694}.";
        let parsed = parse_str(&event_user_message_line(message));

        assert_eq!(
            parsed.entries,
            vec![RenderedEntry {
                kind: RenderedEntryKind::You,
                content: message.to_owned()
            }]
        );
    }

    #[test]
    fn preserves_unicode_message_content() {
        let parsed = parse_str(&response_message_line(
            "assistant",
            "\u{c548}\u{b155}\u{d558}\u{c138}\u{c694}",
        ));

        assert_eq!(
            parsed.entries[0],
            RenderedEntry {
                kind: RenderedEntryKind::Codex,
                content: "\u{c548}\u{b155}\u{d558}\u{c138}\u{c694}".to_owned()
            }
        );
    }

    #[test]
    fn lossy_reader_replaces_invalid_utf8_without_counting_as_io_error() {
        let input = Cursor::new(vec![
            b'{', b'"', b't', b'y', b'p', b'e', b'"', b':', b'"', b'e', b'v', b'e', b'n', b't',
            b'_', b'm', b's', b'g', b'"', b',', b'"', b'p', b'a', b'y', b'l', b'o', b'a', b'd',
            b'"', b':', b'{', b'"', b't', b'y', b'p', b'e', b'"', b':', b'"', b'u', b's', b'e',
            b'r', b'_', b'm', b'e', b's', b's', b'a', b'g', b'e', b'"', b',', b'"', b'm', b'e',
            b's', b's', b'a', b'g', b'e', b'"', b':', b'"', 0xff, b'"', b'}', b'}',
        ]);

        let parsed = parse_reader(input).expect("invalid utf8 is replaced");

        assert_eq!(parsed.malformed_lines, 0);
        assert_eq!(parsed.entries[0].content, "\u{fffd}");
    }

    #[test]
    fn delegated_handoff_is_observed_without_rendering_a_you_entry() {
        let handoff = concat!(
            "## Referenced ChatGPT conversation:\n",
            "Transport guidance.\n",
            r#"{"conversationId":"conversation-1","title":"Design discussion","priorConversation":{"conversation":[{"role":"user","content":[{"content_type":"text","text":"Earlier request"}]},{"role":"assistant","content":null},{"role":"assistant","content":[{"content_type":"text","text":"Earlier response"}]}]}}"#,
            "\n## My request:\n",
            "Continuing from [Design discussion](chatgpt-conversation://conversation-1): continue."
        );
        let parsed = parse_str(&response_user_message_line(handoff));

        assert_eq!(parsed.parsed_candidates, 1);
        assert!(parsed.entries.is_empty());
        let references = &parsed.session_provenance.referenced_conversations;
        assert_eq!(references.len(), 1);
        assert_eq!(
            references[0].conversation_id.as_deref(),
            Some("conversation-1")
        );
        assert_eq!(references[0].title.as_deref(), Some("Design discussion"));
        assert!(references[0].preview_available);
    }

    #[test]
    fn ambient_context_projects_one_human_request_entry() {
        let ambient = concat!(
            "<in-app-browser-context source=\"ambient-ui-state\">\n",
            "runtime URL and local path\n",
            "</in-app-browser-context>\n\n",
            "## My request:\n",
            "이어서 작업해줘"
        );
        let parsed = parse_str(&response_user_message_line(ambient));

        assert_eq!(parsed.parsed_candidates, 1);
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].kind, RenderedEntryKind::You);
        assert_eq!(parsed.entries[0].content, "이어서 작업해줘");
    }

    #[test]
    fn ordinary_user_message_has_no_session_provenance() {
        let parsed = parse_str(&response_user_message_line("Ordinary request"));

        assert_eq!(parsed.entries[0].content, "Ordinary request");
        assert!(
            parsed
                .session_provenance
                .referenced_conversations
                .is_empty()
        );
    }

    #[test]
    fn typed_known_path_matches_value_based_compatibility_path() {
        let input = [
            r#"{"timestamp":"2026-09-18T01:00:00Z","type":"session_meta","payload":{"id":"session-1","model_provider":"openai","cli_version":"1.2.3"}}"#,
            r#"{"timestamp":"2026-09-18T01:00:01Z","type":"event_msg","payload":{"type":"user_message","id":"message-1","message":"Inspect this."}}"#,
            r#"{"timestamp":"2026-09-18T01:00:01Z","type":"response_item","payload":{"type":"message","id":"message-1","role":"user","content":[{"type":"input_text","text":"Inspect this."}]}}"#,
            r#"{"type":"event_msg","payload":{"type":"agent_message","message":"Working."}}"#,
            r#"{"type":"event_msg","payload":{"type":"exec_command_end","command":"cargo test","exit_code":0,"aggregated_output":"ok"}}"#,
            r#"{"type":"response_item","payload":{"type":"function_call","name":"read_file","arguments":{"path":"safe.jsonl"}}}"#,
            r#"{"type":"unknown","output":[{"type":"command_output","output":"legacy output"}]}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":"developer","content":"ignored"}}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":" user ","content":"must remain ignored"}}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":"","text":"must not bypass empty content"}}"#,
            r#"{"type":"response_item","payload":{"type":"function_call","name":"","arguments":""}}"#,
            r#"{"type":"response_item","payload":{"type":"function_call_output","call_id":"call-empty","output":""}}"#,
            "not json",
        ]
        .join("\n");

        assert_eq!(
            parse_str(&input),
            parse_legacy_for_differential_test(&input)
        );
    }

    fn question_line(id: &str, questions: Value) -> String {
        serde_json::json!({
            "timestamp": "2026-10-08T08:50:52.772Z",
            "type": "event_msg",
            "payload": {"type": "item_completed", "turn_id": "turn-1", "item": {
                "type": "AgentMessage", "id": id, "questions": questions,
                "content": [{"type": "Text", "text": "must not be used"}]
            }}
        })
        .to_string()
    }

    #[test]
    fn canonical_questions_preserve_text_order_and_free_input() {
        let input = question_line(
            "call-question",
            serde_json::json!([
                {"title":"Choose?", "options":["Second", "First"]},
                {"title":"Free input", "options":null},
                {"title":"Missing options"},
                {"title":"Empty options", "options":[]}
            ]),
        );
        let parsed = parse_str(&input);
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].kind, RenderedEntryKind::Codex);
        assert_eq!(
            parsed.entries[0].content,
            "Choose?\n- Second\n- First\n\nFree input\n\nMissing options\n\nEmpty options"
        );
        assert_eq!(
            parsed.entry_timestamps[0].as_deref(),
            Some("2026-10-08T08:50:52.772Z")
        );
        assert_eq!(parsed.parsed_candidates, 1);
        assert_eq!(parsed.ignored_lines, 0);
        assert_eq!(parsed.observed_event_counts["event_msg/item_completed"], 1);
        assert_eq!(parsed, parse_legacy_for_differential_test(&input));
    }

    #[test]
    fn invalid_question_events_do_not_fabricate_content() {
        for questions in [
            serde_json::json!([]),
            serde_json::json!(null),
            serde_json::json!([{"options":["a"]}]),
            serde_json::json!([{"title":" "}]),
            serde_json::json!([{"title":"q", "options":"bad"}]),
            serde_json::json!([{"title":"q", "options":[{"label":"a"}]}]),
        ] {
            let input = question_line("question", questions);
            let parsed = parse_str(&input);
            assert!(parsed.entries.is_empty());
            assert_eq!(parsed.ignored_lines, 1);
            assert_eq!(parsed.malformed_lines, 0);
            assert_eq!(parsed, parse_legacy_for_differential_test(&input));
        }
        let input = r#"{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"UserMessage","content":[{"text":"unchanged"}]}}}"#;
        assert!(parse_str(input).entries.is_empty());
        let legacy = r#"{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"AgentMessage"}},"message":{"role":"assistant","content":"legacy fallback"}}"#;
        assert_eq!(parse_str(legacy).entries[0].content, "legacy fallback");
        assert_eq!(
            parse_str(legacy),
            parse_legacy_for_differential_test(legacy)
        );
    }

    #[test]
    fn question_and_tool_call_remain_independent_without_pairing() {
        let call = response_item_line(
            "function_call",
            serde_json::json!({
                "name":"request_user_input_async", "call_id":"call-question", "id":"fc-1",
                "arguments":"{\"questions\":[{\"title\":\"tool only\"}]}"
            }),
        );
        assert_eq!(
            parse_str(&call).entries[0].kind,
            RenderedEntryKind::ToolCall
        );
        assert_eq!(parse_str(&call).entries.len(), 1);
        let input = [call, "{\"type\":\"unrelated\"}".to_owned(),
            question_line("call-question", serde_json::json!([{"title":"canonical", "options":["a","b"]}])),
            r#"{"type":"response_item","payload":{"type":"message","role":"user","turn_id":"turn-1","content":"a"}}"#.to_owned(),
            r#"{"type":"response_item","payload":{"type":"message","role":"user","turn_id":"turn-2","content":"b"}}"#.to_owned()
        ].join("\n");
        let parsed = parse_str(&input);
        assert_eq!(
            parsed
                .entries
                .iter()
                .map(|entry| entry.kind)
                .collect::<Vec<_>>(),
            vec![
                RenderedEntryKind::ToolCall,
                RenderedEntryKind::Codex,
                RenderedEntryKind::You,
                RenderedEntryKind::You
            ]
        );
        assert_eq!(parsed.entries[1].content, "canonical\n- a\n- b");
        assert!(parsed.entries[0].content.contains("tool only"));
        assert_eq!(parsed.entries[2].content, "a");
        assert_eq!(parsed.entries[3].content, "b");
        assert_eq!(parsed, parse_legacy_for_differential_test(&input));
    }

    #[test]
    fn questions_do_not_merge_by_text_timestamp_or_turn() {
        let first = question_line("first", serde_json::json!([{"title":"same"}]));
        let second = question_line("second", serde_json::json!([{"title":"same"}]));
        let ordinary = r#"{"timestamp":"2026-10-08T08:50:52.772Z","type":"response_item","payload":{"type":"message","id":"ordinary","role":"assistant","content":"same"}}"#;
        let input = [first.clone(), second, ordinary.to_owned(), first].join("\n");
        let parsed = parse_str(&input);
        assert_eq!(parsed.entries.len(), 3);
        assert!(parsed.entries.iter().all(|entry| entry.content == "same"));
        assert_eq!(parsed, parse_legacy_for_differential_test(&input));
    }

    #[test]
    fn adjacent_replacement_keeps_the_replacement_stable_id_semantics() {
        let stable_then_unkeyed = [
            r#"{"type":"event_msg","payload":{"type":"agent_message","id":"first","message":"same"}}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":"same"}}"#,
            r#"{"type":"event_msg","payload":{"type":"agent_message","id":"second","message":"same"}}"#,
        ]
        .join("\n");
        assert_eq!(parse_str(&stable_then_unkeyed).entries.len(), 1);

        let unkeyed_then_stable = [
            r#"{"type":"event_msg","payload":{"type":"agent_message","message":"same"}}"#,
            r#"{"type":"response_item","payload":{"type":"message","id":"first","role":"assistant","content":"same"}}"#,
            r#"{"type":"event_msg","payload":{"type":"agent_message","id":"second","message":"same"}}"#,
        ]
        .join("\n");
        assert_eq!(parse_str(&unkeyed_then_stable).entries.len(), 2);
    }

    #[test]
    fn synthetic_large_jsonl_is_consumed_through_bounded_reader_chunks() {
        const RECORDS: usize = 100_000;
        const RECORD: &[u8] = b"{\"type\":\"unknown\"}\n";
        let max_requested = Rc::new(Cell::new(0));
        let reader = RepeatingJsonlReader {
            record: RECORD,
            remaining: RECORDS,
            offset: 0,
            max_requested: Rc::clone(&max_requested),
        };

        let parsed = parse_reader(reader).expect("synthetic JSONL streams successfully");

        assert_eq!(parsed.ignored_lines, RECORDS);
        assert_eq!(parsed.malformed_lines, 0);
        assert_eq!(parsed.observed_event_counts["unknown"], RECORDS);
        assert!(parsed.entries.is_empty());
        assert!(max_requested.get() <= 8 * 1024);
        assert!(RECORDS * RECORD.len() > max_requested.get() * 100);
    }
}
