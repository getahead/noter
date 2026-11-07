// The provenance chip (prototype C.provenanceChip): a time that opens its source. Click or Return resolves the span
// and opens the Transcript on it; the states while it does are on the chip itself.
import { useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { TimeSpan } from "../../core/bindings";
import { t } from "../../i18n/format";
import { openEvidence, spanTime } from "./evidence";

type Phase = "idle" | "loading" | "gone" | "error";

// @cpt-component:cpt-noter-component-ui-provenance-chip:p1
export function ProvenanceChip({ bridge, span, variant = "timestamp", unverified = false }: { bridge: Bridge; span: TimeSpan; variant?: "chip" | "inline" | "timestamp"; unverified?: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const open = async () => {
    setPhase("loading");
    const r = await openEvidence(bridge, span);
    setPhase(r.status === "ok" ? "idle" : r.status);
  };
  const common = { "data-component": "cpt-noter-component-ui-provenance-chip", "data-variant": unverified ? "unverified" : variant, "data-state": phase } as const;
  if (phase === "gone") return <span {...common} className="np-prov is-gone">{t("items.source_deleted")}</span>;
  return (
    <>
      <button type="button" {...common} className="np-prov" disabled={phase === "loading"} aria-label={t("items.open_source", { at: spanTime(span) })} onClick={() => void open()}>
        {phase === "loading" ? t("items.finding_source") : spanTime(span)}
      </button>
      {phase === "error" && (
        <span role="alert" className="np-prov__error">
          {t("items.source_error")} <button type="button" className="np-link" onClick={() => void open()}>{t("action.try_again")}</button>
        </span>
      )}
    </>
  );
}
