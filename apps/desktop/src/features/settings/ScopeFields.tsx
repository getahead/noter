// Source scope: all calls, or the chosen call types. People in a limited scope are kept as the source has them.
import { useEffect, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { CallTypeInfo, PersonRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Checkbox } from "../../ui/primitives/checkbox";
import { RadioGroup } from "../../ui/primitives/radio-group";
import { PersonPicker } from "../speakers/PersonPicker";
import { peopleChips, readCallTypes, readPeople, toggleCallType, withPeople, type ScopeDraft } from "./sources";

export function useCallTypes(bridge: Bridge): CallTypeInfo[] {
  const [types, setTypes] = useState<CallTypeInfo[]>([]);
  useEffect(() => void readCallTypes(bridge).then(setTypes), [bridge]);
  return types;
}

export function usePeople(bridge: Bridge): PersonRow[] {
  const [people, setPeople] = useState<PersonRow[]>([]);
  useEffect(() => void readPeople(bridge).then(setPeople), [bridge]);
  return people;
}

export function ScopeFields({ bridge, types, people, value, onChange }: { bridge: Bridge; types: CallTypeInfo[]; people: PersonRow[]; value: ScopeDraft; onChange: (v: ScopeDraft) => void }) {
  return (
    <div className="st-scope">
      <RadioGroup name="src-scope" label={t("sources.scope")} value={value.all ? "all" : "limited"} onAction={(v) => onChange({ ...value, all: v === "all" })}
        options={[{ value: "all", label: t("sources.scope_all_calls") }, { value: "limited", label: t("sources.scope_limited") }]} />
      {!value.all && (
        <div className="st-scope__types" role="group" aria-label={t("sources.scope_types")}>
          {types.map((c) => <Checkbox key={c.id} label={c.label} checked={value.callTypes.includes(c.id)} onAction={(on) => onChange(toggleCallType(value, c.id, on))} />)}
        </div>
      )}
      {!value.all && (
        <div className="st-scope__people">
          <div className="st-row__label">{t("sources.scope_people")}</div>
          <PersonPicker bridge={bridge} variant="inline" participants={[]} speakers={[]} people={people} confirmLabel="" onPick={() => {}} multiple selected={peopleChips(value.people, people)} onChange={(next) => onChange(withPeople(value, next))} />
        </div>
      )}
    </div>
  );
}
