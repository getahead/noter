// Ask's pure view model: one streamed turn folded from its AskMsg events, and the recent list grouped by day.
import type { PersonRow } from "../../core/bindings";
import type { AskAnswer, AskMsg, AskThreadRow, Citation, CoreError } from "../../core/bindings";

export interface TurnView {
  text: string;
  citations: Citation[];
  answer: AskAnswer | null;
  error: CoreError | null;
  ended: boolean;
}

export type TurnPhase = "streaming" | "ready" | "not_found" | "weak" | "error" | "stopped" | "interrupted";

// @cpt-algo:cpt-noter-algo-ui-ask-stream:p1
/** Fold the events of one subscription in order: deltas grow the text, a citation keeps its stable number, done is authoritative. */
export function foldTurn(messages: readonly AskMsg[]): TurnView {
  const v: TurnView = { text: "", citations: [], answer: null, error: null, ended: false };
  for (const { event: e } of messages) {
    // @cpt-begin:cpt-noter-algo-ui-ask-stream:p1:inst-match
    switch (e.type) {
      case "delta":
        // @cpt-begin:cpt-noter-algo-ui-ask-stream:p1:inst-delta
        v.text += e.text;
        // @cpt-end:cpt-noter-algo-ui-ask-stream:p1:inst-delta
        break;
      case "citation":
        // @cpt-begin:cpt-noter-algo-ui-ask-stream:p1:inst-citation
        if (!v.citations.some((c) => c.n === e.citation.n)) v.citations.push(e.citation);
        // @cpt-end:cpt-noter-algo-ui-ask-stream:p1:inst-citation
        break;
      case "done":
        // @cpt-begin:cpt-noter-algo-ui-ask-stream:p1:inst-done
        v.answer = e.answer;
        v.text = e.answer.answer_md;
        v.citations = e.answer.citations;
        // @cpt-end:cpt-noter-algo-ui-ask-stream:p1:inst-done
        break;
      case "failed":
        v.error = e.error;
        break;
      case "ended":
        v.ended = true;
        break;
    }
    // @cpt-end:cpt-noter-algo-ui-ask-stream:p1:inst-match
  }
  return v;
}

/** The turn's state of the Answer turn machine. */
export function phaseOf(v: TurnView): TurnPhase {
  // @cpt-begin:cpt-noter-algo-ui-ask-stream:p1:inst-stopped
  if (v.error) return v.error.code === "answer_stopped" ? "stopped" : "error";
  // @cpt-end:cpt-noter-algo-ui-ask-stream:p1:inst-stopped
  // a stopped turn is stored with its partial text and the citations that had arrived
  if (v.answer?.stopped) return "stopped";
  if (v.answer) {
    // @cpt-begin:cpt-noter-state-ui-ask-turn:p1:inst-not-found
    if (!v.answer.found || v.answer.citations.length === 0) return "not_found";
    // @cpt-end:cpt-noter-state-ui-ask-turn:p1:inst-not-found
    // @cpt-begin:cpt-noter-state-ui-ask-turn:p1:inst-weak
    return v.answer.only_weak_evidence ? "weak" : "ready";
    // @cpt-end:cpt-noter-state-ui-ask-turn:p1:inst-weak
  }
  // @cpt-begin:cpt-noter-algo-ui-ask-stream:p1:inst-ended
  return v.ended ? "interrupted" : "streaming";
  // @cpt-end:cpt-noter-algo-ui-ask-stream:p1:inst-ended
}

/** Paragraphs of the answer text; React escapes them, so no model text becomes markup. */
export const paragraphs = (md: string): string[] => md.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

export type DayGroup = "today" | "last_week" | "earlier";

/** Recent questions grouped Today, Last week (the seven days before) and Earlier, newest first. */
export function groupThreads(rows: readonly AskThreadRow[], now: number): { key: DayGroup; rows: AskThreadRow[] }[] {
  const day = (ms: number) => new Date(new Date(ms).getFullYear(), new Date(ms).getMonth(), new Date(ms).getDate()).getTime();
  const today = day(now);
  const weekAgo = day(new Date(today).setDate(new Date(today).getDate() - 7));
  const groups: { key: DayGroup; rows: AskThreadRow[] }[] = [];
  for (const r of [...rows].sort((a, b) => b.updated_at - a.updated_at)) {
    const d = day(r.updated_at);
    const key: DayGroup = d >= today ? "today" : d >= weekAgo ? "last_week" : "earlier";
    const g = groups.find((x) => x.key === key);
    if (g) g.rows.push(r);
    else groups.push({ key, rows: [r] });
  }
  return groups;
}

/** Up to three suggested first questions, one per recent person; none until the people directory has rows. */
export const suggestionsOf = (people: readonly PersonRow[] | null | undefined, ask: (name: string) => string): string[] => (people ?? []).slice(0, 3).map((p) => ask(p.display_name));

/** What the page announces once when a turn is ready; nothing for any other phase. */
export function announcementOf(phase: TurnPhase | null, citations: number): "ask.ready_one" | "ask.ready_other" | "ask.ready_weak" | null {
  if (phase === "weak") return "ask.ready_weak";
  return phase === "ready" ? (citations === 1 ? "ask.ready_one" : "ask.ready_other") : null;
}

/** The error line of a failed turn: the runtime named when the core could not reach it, else the generic one. */
export const errorKeyOf = (v: TurnView): "ask.error_runtime" | "ask.error" => (v.error?.code === "runtime_unavailable" ? "ask.error_runtime" : "ask.error");
