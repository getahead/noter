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
    #[serde(default)]
    pub voice_profile_stats: Option<VoiceProfileStats>,
    pub last_call_at: Option<TimestampMs>,
    pub open_items: u32,
    /// The user's own open action items from calls this person was on ("You owe"); 0 for You.
    pub you_owe: u32,
    /// The user's notes about them.
    pub notes: Option<String>,
}

/// Retained profile data, without biometric vectors or inferred match history.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct VoiceProfileStats {
    pub opted_in_at: Option<TimestampMs>,
    /// Currently available centroid rows, not distinct profiles that matched.
    pub profiles: u32,
    /// Distinct retained calls with speakers named by voice profile.
    pub matched_calls: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PeopleListArgs {
    #[serde(default)]
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
    /// What the speaker said in `sample`, in its own language (issue 1151, contract 2.25).
    #[serde(default)]
    pub sample_text: Option<String>,
    #[serde(default)]
    pub sample_lang: Option<Lang>,
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
    /// The languages of their transcribed lines, largest share first (PE-R5 Languages, #1152).
    #[serde(default)]
    pub languages: Vec<LanguageShare>,
    /// How often you meet, from their calls (PE-R1 subtitle "1:1 weekly"); absent when no
    /// pattern shows (#1152, contract 2.25).
    #[serde(default)]
    pub cadence: Option<Cadence>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LanguageShare {
    pub lang: Lang,
    /// 0..=1 of their transcribed speech.
    pub share: f32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Cadence {
    /// Most of their calls had just the two of you.
    pub one_on_one: bool,
    /// The usual gap between calls, when there is one.
    pub every: Option<CadenceEvery>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CadenceEvery {
    Weekly,
    EveryTwoWeeks,
    Monthly,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PersonIdArgs {
    pub person_id: PersonId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PersonCreateArgs {
    pub display_name: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
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
    #[serde(default)]
    pub from_speaker: Option<SpeakerId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct VoiceProfileView {
    pub person_id: PersonId,
    pub enabled: bool,
    pub centroids: u32,
    pub opted_in_at: Option<TimestampMs>,
}

/// What `voice_profile_rematch` named: unnamed speakers in past calls whose voice matches the
/// person's profile. `change_id` undoes them all; `None` when nothing matched.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct VoiceRematch {
    pub person_id: PersonId,
    pub calls: u32,
    pub speakers: u32,
    pub change_id: Option<ChangeId>,
}
