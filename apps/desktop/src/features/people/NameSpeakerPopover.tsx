// Name Speaker N: the sample, the person picker and the one call's speaker named through `transcript_rename_speaker`.
// A speaker is one row per call (no recurring-voice group in the contract), so the change never claims several calls.
import { useEffect, useRef, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { PersonRef, PersonRow, UnnamedSpeaker } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Popover } from "../../ui/primitives/popover";
import { holdUndo } from "../history/undo";
import { bumpPerson } from "./person-store";
import { PersonPicker } from "../speakers/PersonPicker";
import { renameKey } from "../speakers/picker";
import "../speakers/speakers.css";

/** The words of the row's sample, in their own language; null when it has none or the read failed (no speech is made up). */
export async function readSample(bridge: Bridge, u: UnnamedSpeaker): Promise<{ text: string; lang: string } | null> {
  if (!u.sample) return null;
  // @cpt-begin:cpt-noter-flow-ui-people-name:p1:inst-sample
  const r = await bridge.act("people:sample", "transcript_span", () => bridge.core.transcriptSpan({ span: u.sample! }), { screen: "people" });
  // @cpt-end:cpt-noter-flow-ui-people-name:p1:inst-sample
  const seg = r.status === "ok" ? r.data.segments.find((s) => s.text.trim()) : undefined;
  return seg ? { text: seg.text, lang: typeof seg.lang === "string" ? seg.lang : seg.lang.code } : null;
}

// @cpt-begin:cpt-noter-flow-ui-people-name:p1:inst-if-single
// @cpt-begin:cpt-noter-flow-ui-people-name:p1:inst-name-single
/** Names the speaker in its call; the core's change goes to the Undo strip. */
export async function nameSpeaker(bridge: Bridge, u: UnnamedSpeaker, ref: PersonRef, to: string): Promise<boolean> {
  const label = t("people.unnamed_label", { n: u.n });
  const res = await bridge.act(renameKey(u.speaker_id), "transcript_rename_speaker", () => bridge.core.transcriptRenameSpeaker({ call_id: u.call.id, speaker_id: u.speaker_id, person: ref, scope: { type: "whole_call" } }), { entity: "speaker", screen: "people" });
  if (res.status === "error") return false;
  const named = res.data.speakers.find((s) => s.id === u.speaker_id);
  const name = named?.label.type === "person" ? named.label.person.short_name : to;
  // @cpt-begin:cpt-noter-flow-ui-people-name:p1:inst-undo
  holdUndo({ target: { type: "change", change_id: res.data.change_id }, message: t(ref.type === "new" ? "people.named_new" : "people.named", { from: label, to: name, call: u.call.title }), refresh: bumpPerson });
  // @cpt-end:cpt-noter-flow-ui-people-name:p1:inst-undo
  return true;
}
// @cpt-end:cpt-noter-flow-ui-people-name:p1:inst-name-single
// @cpt-end:cpt-noter-flow-ui-people-name:p1:inst-if-single

export function NameSpeakerPopover({ bridge, speaker, people, anchor, onClose, onNamed }: { bridge: Bridge; speaker: UnnamedSpeaker; people: readonly PersonRow[]; anchor: HTMLElement | null; onClose: () => void; onNamed?: () => void }) {
  const label = t("people.unnamed_label", { n: speaker.n });
  const [sample, setSample] = useState<{ text: string; lang: string } | null>(null);
  const [form, setForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // a refused naming keeps the list and the typed name; the field was disabled while it ran, so focus comes back to it
  useEffect(() => void (error && root.current?.querySelector("input")?.focus()), [error]);
  useEffect(() => {
    let current = true;
    void readSample(bridge, speaker).then((s) => current && setSample(s));
    return () => void (current = false);
  }, [bridge, speaker]);
  // @cpt-begin:cpt-noter-flow-ui-people-name:p1:inst-pick
  async function confirm(ref: PersonRef, name: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await nameSpeaker(bridge, speaker, ref, name);
    setBusy(false);
    // @cpt-begin:cpt-noter-flow-ui-people-name:p1:inst-return-name
    if (ok) (onNamed?.(), onClose());
    // @cpt-end:cpt-noter-flow-ui-people-name:p1:inst-return-name
    else setError(t("speakers.name_err", { name: label }));
  }
  // @cpt-end:cpt-noter-flow-ui-people-name:p1:inst-pick
  return (
    <Popover variant="speaker-name" anchor={anchor} width={320} label={t(form ? "people.name_new_title" : "people.name_title", { label })} onClose={onClose}>
      <div className="cw-pr" ref={root}>
        {/* @cpt-begin:cpt-noter-flow-ui-people-name:p1:inst-name-popover */}
        <h3 className="cw-pr__title">{t(form ? "people.name_new_title" : "people.name_title", { label })}</h3>
        {sample && <div className="np-dim t-callout" lang={sample.lang}>{sample.text}</div>}
        <PersonPicker
          bridge={bridge}
          variant="popover"
          participants={[]}
          speakers={[]}
          people={people}
          confirmLabel={t("speakers.create_name")}
          error={error}
          disabled={busy}
          confirmOnPick
          dupExists
          onPick={() => setError(null)}
          onConfirm={(ref, name) => void confirm(ref, name)}
          onClose={onClose}
          onForm={setForm}
        />
        {/* @cpt-end:cpt-noter-flow-ui-people-name:p1:inst-name-popover */}
        {/* one row per call: a speaker number shared with other calls is still named here only (owner #1151) */}
        {/* @cpt-begin:cpt-noter-flow-ui-people-name:p1:inst-batch-gap */}
        <div className="np-dim t-callout">{t("people.name_note", { label })}</div>
        {/* @cpt-end:cpt-noter-flow-ui-people-name:p1:inst-batch-gap */}
      </div>
    </Popover>
  );
}
