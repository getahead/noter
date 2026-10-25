// PC-R4 Call info, the inspector of the call page (prototype `inspector('call-info')`, 280 pt): Participants, Call,
// Privacy, Audio, Processing. Tags, Delete Audio Now… and Show Performance belong to later milestones.
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { modeIndicator } from "../shell/mode-indicator";
import { ModeIndicator } from "../shell/mode-indicator-view";
import { PopupButton } from "../../ui/primitives/popup-button";
import { Toggle } from "../../ui/primitives/toggle";
import { openPrivacySettings, setCallType, setSensitive } from "./actions";
import { useExtras, useTypes } from "./cache";
import { callInfo } from "./logic";

// @cpt-begin:cpt-noter-flow-ui-call-page-frame-open:p1:inst-call-info
export function CallInfo({ bridge, callId }: { bridge: Bridge; callId: string }) {
  const call = useWindow(bridge, (s) => s.entities.call[callId]);
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const privacy = useWindow(bridge, (s) => s.whole.privacy);
  const degraded = useWindow(bridge, (s) => s.whole.degraded);
  const extras = useExtras(callId);
  const types = useTypes();
  if (!call || !prefs) return null;
  const typeLabel = types.find((x) => x.id === call.call_type)?.label ?? call.call_type;
  const info = callInfo(call, { audio_not_stored: extras?.audio_not_stored ?? false }, Date.now(), prefs, typeLabel);
  const mode = modeIndicator({ mode: privacy?.mode ?? "cloud_redacted", degraded: degraded?.states ?? [], sensitiveCall: info.sensitive });
  return (
    <div className="pc-info" data-variant="call-info">
      <header className="pc-info__head">
        <span className="t-headline">{t("callpage.info")}</span>
      </header>
      <div className="pc-info__sec">
        <h3 className="pc-info__h">{t("callpage.info.participants")}</h3>
        <div className="pc-info__people">
          {info.participants.map((p) => (
            <span key={p.id} className="pc-chip" data-component="cpt-noter-component-ui-person-chip">
              <span className="pc-chip__dot" aria-hidden="true">
                {p.initials}
              </span>
              {p.short_name}
            </span>
          ))}
        </div>
      </div>
      <div className="pc-info__sec">
        <h3 className="pc-info__h">{t("callpage.info.call")}</h3>
        <dl className="np-kv">
          {info.call.flatMap((r) => [
            <dt key={`${r.label}-t`}>{r.label}</dt>,
            <dd key={`${r.label}-d`}>
              {r.label === t("callpage.info.type") && types.length ? (
                <PopupButton variant="inline" label={r.label} value={call.call_type} options={types.map((x) => ({ value: x.id, label: x.label }))} onAction={(v) => void setCallType(bridge, call.id, call.rev, v)} />
              ) : (
                r.value
              )}
            </dd>,
          ])}
        </dl>
      </div>
      <div className="pc-info__sec">
        <h3 className="pc-info__h">{t("callpage.info.privacy")}</h3>
        <div className="pc-info__row">
          <ModeIndicator view={mode} variant="call-info" onOpenPrivacy={() => void openPrivacySettings(bridge)} onMarkSensitive={() => void setSensitive(bridge, callId, true)} />
        </div>
        <Toggle label={t("callpage.sensitive")} on={info.sensitive} size="small" onAction={() => void setSensitive(bridge, callId, !info.sensitive)} />
      </div>
      <div className="pc-info__sec">
        <h3 className="pc-info__h">{t("callpage.info.audio")}</h3>
        <p className={info.audioKept ? undefined : "np-dim"}>{info.audio}</p>
      </div>
      <div className="pc-info__sec">
        <h3 className="pc-info__h">{t("callpage.info.processing")}</h3>
        <p className="np-dim">{info.processing}</p>
      </div>
    </div>
  );
}
// @cpt-end:cpt-noter-flow-ui-call-page-frame-open:p1:inst-call-info
