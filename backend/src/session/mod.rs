use std::{
    io::{self, Cursor},
    path::Path,
};

use crate::{
    domain::ParsedChatLog,
    inspection::{SessionClassification, SessionIdentity, SessionInspection, inspect_reader},
    parser,
};

pub mod locator;
pub mod navigator;
pub mod source;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionRoute {
    OrdinaryTranscript,
    Specialized(SessionClassification),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionDescriptor {
    pub identity: Option<SessionIdentity>,
    pub classification: SessionClassification,
    pub route: SessionRoute,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SessionCapabilities {
    pub can_show_transcript: bool,
    pub can_resume: bool,
    pub can_export_worklog: bool,
    pub can_open_parent_session: bool,
}

impl SessionDescriptor {
    pub fn capabilities(&self) -> SessionCapabilities {
        match self.route {
            SessionRoute::OrdinaryTranscript => SessionCapabilities {
                can_show_transcript: true,
                can_resume: true,
                can_export_worklog: true,
                can_open_parent_session: false,
            },
            SessionRoute::Specialized(classification) => SessionCapabilities {
                can_show_transcript: false,
                can_resume: false,
                can_export_worklog: false,
                can_open_parent_session: classification == SessionClassification::GuardianReview
                    && self
                        .identity
                        .as_ref()
                        .and_then(|identity| identity.parent_thread_id.as_deref())
                        .is_some_and(|parent_thread_id| !parent_thread_id.trim().is_empty()),
            },
        }
    }
}

impl From<SessionInspection> for SessionDescriptor {
    fn from(inspection: SessionInspection) -> Self {
        let route = match inspection.classification {
            SessionClassification::Unclassified => SessionRoute::OrdinaryTranscript,
            classification => SessionRoute::Specialized(classification),
        };

        Self {
            identity: inspection.identity,
            classification: inspection.classification,
            route,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SessionProcessingOutcome {
    OrdinaryTranscript(ParsedChatLog),
    DeferredSpecialized(SessionClassification),
}

impl SessionProcessingOutcome {
    pub fn into_compatible_chat_log(self) -> ParsedChatLog {
        match self {
            Self::OrdinaryTranscript(parsed) => parsed,
            Self::DeferredSpecialized(_) => ParsedChatLog::empty(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoadedSession {
    pub descriptor: SessionDescriptor,
    pub outcome: SessionProcessingOutcome,
}

impl LoadedSession {
    pub fn into_compatible_chat_log(self) -> ParsedChatLog {
        self.outcome.into_compatible_chat_log()
    }
}

pub fn load_file(path: impl AsRef<Path>) -> io::Result<LoadedSession> {
    let path = path.as_ref();
    let path = source::resolve_path(path)?;
    let mut reader = source::open_reader(&path)?;
    let descriptor = SessionDescriptor::from(inspect_reader(&mut reader)?);
    let outcome = match descriptor.route {
        SessionRoute::OrdinaryTranscript => SessionProcessingOutcome::OrdinaryTranscript(
            parser::parse_reader(source::open_reader(&path)?)?,
        ),
        SessionRoute::Specialized(classification) => {
            // Validate the compressed frame even though specialized sessions do
            // not enter the ordinary transcript parser.
            if source::is_compressed(&path) {
                io::copy(&mut reader, &mut io::sink())?;
            }
            process_specialized_session(classification)
        }
    };

    Ok(LoadedSession {
        descriptor,
        outcome,
    })
}

pub fn load_bytes(bytes: &[u8]) -> LoadedSession {
    let descriptor = SessionDescriptor::from(
        inspect_reader(Cursor::new(bytes)).expect("in-memory session inspection cannot fail"),
    );
    let outcome = route_session(&descriptor, bytes);

    LoadedSession {
        descriptor,
        outcome,
    }
}

fn route_session(descriptor: &SessionDescriptor, bytes: &[u8]) -> SessionProcessingOutcome {
    match descriptor.route {
        SessionRoute::OrdinaryTranscript => SessionProcessingOutcome::OrdinaryTranscript(
            parser::parse_reader(Cursor::new(bytes)).expect("in-memory JSONL parsing cannot fail"),
        ),
        SessionRoute::Specialized(classification) => process_specialized_session(classification),
    }
}

fn process_specialized_session(classification: SessionClassification) -> SessionProcessingOutcome {
    SessionProcessingOutcome::DeferredSpecialized(classification)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guardian_review_enters_specialized_boundary_without_ordinary_parsing() {
        let input = concat!(
            r#"{"type":"session_meta","payload":{"id":"guardian-thread","session_id":"root-session","parent_thread_id":"root-session","originator":"codex_work_desktop","thread_source":"guardian_review","source":{"subagent":{"other":"guardian"}},"history_mode":"paginated","subagent_history_start_ordinal":110}}"#,
            "\n",
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":"must not become YOU"}}"#,
            "\n",
            r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":"must not become CODEX"}}"#,
        );

        let ordinary_result = parser::parse_str(input);
        assert!(
            !ordinary_result.entries.is_empty(),
            "fixture must detect accidental ordinary parsing"
        );

        let loaded = load_bytes(input.as_bytes());

        assert_eq!(
            loaded.descriptor.route,
            SessionRoute::Specialized(SessionClassification::GuardianReview)
        );
        assert!(matches!(
            loaded.outcome,
            SessionProcessingOutcome::DeferredSpecialized(SessionClassification::GuardianReview)
        ));
        assert!(loaded.descriptor.capabilities().can_open_parent_session);
        assert!(loaded.into_compatible_chat_log().entries.is_empty());
    }

    #[test]
    fn specialized_sessions_default_to_restricted_product_capabilities() {
        let descriptor = SessionDescriptor {
            identity: None,
            classification: SessionClassification::GuardianReview,
            route: SessionRoute::Specialized(SessionClassification::GuardianReview),
        };

        assert_eq!(
            descriptor.capabilities(),
            SessionCapabilities {
                can_show_transcript: false,
                can_resume: false,
                can_export_worklog: false,
                can_open_parent_session: false,
            }
        );
    }

    #[test]
    fn ordinary_cli_session_preserves_existing_parser_result() {
        let input = concat!(
            r#"{"type":"session_meta","payload":{"id":"cli-thread","originator":"codex_cli","source":"cli"}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"hello"}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"agent_message","message":"hi"}}"#,
        );
        let expected = parser::parse_str(input);

        let loaded = load_bytes(input.as_bytes());

        assert_eq!(loaded.descriptor.route, SessionRoute::OrdinaryTranscript);
        assert_eq!(
            loaded.outcome,
            SessionProcessingOutcome::OrdinaryTranscript(expected)
        );
        assert_eq!(
            loaded.descriptor.capabilities(),
            SessionCapabilities {
                can_show_transcript: true,
                can_resume: true,
                can_export_worklog: true,
                can_open_parent_session: false,
            }
        );
    }

    #[test]
    fn ordinary_desktop_session_preserves_existing_parser_result() {
        let input = concat!(
            r#"{"type":"session_meta","payload":{"id":"desktop-thread","originator":"codex_work_desktop","thread_source":"user","source":"vscode"}}"#,
            "\n",
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":"desktop request"}}"#,
        );
        let expected = parser::parse_str(input);

        let loaded = load_bytes(input.as_bytes());

        assert_eq!(loaded.descriptor.route, SessionRoute::OrdinaryTranscript);
        assert_eq!(loaded.into_compatible_chat_log(), expected);
    }

    #[test]
    fn missing_metadata_uses_the_ordinary_compatibility_route() {
        let input = r#"{"type":"event_msg","payload":{"type":"user_message","message":"hello"}}"#;
        let expected = parser::parse_str(input);

        let loaded = load_bytes(input.as_bytes());

        assert_eq!(
            loaded.descriptor.classification,
            SessionClassification::Unclassified
        );
        assert_eq!(loaded.descriptor.route, SessionRoute::OrdinaryTranscript);
        assert_eq!(loaded.into_compatible_chat_log(), expected);
    }
}
