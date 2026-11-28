import { useId, useRef, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { PersonChip, PersonRef, SpeakerView, SplitSegmentResult, SplitSpeaker } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Popover } from "../../ui/primitives/popover";
import { PushButton } from "../../ui/primitives/push-button";
import { clock, langAttr, speakerName } from "../transcript/model";
import { splitTime, type SplitPoint } from "../transcript/split-point";
import { PersonPicker } from "./PersonPicker";
import { splitKey } from "./naming";
import "./speakers.css";

interface Props {
  bridge: Bridge;
  point: SplitPoint;
  measured?: number;
  participants: readonly PersonChip[];
  speakers: readonly SpeakerView[];
  onClose: () => void;
  onSplit: (result: SplitSegmentResult) => void;
  onStale: () => void;
}

// @cpt-component:cpt-noter-component-ui-split-line-popover:p1
// @cpt-dod:cpt-noter-dod-ui-speakers-split:p1
export function SplitLinePopover({ bridge, point: { seg, at, anchor }, measured, participants, speakers, onClose, onSplit, onStale }: Props) {
  // @cpt-begin:cpt-noter-flow-ui-speakers-split:p1:inst-split-preview
  const [choice, setChoice] = useState("new");
  const [person, setPerson] = useState<PersonRef | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState(false);
  const id = useId();
  const title = t("speakers.split.title", { time: clock(splitTime(seg, at, measured)) });
  const side = speakers.filter((s) => s.channel === seg.channel);
  const pick = (ref: PersonRef | null) => setPerson(ref);
  const speaker: SplitSpeaker | null = choice === "person" ? (person ? { type: "person", person } : null)
    : choice === "new" ? { type: "new" } : { type: "existing", speaker_id: choice };
  // @cpt-end:cpt-noter-flow-ui-speakers-split:p1:inst-split-preview

  // @cpt-begin:cpt-noter-flow-ui-speakers-split:p1:inst-split-save
  const submit = async (target: SplitSpeaker) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    const result = await bridge.act(splitKey(seg.id), "transcript_split_segment", () => bridge.core.transcriptSplitSegment({
      call_id: seg.call_id, segment_id: seg.id, at, speaker: target, expected_text: seg.text,
    }), { named: { conflict: "conflict", invalid_input: "invalid_input", not_found: "not_found" } });
    inFlight.current = false;
    setBusy(false);
    if (result.status === "ok") {
      onSplit(result.data);
      onClose();
    } else if (result.error.code === "conflict" || result.error.code === "not_found") {
      onStale();
    } else {
      setError(true);
    }
  };
  // @cpt-end:cpt-noter-flow-ui-speakers-split:p1:inst-split-save

  return (
    <Popover variant="speaker-rename" anchor={anchor} label={title} width={360} onClose={onClose}>
      <div className="cw-pr cw-split">
        <h3 className="cw-pr__title">{title}</h3>
        <div>
          <strong>{t("speakers.split.first")}</strong>
          <p>{speakerName(seg.speaker.label)}</p>
          <p lang={langAttr(seg.lang)}>{seg.text.slice(0, at).trimEnd()}</p>
        </div>
        <div>
          <label htmlFor={id}><strong>{t("speakers.split.second")}</strong></label>
          <p lang={langAttr(seg.lang)}>{seg.text.slice(at)}</p>
          <select id={id} value={choice} disabled={busy} onChange={(e) => { setChoice(e.currentTarget.value); setPerson(null); }}>
            <option value="new">{t("speakers.split.new")}</option>
            {side.map((s) => <option key={s.id} value={s.id}>{speakerName(s.label)}</option>)}
            <option value="person">{t("speakers.split.person")}</option>
          </select>
        </div>
        {choice === "person" && <PersonPicker
          bridge={bridge}
          variant="popover"
          participants={participants}
          speakers={side}
          confirmLabel={t("speakers.split.confirm")}
          disabled={busy}
          onPick={pick}
          onConfirm={(ref, _, isNew) => { if (isNew) void submit({ type: "person", person: ref }); }}
        />}
        {error && <p role="alert">{t("speakers.split.error")}</p>}
        <div className="cw-pr__foot">
          <PushButton variant="primary" label={t("speakers.split.confirm")} disabled={!speaker || busy} onAction={() => speaker ? submit(speaker) : undefined} />
        </div>
      </div>
    </Popover>
  );
}
