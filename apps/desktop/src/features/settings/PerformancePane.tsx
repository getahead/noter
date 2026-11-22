import { useState } from "react";

import { t } from "../../i18n/format";
import { Icon } from "../../ui/icons";
import { Checkbox } from "../../ui/primitives/checkbox";
import { PopupButton } from "../../ui/primitives/popup-button";
import { Table, Th } from "../../ui/primitives/table";
import { TextField } from "../../ui/primitives/text-field";
import { saveSection, useRowErrors } from "./actions";
import { Group, Row } from "./form";
import type { PaneProps } from "./pane-props";

const KEEP = [90, 365].map((n) => ({ value: String(n), label: t("settings.perf.keep_days", { count: n }) }));

/** The percentage to save for typed text; null when nothing was typed, it is not positive or it did not change. */
export const thresholdCommit = (text: string | null, stored: number): number | null => {
  const n = Number(text);
  return text !== null && n > 0 && n !== stored ? n : null;
};

/** A table row of the thresholds: the status and its percentage, which applies when the user leaves the field or presses
 * Return; a non-positive value is dropped. */
function Threshold({ label, stored, error, onCommit }: { label: string; stored: number; error: string | null; onCommit: (n: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    const n = thresholdCommit(text, stored);
    if (n !== null) onCommit(n);
    setText(null);
  };
  return (
    <tr>
      <td>{label}</td>
      <td>
        <span onBlur={commit}>
          <TextField variant="number" ariaLabel={label} cls="st-num" value={text ?? String(stored)} onChange={setText} onEnter={commit} />
        </span>{" "}
        {t("settings.perf.of_budget")}
        <div className="st-row__live" aria-live="polite">
          {error && (
            <span className="st-row__err">
              <Icon name="warning" size={12} />
              {error}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

/** The stage timeline's stages (Bottleneck.stage keys); an empty `sampled_stages` means every stage is sampled. */
const STAGES = ["confirmed_text", "signals", "retrieval", "first_token", "full_card", "merge"] as const;
const STAGE_LABEL = {
  confirmed_text: "settings.perf.stage.confirmed_text",
  signals: "settings.perf.stage.signals",
  retrieval: "settings.perf.stage.retrieval",
  first_token: "settings.perf.stage.first_token",
  full_card: "settings.perf.stage.full_card",
  merge: "settings.perf.stage.merge",
} as const;

export function PerformancePane({ bridge, settings }: PaneProps) {
  const p = settings.performance;
  const rowError = useRowErrors(bridge);
  return (
    <>
      <Group>
        <Row label={t("settings.perf.stages")} error={rowError("performance", "sampled_stages")}>
          <div className="st-checks" role="group" aria-label={t("settings.perf.stages")}>
            {STAGES.map((stage) => (
              <Checkbox
                key={stage}
                label={t(STAGE_LABEL[stage])}
                checked={p.sampled_stages.length === 0 || p.sampled_stages.includes(stage)}
                onAction={(on) =>
                  void saveSection(bridge, "performance", (current) => {
                    const sampled = current.sampled_stages.length === 0 ? [...STAGES] : current.sampled_stages;
                    return { sampled_stages: STAGES.filter((x) => (x === stage ? on : sampled.includes(x))) };
                  })
                }
              />
            ))}
          </div>
        </Row>
        <Row label={t("settings.perf.keep")} error={rowError("performance", "retention_days")}>
          <PopupButton options={KEEP} value={String(p.retention_days)} label={t("settings.perf.keep")} onAction={(v) => void saveSection(bridge, "performance", { retention_days: Number(v) })} />
        </Row>
      </Group>
      <Group title={t("settings.perf.thresholds")} foot={<span className="np-dim">{t("settings.perf.note")}</span>}>
        {/* a small table, as in the prototype: Status · When p95 is above */}
        <Table label={t("settings.perf.thresholds")}>
          <thead>
            <tr>
              <Th label={t("settings.perf.col_status")} />
              <Th label={t("settings.perf.col_when")} />
            </tr>
          </thead>
          <tbody>
            <Threshold label={t("settings.perf.near")} error={rowError("performance", "near_pct")} stored={p.near_pct} onCommit={(near_pct) => void saveSection(bridge, "performance", { near_pct })} />
            <Threshold label={t("settings.perf.over")} error={rowError("performance", "over_pct")} stored={p.over_pct} onCommit={(over_pct) => void saveSection(bridge, "performance", { over_pct })} />
          </tbody>
        </Table>
      </Group>
    </>
  );
}
