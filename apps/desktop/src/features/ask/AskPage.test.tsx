import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import type { AskAnswer, AskMsg } from "../../core/bindings";
import { Answer, AskPage, AskView } from "./AskPage";
import { foldTurn } from "./model";

const bridge = {
  store: { getState: () => ({ streams: {}, commands: {} }), subscribe: () => () => {} },
  act: () => new Promise(() => {}),
  subscribe: () => new Promise(() => {}),
  unsubscribe: () => Promise.resolve(),
  core: {},
} as unknown as Bridge;

const view = (...events: AskMsg["event"][]) => foldTurn(events.map((event, i) => ({ seq: i + 1, event })));
const done = (o: Partial<AskAnswer>): AskMsg["event"] => ({
  type: "done",
  answer: { turn_id: "t", question: "Q", answer_md: "A", citations: [], found: true, runtime: "claude_api_key", answered_locally: false, sensitive_sources_skipped: 0, keyword_only: false, only_weak_evidence: false, asked_at: 0, ...o } as AskAnswer,
});

describe("AskPage (cpt-noter-flow-ui-ask-question)", () => {
  it("opens on the first-question screen: recent list, heading and composer", () => {
    const h = renderToString(<AskPage bridge={bridge} />);
    for (const r of ["AK-R2", "AK-R3", "AK-R4"]) expect(h).toContain(`data-region="${r}"`);
    expect(h).toContain("Ask anything about your calls and documents");
    expect(h).toContain("Your questions appear here");
  });
});

describe("Answer (cpt-noter-state-ui-ask-turn)", () => {
  it("shows the status while nothing has streamed, then the escaped paragraphs", () => {
    expect(renderToString(<Answer view={view()} />)).toContain("Answering…");
    const h = renderToString(<Answer view={view({ type: "delta", text: "<b>x</b>\n\ny" })} />);
    expect(h).not.toContain("<b>");
    expect(h.match(/ak-ans__p/g)).toHaveLength(2);
  });
  it("names the not-found, stopped, interrupted and error states", () => {
    expect(renderToString(<Answer view={view(done({ found: false }))} />)).toContain("could not find");
    expect(renderToString(<Answer view={view({ type: "failed", error: { code: "answer_stopped", message: "", retryable: false } as never })} />)).toContain("Stopped by you");
    expect(renderToString(<Answer view={view({ type: "ended", reason: "call_stopped" } as never)} />)).toContain("interrupted");
    expect(renderToString(<Answer view={view({ type: "failed", error: { code: "x", message: "", retryable: true } as never })} />)).toContain("Couldn’t get an answer");
  });
});

describe("AskView (cpt-noter-dod-ui-ask-threads)", () => {
  const noop = () => {};
  const props = { rows: [], loadError: false, thread: null, turns: [], asking: null, turn: null, phase: null, draft: "", busy: false, onOpen: noop, onScope: noop, onDraft: noop, onSend: noop, onStop: noop, onRetry: noop };
  const row = { id: "a", title: "What did Ann say?", updated_at: Date.now() } as never;
  it("lists recent questions by day and marks the open one", () => {
    const h = renderToString(<AskView {...props} rows={[row]} thread="a" />);
    expect(h).toContain("Today");
    expect(h).toContain('aria-current="true"');
  });
  it("names a load error and shows stored turns with the follow-up composer", () => {
    expect(renderToString(<AskView {...props} loadError />)).toContain("load your questions");
    const answer = { turn_id: "t", question: "Why?", answer_md: "Because.", citations: [{ n: 1 }], found: true, only_weak_evidence: false } as never;
    const h = renderToString(<AskView {...props} turns={[answer]} />);
    expect(h).toContain("Why?");
    expect(h).toContain("Because.");
    expect(h).toContain("Ask a follow-up");
  });
  it("shows the turn being asked with Stop while streaming and Try Again after a failure", () => {
    const streaming = view({ type: "delta", text: "So far" });
    expect(renderToString(<AskView {...props} asking="Q?" turn={streaming} phase="streaming" busy />)).toContain("Stop");
    const failed = view({ type: "failed", error: { code: "x", message: "", retryable: true } as never });
    expect(renderToString(<AskView {...props} asking="Q?" turn={failed} phase="error" />)).toContain("Try Again");
  });
});
