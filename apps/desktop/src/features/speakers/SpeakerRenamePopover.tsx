// Rename Speaker popover (DESIGN › Speaker label; prototype src/js/20-b-components.js `speaker-rename`): the person picker
// with a scope, anchored to the speaker's label. The core resolves the identity; the UI writes what it returns.
import { useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type {
  PersonChip,
  PersonRef,
  SegmentId,
  SpeakerView,
} from "../../core/bindings";
import { t } from "../../i18n/format";
import { Popover } from "../../ui/primitives/popover";
import { PushButton } from "../../ui/primitives/push-button";
import { RadioGroup } from "../../ui/primitives/radio-group";
import { speakerName } from "../transcript/model";
import { PersonPicker } from "./PersonPicker";
import { renameKey } from "./picker";
import "./speakers.css";

export interface SpeakerRenamePopoverProps {
  bridge: Bridge;
  callId: string;
  speaker: SpeakerView;
  /** The line the label was clicked on: **Only this line** renames that one. */
  segmentId: SegmentId;
  participants: readonly PersonChip[];
  speakers: readonly SpeakerView[];
  anchor: HTMLElement | null;
  onClose: () => void;
  /** The core named the speaker: the status text and the change to undo. */
  onNamed: (text: string, change_id: string) => void;
}

const NAMED = { not_found: "not_found", invalid_input: "invalid_input" };

// @cpt-flow:cpt-noter-flow-ui-speakers-live-name:p1
export function SpeakerRenamePopover({
  bridge,
  callId,
  speaker,
  segmentId,
  participants,
  speakers,
  anchor,
  onClose,
  onNamed,
}: SpeakerRenamePopoverProps) {
  // @cpt-begin:cpt-noter-flow-ui-speakers-live-name:p1:inst-open
  // @cpt-begin:cpt-noter-flow-ui-speakers-live-name:p1:inst-picker
  // @cpt-begin:cpt-noter-flow-ui-speakers-live-name:p1:inst-select
  const [chosen, setChosen] = useState<{ ref: PersonRef; name: string } | null>(
    null,
  );
  // @cpt-end:cpt-noter-flow-ui-speakers-live-name:p1:inst-select
  // @cpt-end:cpt-noter-flow-ui-speakers-live-name:p1:inst-picker
  // @cpt-end:cpt-noter-flow-ui-speakers-live-name:p1:inst-open
  const [scope, setScope] = useState<"whole_call" | "one_segment">(
    "whole_call",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = speakerName(speaker.label);

  // @cpt-begin:cpt-noter-flow-ui-speakers-live-name:p1:inst-rename
  const rename = async (ref: PersonRef, isNew: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await bridge.act(
      renameKey(speaker.id),
      "transcript_rename_speaker",
      () =>
        bridge.core.transcriptRenameSpeaker({
          call_id: callId,
          speaker_id: speaker.id,
          person: ref,
          scope:
            scope === "whole_call"
              ? { type: "whole_call" }
              : { type: "one_segment", segment_id: segmentId },
        }),
      { entity: "speaker", named: NAMED },
    );
    setBusy(false);
    // @cpt-end:cpt-noter-flow-ui-speakers-live-name:p1:inst-rename
    // @cpt-begin:cpt-noter-flow-ui-speakers-live-name:p1:inst-error
    // the draft and the focus stay; a missing speaker is refreshed by the transcript's own events before another attempt
    if (res.status === "error")
      return setError(t("speakers.err", { name: label }));
    // @cpt-end:cpt-noter-flow-ui-speakers-live-name:p1:inst-error
    // @cpt-begin:cpt-noter-flow-ui-speakers-live-name:p1:inst-result
    const named = res.data.speakers.find((s) => s.id === speaker.id);
    const to =
      named?.label.type === "person"
        ? named.label.person.short_name
        : (chosen?.name ?? label);
    const count =
      scope === "one_segment"
        ? 1
        : (named?.segment_count ?? speaker.segment_count);
    onNamed(
      t(isNew ? "speakers.named_new" : "speakers.named", {
        from: label,
        to,
        count,
      }),
      res.data.change_id,
    );
    // @cpt-end:cpt-noter-flow-ui-speakers-live-name:p1:inst-result
    // @cpt-begin:cpt-noter-flow-ui-speakers-live-name:p1:inst-return
    onClose();
    // @cpt-end:cpt-noter-flow-ui-speakers-live-name:p1:inst-return
  };

  return (
    <Popover
      variant="speaker-rename"
      anchor={anchor}
      width={320}
      label={t("speakers.rename_title", { name: label })}
      onClose={onClose}
    >
      <div className="cw-pr">
        <h3 className="cw-pr__title">
          {t("speakers.rename_title", { name: label })}
        </h3>
        <PersonPicker
          bridge={bridge}
          variant="popover"
          participants={participants}
          speakers={speakers}
          confirmLabel={t("speakers.create_name")}
          error={error}
          disabled={busy}
          onPick={(ref, name) => (
            setError(null),
            setChosen(ref ? { ref, name } : null)
          )}
          onConfirm={(ref, name, isNew) => (
            setChosen({ ref, name }),
            void rename(ref, isNew)
          )}
          onClose={onClose}
        />
        <RadioGroup
          name="speaker-rename-scope"
          variant="horizontal"
          options={[
            { value: "whole_call", label: t("speakers.scope.whole") },
            { value: "one_segment", label: t("speakers.scope.line") },
          ]}
          value={scope}
          onAction={(v) => setScope(v as typeof scope)}
        />
        <div className="cw-pr__foot">
          <PushButton
            label={t("speakers.rename")}
            variant="primary"
            disabled={!chosen || busy}
            loading={busy}
            onAction={() => chosen && void rename(chosen.ref, false)}
          />
        </div>
      </div>
    </Popover>
  );
}
