// Source scope: all calls, or the chosen call types. People in a limited scope are kept as the source has them.
import { useEffect, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { CallTypeInfo } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Checkbox } from "../../ui/primitives/checkbox";
import { RadioGroup } from "../../ui/primitives/radio-group";
import { readCallTypes, toggleCallType, type ScopeDraft } from "./sources";

export function useCallTypes(bridge: Bridge): CallTypeInfo[] {
  const [types, setTypes] = useState<CallTypeInfo[]>([]);
  useEffect(() => void readCallTypes(bridge).then(setTypes), [bridge]);
  return types;
}

export function ScopeFields({ types, value, onChange }: { types: CallTypeInfo[]; value: ScopeDraft; onChange: (v: ScopeDraft) => void }) {
  return (
    <div className="st-scope">
      <RadioGroup name="src-scope" label={t("sources.scope")} value={value.all ? "all" : "limited"} onAction={(v) => onChange({ ...value, all: v === "all" })}
        options={[{ value: "all", label: t("sources.scope_all_calls") }, { value: "limited", label: t("sources.scope_limited") }]} />
      {!value.all && (
        <div className="st-scope__types" role="group" aria-label={t("sources.scope_types")}>
          {types.map((c) => <Checkbox key={c.id} label={c.label} checked={value.callTypes.includes(c.id)} onAction={(on) => onChange(toggleCallType(value, c.id, on))} />)}
        </div>
      )}
    </div>
  );
}
