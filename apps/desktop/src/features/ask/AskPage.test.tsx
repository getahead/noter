import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import type { AskAnswer, AskMsg } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import { Answer, AskPage, AskView } from "./AskPage";
import { foldTurn } from "./model";

const bridge = {
  store: { getState: () => ({ streams: {}, commands: {}, entities: {}, whole: {} }), subscribe: () => () => {} },
  act: () => new Promise(() => {}),
  subscribe: () => new Promise(() => {}),
  unsubscribe: () => Promise.resolve(),
  core: {},
} as unknown as Bridge;

const view = (...events: AskMsg["event"][]) => foldTurn(events.map((event, i) => ({ seq: i + 1, event })));
const done = (o: Partial<AskAnswer>): AskMsg["event"] => ({
  type: "done",
  answer: { turn_id: "t", question: "Q", answer_md: "A", citations: [], found: true, runtime: "claude_api_key", answered_locally: false, sensitive_sources_skipped: 0, keyword_only: false, only_weak_evidence: false, stopped: false, asked_at: 0, ...o } as AskAnswer,
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
    expect(renderToString(<Answer bridge={bridge} view={view()} />)).toContain("Searching calls and documents…");
    const h = renderToString(<Answer bridge={bridge} view={view({ type: "delta", text: "<b>x</b>\n\ny" })} />);
    expect(h).not.toContain("<b>");
    expect(h.match(/ak-ans__p/g)).toHaveLength(2);
    expect(h).not.toContain("Searching calls and documents…");
    expect(h).not.toContain("Reading calls and documents…");
  });
  it("shows Reading after retrieval selects the runtime, until answer text arrives", () => {
    const started = { type: "started", runtime: "claude_account", mode: "local_only" } as const;
    const h = renderToString(<Answer bridge={bridge} view={view(started)} />);
    expect(h).toContain("Reading calls and documents…");
    expect(h).not.toContain("Searching calls and documents…");
    expect(renderToString(<Answer bridge={bridge} view={view(started, { type: "delta", text: "An answer" })} />)).not.toContain("Reading calls and documents…");
  });
  it("shows a stored stopped turn's partial text with Stopped by you", () => {
    const h = renderToString(<Answer bridge={bridge} view={view(done({ stopped: true, found: false, answer_md: "Partial text" }))} />);
    expect(h).toContain("Partial text");
    expect(h).toContain("Stopped by you");
    expect(h).not.toContain("could not find");
  });
  it("offers Search by Keyword on a not-found answer", () => {
    const h = renderToString(<Answer bridge={bridge} onSearch={() => {}} view={view(done({ found: false, stopped: false }))} />);
    expect(h).toContain("Search by Keyword");
    expect(h).toContain("could not find");
  });
  it("offers Widen Scope on a not-found answer when asked, and names the runtime and mode of a started turn", () => {
    expect(renderToString(<Answer bridge={bridge} onWiden={() => {}} view={view(done({ found: false, stopped: false }))} />)).toContain("Widen Scope");
    expect(renderToString(<Answer bridge={bridge} view={view(done({ found: false }))} />)).not.toContain("Widen Scope");
    const h = renderToString(<Answer bridge={bridge} view={view({ type: "started", runtime: "claude_account", mode: "local_only" } as never)} />);
    expect(h).toContain("Local only");
  });
  it("names the not-found, stopped, interrupted and error states", () => {
    expect(renderToString(<Answer bridge={bridge} view={view(done({ found: false }))} />)).toContain("could not find");
    expect(renderToString(<Answer bridge={bridge} view={view({ type: "failed", error: { code: "answer_stopped", message: "", retryable: false } as never })} />)).toContain("Stopped by you");
    expect(renderToString(<Answer bridge={bridge} view={view({ type: "ended", reason: "call_stopped" } as never)} />)).toContain("interrupted");
    expect(renderToString(<Answer bridge={bridge} view={view({ type: "failed", error: { code: "x", message: "", retryable: true } as never })} />)).toContain("Couldn’t get an answer");
    expect(renderToString(<Answer bridge={bridge} view={view({ type: "failed", error: { code: "runtime_unavailable", message: "", retryable: true } as never })} />)).toContain("Couldn&#x27;t reach Claude Code");
  });
});

describe("AskView (cpt-noter-dod-ui-ask-threads)", () => {
  const noop = () => {};
  const props = { bridge, rows: [], loadError: false, thread: null, turns: [], asking: null, turn: null, phase: null, draft: "", busy: false, onOpen: noop, onCopyQuestion: noop, onDelete: noop, onScope: noop, onDraft: noop, onSend: noop, announce: "", suggestions: [], onSuggest: noop, onStop: noop, onRetry: noop, onPlay: noop, bar: null };
  const row = { id: "a", title: "What did Ann say?", updated_at: Date.now() } as never;
  it("offers Widen Scope on the last stored turn when it was not found under a narrowed scope", () => {
    const miss = (id: string, found: boolean) => ({ turn_id: id, question: `Q${id}`, answer_md: "", citations: [], found, runtime: "claude_api_key", answered_locally: false, sensitive_sources_skipped: 0, keyword_only: false, only_weak_evidence: false, stopped: false, asked_at: 0 }) as never;
    const turns = [miss("1", false), miss("2", false)];
    const html = (narrowed: boolean) => renderToString(<AskView {...props} thread="a" turns={turns} narrowed={narrowed} onWiden={noop} />);
    expect(html(true).split("Widen Scope").length - 1).toBe(1); // the last turn only
    expect(html(false)).not.toContain("Widen Scope");
  });
  it("keeps Widen Scope off the previous turn while a follow-up is answering", () => {
    const miss = { turn_id: "1", question: "Q1", answer_md: "", citations: [], found: false, runtime: "claude_api_key", answered_locally: false, sensitive_sources_skipped: 0, keyword_only: false, only_weak_evidence: false, stopped: false, asked_at: 0 } as never;
    expect(renderToString(<AskView {...props} thread="a" turns={[miss]} asking="Q2" narrowed onWiden={noop} />)).not.toContain("Widen Scope");
  });
  it("names the composer and each recent row, so focus can be handed to them", () => {
    const h = renderToString(<AskView {...props} rows={[row]} />);
    expect(h).toContain('id="ak-composer"');
    expect(h).toContain('id="ak-row-a"');
  });
  it("lists recent questions by day and marks the open one", () => {
    const h = renderToString(<AskView {...props} rows={[row]} thread="a" />);
    expect(h).toContain("Today");
    expect(h).toContain('aria-current="true"');
  });
  it("names a load error and shows stored turns with the follow-up composer", () => {
    expect(renderToString(<AskView {...props} loadError />)).toContain("load your questions");
    const answer = { turn_id: "t", question: "Why?", answer_md: "Because.", citations: [{ n: 1, provenance: { type: "model_guess" }, quote: "", strength: "strong", deleted: false }], found: true, only_weak_evidence: false } as never;
    const h = renderToString(<AskView {...props} turns={[answer]} />);
    expect(h).toContain("Why?");
    expect(h).toContain("Because.");
    expect(h).toContain("Ask a follow-up");
  });
  it("shows the turn being asked with Stop while streaming and Try Again after a failure", () => {
    expect(renderToString(<AskView {...props} asking="Q?" phase={null} busy />)).toContain("Searching calls and documents…");
    const streaming = view({ type: "delta", text: "So far" });
    expect(renderToString(<AskView {...props} asking="Q?" turn={streaming} phase="streaming" busy />)).toContain("Stop");
    const failed = view({ type: "failed", error: { code: "x", message: "", retryable: true } as never });
    expect(renderToString(<AskView {...props} asking="Q?" turn={failed} phase="error" />)).toContain("Try Again");
  });
  it("offers the suggested questions on the first screen only", () => {
    const h = renderToString(<AskView {...props} suggestions={["What did Ann commit to?"]} />);
    expect(h).toContain("What did Ann commit to?");
    const answered = { turn_id: "t", question: "Q", answer_md: "A", citations: [], found: false } as never;
    expect(renderToString(<AskView {...props} turns={[answered]} suggestions={["What did Ann commit to?"]} />)).not.toContain("What did Ann commit to?");
  });
  it("carries the announcement in a polite status region", () => {
    expect(renderToString(<AskView {...props} announce="Answer ready, 2 citations" />)).toContain("Answer ready, 2 citations");
  });
});

describe("AskPage wiring (cpt-noter-flow-ui-ask-question)", () => {
  it("hands the view working handlers: copy, delete, play, suggest, retry, search and Ask Again", async () => {
    const act = vi.fn(async (_k: string, _c: string, f: () => unknown) => f());
    const core = { askThreadDelete: vi.fn(async () => ({ status: "ok", data: {} })), audioPlay: vi.fn(async () => ({ status: "ok", data: {} })), askThreadsList: vi.fn(async () => ({ status: "ok", data: { threads: [] } })), askThreadGet: vi.fn(async () => ({ status: "ok", data: { turns: [] } })), askScopePresets: vi.fn(async () => ({ status: "ok", data: { presets: [] } })) };
    const subscribe = vi.fn();
    const b = { ...(bridge as object), act, core, subscribe, unsubscribe: vi.fn() } as unknown as Bridge;
    const write = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText: write } });
    const tree = rendered(AskPage, { bridge: b });
    const p = find(tree, (_p, type) => type === AskView).props as unknown as import("./AskPage").AskViewProps;
    p.onCopyQuestion("Q?");
    expect(write).toHaveBeenCalledWith("Q?");
    p.onDelete("a");
    await Promise.resolve();
    p.onPlay({ call_id: "c", t0_ms: 1, t1_ms: 2 } as never);
    p.onSuggest("What did Ann commit to?");
    expect(subscribe).toHaveBeenCalledWith("ask_start", expect.objectContaining({ question: "What did Ann commit to?" }));
    p.onSend();
    p.onRetry();
    p.onStop();
    p.onOpen("a");
    expect(p.suggestions).toEqual([]);
    vi.unstubAllGlobals();
  });
  it("offers Search by Keyword, Ask Again and the local-model action through the answers it draws", () => {
    const answer = { turn_id: "t", question: "Why?", answer_md: "", citations: [], found: false, stopped: false } as never;
    const props = { bridge, rows: [], loadError: false, thread: "a", turns: [answer], asking: "Q", turn: null, phase: null, draft: "", busy: false, onOpen() {}, onCopyQuestion() {}, onDelete() {}, onDraft() {}, onSend() {}, announce: "", suggestions: [], onSuggest() {}, onStop() {}, onRetry() {}, onPlay() {}, bar: null };
    const tree = rendered(AskView, props);
    const answers = find(tree, (p) => typeof p.onSearch === "function").props as { onSearch: () => void; onAskAgain: () => void };
    expect(() => answers.onSearch()).not.toThrow();
    expect(() => answers.onAskAgain()).not.toThrow();
  });
});

describe("Answer flags (cpt-noter-algo-ui-ask-stream)", () => {
  const cited = { n: 1, provenance: { type: "model_guess" }, quote: "q", speaker: null, strength: "weak", deleted: false } as const;
  it("keeps the local-runtime and skipped-source facts on stored and not-found turns", () => {
    const local = renderToString(<Answer bridge={bridge} view={view(done({ answered_locally: true, runtime: "local", citations: [cited] }))} />);
    expect(local).toContain("Answered by the local model");
    for (const count of [1, 2]) {
      const h = renderToString(<Answer bridge={bridge} view={view(done({ found: false, sensitive_sources_skipped: count }))} />);
      expect(h).toContain(`${count} sensitive ${count === 1 ? "source was" : "sources were"} not searched because this answer uses a cloud model`);
      expect(h).toContain("I could not find this in your calls.");
    }
  });
  it("opens runtime settings explicitly when a sensitive answer offers the local alternative", () => {
    const navigate = vi.fn(() => Promise.resolve({ status: "ok", data: {} }));
    const act = vi.fn((_key: string, _command: string, run: () => unknown) => run());
    const own = { ...bridge, act, core: { windowNavigate: navigate } } as unknown as Bridge;
    const banner = find(rendered(Answer, { bridge: own, view: view(done({ found: false, sensitive_sources_skipped: 1 })) }), (p) => (p.banner as { id?: string } | undefined)?.id === "ask-sensitive");
    const actions = (banner.props.banner as { actions: { onAction: () => void }[] }).actions;
    actions[0].onAction();
    expect(navigate).toHaveBeenCalledWith({ target: { type: "settings", pane: "models_and_runtimes" } });
    expect(act).toHaveBeenCalledOnce();
  });
  it("warns about weak evidence and keyword-only retrieval without inventing rebuild progress", () => {
    const h = renderToString(<Answer bridge={bridge} onSearch={() => {}} onWiden={() => {}} view={view(done({ citations: [cited], only_weak_evidence: true, keyword_only: true }))} />);
    expect(h).toContain("Based on weak matches. Check the citations before you rely on this answer.");
    expect(h).toContain("Searching by keyword only while the index rebuilds");
    expect(h).toContain("Search by Keyword");
    expect(h).toContain("Widen Scope");
    expect(h).not.toContain("64 %");
    const plain = renderToString(<Answer bridge={bridge} view={view(done({ citations: [cited] }))} />);
    expect(plain).not.toContain("Based on weak matches");
    expect(plain).not.toContain("index rebuilds");
    expect(plain).not.toContain("Answered by the local model");
  });
});
