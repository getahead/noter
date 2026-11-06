// PC-R9 (DESIGN › Speaker naming panel; prototype 30-c.css .pc-name*): one row per unnamed speaker above the transcript, each
// with its first line, a sample to play, the person picker and the invitation chips. The core names; the UI writes what it returns.
import { useEffect, useRef, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type {
  PersonChip,
  PersonRef,
  PersonRow,
  SegmentView,
  SpeakerView,
} from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineStatus } from "../../ui/feedback/inline-status";
import { Disclosure } from "../../ui/primitives/disclosure";
import { PushButton } from "../../ui/primitives/push-button";
import { holdUndo } from "../history/undo";
import { REFUSED } from "../transcript/play-control";
import { speakerName } from "../transcript/model";
import {
  chipsFor,
  firstLine,
  nameKey,
  panelRows,
  samplePlaying,
} from "./naming";
import { PersonPicker } from "./PersonPicker";
import { usePeople } from "./people";
import "./speakers.css";

const ALL_NAMED_MS = 10_000;
const NAMED = { not_found: "not_found", invalid_input: "invalid_input" };

export interface SpeakerNamingPanelProps {
  bridge: Bridge;
  callId: string;
  speakers: readonly SpeakerView[];
  segments: readonly SegmentView[];
  participants: readonly PersonChip[];
  /** The call's audio is stored and available: Play Sample shows. */
  audio: boolean;
}

// @cpt-component:cpt-noter-component-ui-speaker-naming-panel:p1
// @cpt-flow:cpt-noter-flow-ui-speakers-post-call:p1
export function SpeakerNamingPanel(p: SpeakerNamingPanelProps) {
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [hidden, setHidden] = useState(false);
  const [done, setDone] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const people = usePeople(p.bridge);
  const rows = panelRows(p.speakers, skipped);
  const had = useRef(false);
  // @cpt-begin:cpt-noter-state-ui-speakers-naming:p1:inst-all
  // the last unnamed speaker was named in this view: say so for 10 s, then the panel goes
  useEffect(() => {
    if (rows.unnamed > 0) return void (had.current = true);
    if (!had.current) return;
    setDone(true);
    const timer = setTimeout(
      () => (setDone(false), (had.current = false)),
      ALL_NAMED_MS,
    );
    return () => clearTimeout(timer);
  }, [rows.unnamed]);
  // @cpt-end:cpt-noter-state-ui-speakers-naming:p1:inst-all
  if (rows.unnamed === 0)
    return done ? (
      <div data-region="PC-R9" className="pc-name">
        <InlineStatus
          variant="notice"
          text={t("speakers.panel.all")}
          onExpire={() => setDone(false)}
        />
      </div>
    ) : null;

  const skip = async (s: SpeakerView) => {
    // @cpt-begin:cpt-noter-state-ui-speakers-naming:p1:inst-hide
    const res = await p.bridge.act(
      nameKey(s.id),
      "transcript_name_speakers",
      () =>
        p.bridge.core.transcriptNameSpeakers({
          call_id: p.callId,
          assignments: [{ speaker_id: s.id, person: null }],
        }),
      { named: NAMED },
    );
    // @cpt-end:cpt-noter-state-ui-speakers-naming:p1:inst-hide
    if (res.status === "ok") setSkipped((x) => new Set(x).add(s.id));
  };
  const unskip = (id: string) =>
    setSkipped((x) => new Set([...x].filter((k) => k !== id)));
  const row = (s: SpeakerView) => (
    <NameRow
      key={s.id}
      p={p}
      speaker={s}
      people={people === undefined ? null : people}
      line={firstLine(p.segments, s.id)}
      onSkip={() => void skip(s)}
    />
  );

  return (
    <section
      data-region="PC-R9"
      data-component="cpt-noter-component-ui-speaker-naming-panel"
      data-state={hidden ? "hidden" : "unnamed"}
      className="pc-name"
      aria-label={t("speakers.panel")}
    >
      <header className="pc-name__head">
        <h3 className="pc-name__title">
          {hidden
            ? t("speakers.panel.hidden", { count: rows.unnamed })
            : t("speakers.panel.title", { count: rows.unnamed })}
        </h3>
        <PushButton
          variant="quiet"
          size="small"
          label={hidden ? t("speakers.panel.show") : t("speakers.panel.hide")}
          onAction={() => setHidden(!hidden)}
        />
      </header>
      {!hidden && rows.open.map(row)}
      {!hidden && rows.skipped.length > 0 && (
        <div className="pc-name__skipped">
          <Disclosure
            variant="row"
            label={t("speakers.panel.skipped", { count: rows.skipped.length })}
            open={showSkipped}
            onAction={() => setShowSkipped(!showSkipped)}
          />
          {showSkipped &&
            rows.skipped.map((s) => (
              <div
                key={s.id}
                className="pc-name__skip"
                role="group"
                aria-label={speakerName(s.label)}
              >
                <span>{speakerName(s.label)}</span>
                <PushButton
                  size="small"
                  label={t("speakers.panel.unskip")}
                  onAction={() => unskip(s.id)}
                />
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

function NameRow({
  p,
  speaker,
  people,
  line,
  onSkip,
}: {
  p: SpeakerNamingPanelProps;
  speaker: SpeakerView;
  people: readonly PersonRow[] | null;
  line: string | null;
  onSkip: () => void;
}) {
  const [pick, setPick] = useState<{ ref: PersonRef; name: string } | null>(
    null,
  );
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState<{
    callId: string;
    since: number;
  } | null>(null);
  const playback = useWindow(p.bridge, (s) => s.whole.playback);
  const label = speakerName(speaker.label);
  const chips = chipsFor(speaker, p.speakers, p.participants);

  // @cpt-begin:cpt-noter-flow-ui-speakers-post-call:p1:inst-sample
  const play = async () => {
    if (!speaker.sample) return;
    setSample({ callId: p.callId, since: playback?.version ?? 0 });
    const { call_id, t0_ms, t1_ms } = speaker.sample;
    const res = await p.bridge.act(
      "audio_play",
      "audio_play",
      () => p.bridge.core.audioPlay({ call_id, from_ms: t0_ms, to_ms: t1_ms }),
      { slice: "playback", named: REFUSED },
    );
    if (res.status === "error") setSample(null);
  };
  // @cpt-end:cpt-noter-flow-ui-speakers-post-call:p1:inst-sample
  // @cpt-begin:cpt-noter-flow-ui-speakers-post-call:p1:inst-name
  const name = async (ref: PersonRef, to: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await p.bridge.act(
      nameKey(speaker.id),
      "transcript_name_speakers",
      () =>
        p.bridge.core.transcriptNameSpeakers({
          call_id: p.callId,
          assignments: [{ speaker_id: speaker.id, person: ref }],
        }),
      { entity: "speaker", named: NAMED },
    );
    setBusy(false);
    // @cpt-end:cpt-noter-flow-ui-speakers-post-call:p1:inst-name
    // @cpt-begin:cpt-noter-state-ui-speakers-naming:p1:inst-error
    if (res.status === "error")
      return setError(
        t(
          res.error.code === "not_found"
            ? "speakers.err_gone"
            : "speakers.name_err",
          { name: label },
        ),
      );
    // @cpt-end:cpt-noter-state-ui-speakers-naming:p1:inst-error
    // @cpt-begin:cpt-noter-flow-ui-speakers-post-call:p1:inst-outcome
    const named = res.data.speakers.find((s) => s.id === speaker.id);
    const short =
      named?.label.type === "person" ? named.label.person.short_name : to;
    holdUndo({
      target: { type: "change", change_id: res.data.change_id },
      message: t("speakers.named", {
        from: label,
        to: short,
        count: named?.segment_count ?? speaker.segment_count,
      }),
    });
    // @cpt-end:cpt-noter-flow-ui-speakers-post-call:p1:inst-outcome
  };
  const chip = (c: PersonChip) => (
    <button
      key={c.id}
      type="button"
      className="pc-name__chip"
      aria-pressed={pick?.name === c.display_name}
      onClick={() => (
        setPick({
          ref: { type: "existing", person_id: c.id },
          name: c.display_name,
        }),
        setText(c.display_name),
        setError(null)
      )}
    >
      {c.display_name}
    </button>
  );
  return (
    <div
      role="group"
      aria-label={label}
      data-component="cpt-noter-component-ui-speaker-naming-panel"
      data-state={error ? "error" : pick ? "selected" : "unnamed"}
      className="pc-name__row"
    >
      <div className="pc-name__who">
        <strong>{label}</strong>
        <span className="pc-name__lines">
          {t("speakers.row.lines", { count: speaker.segment_count })}
        </span>
        {p.audio && speaker.sample && (
          <PushButton
            size="small"
            icon="play"
            label={
              samplePlaying(sample, playback)
                ? t("speakers.row.playing")
                : t("speakers.row.sample")
            }
            onAction={() => void play()}
          />
        )}
      </div>
      {line && <p className="pc-name__line">{line}</p>}
      {chips.length > 0 && (
        <div
          className="pc-name__chips"
          role="group"
          aria-label={t("speakers.row.suggest")}
        >
          <span className="pc-name__hint">{t("speakers.row.suggest")}</span>
          {chips.map(chip)}
        </div>
      )}
      <div className="pc-name__act">
        <PersonPicker
          bridge={p.bridge}
          variant="inline"
          people={people}
          participants={p.participants}
          speakers={p.speakers}
          confirmLabel={t("speakers.create_name")}
          value={text}
          error={error}
          disabled={busy}
          onPick={(ref, to) => (
            setText(to),
            setError(null),
            setPick(ref ? { ref, name: to } : null)
          )}
          onConfirm={(ref, to) => void name(ref, to)}
        />
        <PushButton
          variant="primary"
          label={t("speakers.row.name")}
          disabled={!pick || busy}
          loading={busy}
          onAction={() => pick && void name(pick.ref, pick.name)}
        />
        <PushButton
          label={t("speakers.row.skip")}
          disabled={busy}
          onAction={onSkip}
        />
      </div>
    </div>
  );
}
