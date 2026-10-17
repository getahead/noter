//! People, Person pages, unnamed speakers and opt-in voice profiles.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::{CallRow, ItemView, TopicRow};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PersonRow {
    pub id: PersonId,
    pub rev: Rev,
    pub display_name: String,
    pub short_name: String,
    pub initials: String,
    pub email: Option<String>,
    pub role: Option<String>,
    pub org: Option<String>,
    pub aliases: Vec<String>,
    pub is_you: bool,
    pub voice_profile: bool,
    pub last_call_at: Option<TimestampMs>,
    pub open_items: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PeopleListArgs {
    pub query: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PeopleList {
    pub people: Vec<PersonRow>,
    pub unnamed: Vec<UnnamedSpeaker>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct UnnamedSpeaker {
    pub call: CallRef,
    pub speaker_id: SpeakerId,
    /// "Speaker 2".
    pub n: u16,
    pub segment_count: u32,
    pub sample: Option<TimeSpan>,
    pub suggestion: Option<PersonChip>,
}

/// A Person page is a set of queries, not a stored document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PersonPage {
    pub person: PersonRow,
    pub calls: Vec<CallRow>,
    /// Their open commitments.
    pub owns_open: Vec<ItemView>,
    /// What they asked of you.
    pub you_owe: Vec<ItemView>,
    pub open_questions: Vec<ItemView>,
    pub topics: Vec<TopicRow>,
    /// Only when behaviour metrics are on (D47).
    pub talk_share: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PersonIdArgs {
    pub person_id: PersonId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PersonCreateArgs {
    pub display_name: String,
    pub email: Option<String>,
    pub role: Option<String>,
    pub org: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
pub struct PersonPatch {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub short_name: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub org: Option<String>,
    #[serde(default)]
    pub aliases: Option<Vec<String>>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PersonUpdateArgs {
    pub person_id: PersonId,
    pub rev: Rev,
    pub patch: PersonPatch,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PeopleMergeArgs {
    pub source: PersonId,
    pub target: PersonId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PersonMutation {
    pub person: PersonRow,
    pub change_id: ChangeId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct VoiceProfileArgs {
    pub person_id: PersonId,
    /// Seed the profile from a named speaker in a call.
    pub from_speaker: Option<SpeakerId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct VoiceProfileView {
    pub person_id: PersonId,
    pub enabled: bool,
    pub centroids: u32,
    pub opted_in_at: Option<TimestampMs>,
}
