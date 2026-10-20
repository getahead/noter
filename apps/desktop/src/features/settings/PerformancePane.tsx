import { useState } from "react";

import { t } from "../../i18n/format";
import { PopupButton } from "../../ui/primitives/popup-button";
import { TextField } from "../../ui/primitives/text-field";
import { saveSection } from "./actions";
import { Group, Row } from "./form";
import type { PaneProps } from "./pane-props";

const KEEP = [90, 365].map((n) => ({ value: String(n), label: t("settings.perf.keep_days", { count: n }) }));

/** A percentage that applies when the user leaves the field or presses Return; a non-positive value is dropped. */
function Threshold({ label, stored, onCommit }: { label: string; stored: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    const n = Number(text);
    if (text !== null && n > 0 && n !== stored) onCommit(n);
    setText(null);
  };
  return (
    <Row label={label} note={t("settings.perf.of_budget")}>
      <span onBlur={commit}>
        <TextField variant="number" ariaLabel={label} cls="st-num" value={text ?? String(stored)} onChange={setText} onEnter={commit} />
      </span>
    </Row>
  );
}

export function PerformancePane({ bridge, settings }: PaneProps) {
  const p = settings.performance;
  return (
    <>
      <Group>
        <Row label={t("settings.perf.keep")}>
          <PopupButton options={KEEP} value={String(p.retention_days)} label={t("settings.perf.keep")} onAction={(v) => void saveSection(bridge, "performance", { retention_days: Number(v) })} />
        </Row>
      </Group>
      <Group title={t("settings.perf.thresholds")} foot={<span className="np-dim">{t("settings.perf.note")}</span>}>
        <Threshold label={t("settings.perf.near")} stored={p.near_pct} onCommit={(near_pct) => void saveSection(bridge, "performance", { near_pct })} />
        <Threshold label={t("settings.perf.over")} stored={p.over_pct} onCommit={(over_pct) => void saveSection(bridge, "performance", { over_pct })} />
      </Group>
    </>
  );
}
