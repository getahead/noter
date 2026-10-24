//! The fixture world's Library slices hold together the way a core reading them from database
//! rows serves them (`cpt-noter-dod-core-library-calls-parity`): one detail and one transcript
//! snapshot per call, the same speakers, marks and gaps in both, and every segment belonging to
//! its call and to one of its speakers. The fake core then answers `calls_list`, `call_get` and
//! the transcript snapshot from data, not from guesses, and the real core seeded with the same
//! rows can be compared field by field.

// @cpt-dod:cpt-noter-dod-core-library-calls-parity:p2
use std::collections::HashMap;

use noter_protocol::fixtures::world;
use noter_protocol::model::*;

#[test]
fn every_call_has_one_detail_that_repeats_its_row() {
    let w = world();
    for call in &w.calls {
        let details: Vec<_> = w
            .call_details
            .iter()
            .filter(|d| d.call.id == call.id)
            .collect();
        assert_eq!(details.len(), 1, "call_details for {}", call.id.as_str());
        assert_eq!(
            &details[0].call,
            call,
            "the detail of {} repeats its row",
            call.id.as_str()
        );
    }
    assert_eq!(
        w.call_details.len(),
        w.calls.len(),
        "no detail without a call row"
    );
}

#[test]
fn every_call_has_one_transcript_and_its_detail_shows_the_same_speakers_marks_and_gaps() {
    let w = world();
    for call in &w.calls {
        let id = call.id.as_str();
        let snaps: Vec<_> = w
            .transcripts
            .iter()
            .filter(|t| t.call_id == call.id)
            .collect();
        assert_eq!(snaps.len(), 1, "transcripts for {id}");
        let (t, d) = (
            snaps[0],
            w.call_details
                .iter()
                .find(|d| d.call.id == call.id)
                .unwrap(),
        );
        assert_eq!(d.speakers, t.speakers, "speakers of {id}");
        assert_eq!(d.marks, t.marks, "marks of {id}");
        assert_eq!(d.gaps, t.gaps, "gaps of {id}");
        assert_eq!(
            t.live,
            call.status == CallStatus::Recording,
            "only the recording call is live ({id})"
        );
        if !t.live {
            assert!(
                t.subscription_id.is_none() && t.hypotheses.is_empty(),
                "a past call has no stream ({id})"
            );
        }
    }
    assert_eq!(
        w.transcripts.len(),
        w.calls.len(),
        "no transcript without a call row"
    );
}

#[test]
fn segments_belong_to_their_call_and_speakers_count_them() {
    let w = world();
    for t in &w.transcripts {
        let id = t.call_id.as_str();
        let mut counted: HashMap<&str, u32> = HashMap::new();
        for seg in &t.segments {
            assert_eq!(
                seg.call_id,
                t.call_id,
                "segment {} of {id}",
                seg.id.as_str()
            );
            assert!(
                t.speakers.iter().any(|s| s.id == seg.speaker.speaker_id),
                "speaker of {}",
                seg.id.as_str()
            );
            *counted.entry(seg.speaker.speaker_id.as_str()).or_default() += 1;
        }
        for s in &t.speakers {
            assert_eq!(s.call_id, t.call_id, "speaker {} of {id}", s.id.as_str());
            assert_eq!(
                s.segment_count,
                counted.get(s.id.as_str()).copied().unwrap_or(0),
                "segment_count of {}",
                s.id.as_str()
            );
        }
        for m in &t.marks {
            assert_eq!(m.call_id, t.call_id, "mark {} of {id}", m.id.as_str());
        }
        for g in &t.gaps {
            assert_eq!(g.call_id, t.call_id, "a gap of {id}");
        }
    }
}

#[test]
fn a_past_call_has_a_transcript_to_compare() {
    let w = world();
    let past = w
        .transcripts
        .iter()
        .find(|t| !t.live)
        .expect("a past call's transcript");
    assert!(
        !past.segments.is_empty() && !past.speakers.is_empty(),
        "the past call has segments and speakers"
    );
    assert!(
        past.segments
            .iter()
            .all(|s| s.pass == TranscriptPass::Archive),
        "a finished archive pass"
    );
}
