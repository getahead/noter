import { useState, type KeyboardEvent } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { ErrorCode, PlaybackState, SearchHit, TimeSpan } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { shortDay, t } from "../../i18n/format";
import { IconButton } from "../../ui/primitives/icon-button";
import { Badge } from "../../ui/primitives/badge";
import { KIND_KEY } from "../items/kind";
import { ActionItemRow } from "../items/ActionItemRow";
import { OutputItemRow } from "../call-page/OutputItemRow";
import { Link } from "../../ui/primitives/link";
import { ProvenanceChip } from "../items/ProvenanceChip";
import { openSpan } from "../items/evidence";
import { segments } from "./search-model";

const PLAY_NOTE: Partial<Record<ErrorCode, MsgKey>> = {
  audio_deleted: "transcript.play.no_audio",
  replay_needs_headphones: "transcript.play.speakers",
  own_sounds_not_excluded: "transcript.play.own_sounds",
  output_route_unknown: "transcript.play.unknown",
};

/** Whether the shared playback is on this span right now: playing, in this call, between the span's two ends. */
export const isPlayingSpan = (playback: PlaybackState | null | undefined, span: TimeSpan | null): boolean =>
  !!playback && !!span && playback.playing && playback.call_id === span.call_id && playback.position_ms >= span.t0_ms && playback.position_ms <= span.t1_ms;

/** Space or ▶ on a transcript hit: plays the span, or stops it while it plays; a refusal says why (no audio left, replay while recording) instead of staying silent. */
// @cpt-begin:cpt-noter-flow-ui-library-search-topics-search:p1:inst-playback
export async function togglePlay(bridge: Bridge, span: TimeSpan, playing: boolean): Promise<{ playing: boolean; note: MsgKey | null }> {
  if (playing) {
    await bridge.act("audio_stop", "audio_stop", () => bridge.core.audioStop({}), { screen: "library-search" });
    return { playing: false, note: null };
  }
  const r = await bridge.act("audio_play", "audio_play", () => bridge.core.audioPlay({ call_id: span.call_id, from_ms: span.t0_ms, to_ms: span.t1_ms, channel: span.channel }), { screen: "library-search" });
  return r.status === "ok" ? { playing: r.data.playing, note: null } : { playing: false, note: PLAY_NOTE[r.error.code] ?? "search.play_failed" };
// @cpt-end:cpt-noter-flow-ui-library-search-topics-search:p1:inst-playback
}

// @cpt-component:cpt-noter-component-ui-search-result-row:p1
/** One hit: the call, the original snippet with the core's highlights (text nodes, never HTML), and › to open it. */
/** `playback` is the window's playback state, handed down so Pause follows the real playback (it ends, or another span starts) and the row holds none of its own. */
export function SearchResultRow({ bridge, hit, playback }: { bridge: Bridge; hit: SearchHit; playback?: PlaybackState | null }) {
  const lang = hit.lang === null ? undefined : typeof hit.lang === "string" ? hit.lang : hit.lang.code;
  const go = () => {
    const x = hit.target;
    // @cpt-begin:cpt-noter-flow-ui-library-search-topics-search:p1:inst-open-span
    if (x.type === "segment") void openSpan(bridge, x.span, "library-search");
    // @cpt-end:cpt-noter-flow-ui-library-search-topics-search:p1:inst-open-span
    // @cpt-begin:cpt-noter-flow-ui-library-search-topics-search:p1:inst-if-document
    // @cpt-begin:cpt-noter-flow-ui-library-search-topics-search:p1:inst-open-document
    else if (x.type === "document") void bridge.act("open_external", "open_external", () => bridge.core.openExternal({ target: { type: "document", document_id: x.document_id, chunk_id: x.chunk_id } }), { screen: "library-search" });
    // @cpt-end:cpt-noter-flow-ui-library-search-topics-search:p1:inst-open-document
    // @cpt-end:cpt-noter-flow-ui-library-search-topics-search:p1:inst-if-document
    else if (hit.call) void bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "call_page", call_id: hit.call!.id, tab: "summary" } }), { screen: "library-search" });
  };
  const span = hit.target.type === "segment" ? hit.target.span : null;
  const [note, setNote] = useState<MsgKey | null>(null);
  const playing = isPlayingSpan(playback, span);
  const play = () => span && void togglePlay(bridge, span, playing).then((r) => setNote(r.note));
  // Space plays the span and Return opens it; ↑ and ↓ walk the hits.
  const key = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") go();
    // @cpt-begin:cpt-noter-flow-ui-library-search-topics-search:p1:inst-play
    else if (e.key === " " && span) (e.preventDefault(), play());
    // @cpt-end:cpt-noter-flow-ui-library-search-topics-search:p1:inst-play
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const rows = Array.from(document.querySelectorAll<HTMLElement>(".lb-hit"));
      rows[rows.indexOf(e.currentTarget) + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
      e.preventDefault();
    }
  };
  // An item hit is the item's own row (owner, text, evidence chip, due, state), as on its call page (issue 1155).
  if (hit.target.type === "item" && hit.item)
    return (
      <li className="lb-hit lb-hit--item" data-component="cpt-noter-component-ui-search-result-row" data-strength={hit.strength} tabIndex={0} onKeyDown={key}>
        {hit.item.kind === "action_item" ? <ActionItemRow bridge={bridge} item={hit.item} variant="compact" /> : <ul className="lb-items"><OutputItemRow bridge={bridge} item={hit.item} /></ul>}
      </li>
    );
  return (
    <li className="lb-hit" data-component="cpt-noter-component-ui-search-result-row" data-target={hit.target.type} data-strength={hit.strength} tabIndex={0} onKeyDown={key}>
      {hit.title !== hit.snippet && <span className="lb-hit__title">{hit.title}</span>}
      {hit.target.type === "item" && hit.item_kind && Object.hasOwn(KIND_KEY, hit.item_kind) && <Badge kind="kind" text={t(KIND_KEY[hit.item_kind])} />}
      {/* @cpt-begin:cpt-noter-algo-ui-library-search-topics-results:p1:inst-highlights */}
      <span className="lb-hit__snippet" lang={lang}>
        {segments(hit.snippet, hit.highlights).map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : s.text))}
      </span>
      {/* @cpt-end:cpt-noter-algo-ui-library-search-topics-results:p1:inst-highlights */}
      {hit.call && <span className="np-dim">{t("search.from_call", { title: hit.call.title, date: shortDay(hit.call.started_at, undefined) })}</span>}
      {hit.cross_language && <span className="np-dim">{t("search.cross_language")}</span>}
      <span className="lb-hit__go">
      {span && <IconButton icon={playing ? "pause" : "play"} label={t(playing ? "playback.pause" : "transcript.play")} size="inline" onAction={play} />}
      {note && <span className="np-dim" role="status">{t(note)}</span>}
      {/* a transcript hit opens at its moment from the timestamp chip, as in the prototype; other hits keep the link */}
      {span ? <ProvenanceChip bridge={bridge} span={span} /> : <Link label={t("search.open")} onAction={go} />}
      </span>
    </li>
  );
}
