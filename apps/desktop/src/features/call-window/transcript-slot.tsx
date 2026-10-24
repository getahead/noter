// shortcut: a placeholder for the live and tail transcript (CS-R2, FP-R5) until the live-transcript
// feature's TranscriptView lands (lane/ui/live-transcript); it shows confirmed lines only. Replace it then.
import { useWindow } from "../../app/use-window";
import type { Bridge } from "../../app/bridge/bridge";
import { callTime, t } from "../../i18n/format";

export function TranscriptSlot({ bridge, callId, tailLines }: { bridge: Bridge; callId: string; tailLines?: number }) {
  const data = useWindow(bridge, (s) => s.streams.transcript_subscribe?.data);
  const segments = data?.call_id === callId ? data.segments : [];
  if (!segments.length) return <div className="np-muted">{t("cw.waiting")}</div>;
  return (
    <div role="log" aria-live="off" aria-label={t("cw.transcript")}>
      {(tailLines ? segments.slice(-tailLines) : segments).map((s) => (
        <div key={s.id}>
          <span className="np-tnum np-dim">{callTime(s.t0_ms / 1000)}</span> {s.text}
        </div>
      ))}
    </div>
  );
}
