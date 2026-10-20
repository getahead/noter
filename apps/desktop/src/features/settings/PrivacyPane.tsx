import { useState } from "react";

import { useWindow } from "../../app/use-window";
import type { PrivacyMode } from "../../core/bindings";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { Badge } from "../../ui/primitives/badge";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PushButton } from "../../ui/primitives/push-button";
import { RadioGroup } from "../../ui/primitives/radio-group";
import { Toggle } from "../../ui/primitives/toggle";
import { modeIndicator } from "../shell/mode-indicator";
import { saveSection } from "./actions";
import { Group, Row } from "./form";
import { ShareTestSheet } from "./ShareTestSheet";
import { choices, type PaneProps } from "./pane-props";

const RETENTION = choices({ days7: "settings.privacy.retention_7", days30: "settings.privacy.retention_30", days90: "settings.privacy.retention_90", forever: "settings.privacy.retention_forever", never_store: "settings.privacy.retention_never" });
const MODES: { value: PrivacyMode; label: string; note: string }[] = [
  { value: "cloud_redacted", label: t("settings.privacy.mode_redacted"), note: t("settings.privacy.mode_redacted_note") },
  { value: "cloud_allowed", label: t("settings.privacy.mode_cloud"), note: t("settings.privacy.mode_cloud_note") },
  { value: "local_only", label: t("settings.privacy.mode_local"), note: t("settings.privacy.mode_local_note") },
];

// @cpt-dod:cpt-noter-dod-ui-settings-privacy:p1
export function PrivacyPane({ bridge, settings }: PaneProps) {
  const { privacy, audio } = settings;
  const degraded = useWindow(bridge, (s) => s.whole.degraded?.states ?? []);
  const inForce = modeIndicator({ mode: privacy.mode, degraded, sensitiveCall: false });
  const due = audio.retention_next_run_deletes;
  const [sheet, setSheet] = useState(false);
  return (
    <>
      <Group>
        <Row label={t("settings.privacy.mode")}>
          <RadioGroup name="st-pmode" label={t("settings.privacy.mode")} options={MODES} value={privacy.mode} onAction={(mode) => void saveSection(bridge, "privacy", { mode: mode as PrivacyMode })} />
          <div className="st-modenow">
            {t("settings.privacy.in_force")} <Badge text={inForce.word} tone={inForce.warning ? "warning" : "info"} />
          </div>
        </Row>
        <Row label={t("settings.privacy.retention")} note={due ? t("settings.privacy.retention_due", { count: due }) : t("settings.privacy.retention_none")}>
          <PopupButton options={RETENTION} value={audio.retention} label={t("settings.privacy.retention")} onAction={(v) => void saveSection(bridge, "audio", { retention: v as typeof audio.retention })} />
        </Row>
        <Row label={t("settings.privacy.metrics")} note={t("settings.privacy.metrics_note")}>
          <Toggle on={privacy.behaviour_metrics} size="small" ariaLabel={t("settings.privacy.metrics")} onAction={(behaviour_metrics) => void saveSection(bridge, "privacy", { behaviour_metrics })} />
        </Row>
      </Group>
      <Group title={t("settings.privacy.left_mac")} foot={<><span className="np-tb__spacer" />{/* @cpt-begin:cpt-noter-flow-ui-settings-share-test:p1:inst-open-share-test */}
<PushButton label={t("settings.privacy.share_test")} onAction={() => setSheet(true)} />
{/* @cpt-end:cpt-noter-flow-ui-settings-share-test:p1:inst-open-share-test */}</>}>
        <EmptyState variant="section" title={t("settings.privacy.left_mac_later")} />
      </Group>
      {sheet && <ShareTestSheet bridge={bridge} onClose={() => setSheet(false)} />}
    </>
  );
}
