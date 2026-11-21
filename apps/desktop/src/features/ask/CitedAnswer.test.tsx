import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import type { Citation } from "../../core/bindings";
import { PersonChip } from "../../ui/primitives/person-chip";
import { CitationRow, CitedAnswer } from "./CitedAnswer";

const bridge = { act: () => new Promise(() => {}), core: {} } as unknown as Bridge;
const call = (n: number, o: Partial<Citation> = {}): Citation => ({ n, provenance: { type: "past_call", call: { id: "c", title: "Backend sync", started_at: 0, call_type: "x" }, span: { call_id: "c", t0_ms: 5000, t1_ms: 9000 } } as never, quote: "We ship Friday.", speaker: null, strength: "strong", deleted: false, ...o });
const html = (text: string, citations: Citation[], live = false) => renderToString(<CitedAnswer bridge={bridge} text={text} citations={citations} live={live} onAskAgain={() => {}} />);

describe("CitedAnswer (cpt-noter-dod-ui-ask-citations)", () => {
  it("uses the citation's stored language on its quote, leaving unknown language absent", () => {
    expect(html("x [1]", [call(1, { lang: "ru" } as Partial<Citation>)])).toContain('lang="ru"');
    expect(html("x [1]", [call(1)])).not.toContain("lang=");
  });
  it("binds [n] to its citation and lists the sources with quote, call and Copy", () => {
    const h = html("Ship **Friday** [1].", [call(1)]);
    expect(h).toContain("<strong>Friday</strong>");
    expect(h).toContain('aria-label="Citation 1"');
    expect(h).toContain("Backend sync");
    expect(h).toContain("We ship Friday.");
    expect(h).toContain("Copy with Citations");
  });
  it("lets a live call citation be opened and played, but not a deleted one", () => {
    const live = html("x [1]", [call(1)]);
    expect(live).toContain(">Backend sync</a>");
    expect(live).toContain('aria-label="Play 00:00:05"');
    const gone = html("x [1]", [call(1, { deleted: true })]);
    expect(gone).not.toContain("</a>");
    expect(gone).toMatch(/disabled=""[^>]*aria-label="Play 00:00:05"|aria-label="Play 00:00:05"[^>]*disabled=""/);
  });
  it("offers Ask Again only when a cited source was deleted", () => {
    expect(html("x [1]", [call(1, { deleted: true })])).toContain("Ask Again");
    expect(html("x [1]", [call(1)])).not.toContain("Ask Again");
  });
  it("drops a reference the core never cited and keeps model markup as text", () => {
    const h = html("<b>x</b> [7]", [call(1)]);
    expect(h).not.toContain('aria-label="Citation 7"');
    expect(h).toContain("&lt;b&gt;");
  });
  it("disables references and hides sources and Copy while streaming", () => {
    const h = html("Now [1]", [call(1)], true);
    expect(h).toContain("disabled");
    expect(h).not.toContain("Copy with Citations");
    expect(h).toContain('aria-busy="true"');
  });
  it("names weak, deleted and document sources, lists and code", () => {
    const doc = call(2, { provenance: { type: "document", title: "Plan", source_name: "Drive", section: null } as never, strength: "weak", deleted: true });
    const h = html("- a `c`\n\n1. b *i* [2]", [doc]);
    expect(h).toContain("<ul");
    expect(h).toContain("<ol");
    expect(h).toContain("<code>c</code>");
    expect(h).toContain("Plan · Drive");
    expect(h).toContain("Weak match");
    expect(h).toContain("Source deleted");
  });
  it("links a live document source so it opens through open_external; a deleted one stays plain text", () => {
    const live = call(1, { provenance: { type: "document", document_id: "d", chunk_id: "k", title: "Plan", source_name: "Drive", section: null } as never });
    expect(html("See [1]", [live])).toContain('<a href="#open" class="np-link ak-cite__src">Plan · Drive</a>');
    // CitationRow has no hooks: call it, find the link in the element tree and click it
    const openExternal = vi.fn(async () => ({ status: "ok" }));
    const bridge = { core: { openExternal }, act: (_k: string, _c: string, f: () => unknown) => f() } as never;
    const find = (n: unknown): { onClick?: (e: unknown) => void } | null => {
      const e = n as { type?: unknown; props?: { children?: unknown; onClick?: (e: unknown) => void } } | null;
      if (!e || typeof e !== "object") return null;
      if (e.type === "a") return e.props as never;
      return [e.props?.children].flat(9).map(find).find(Boolean) ?? null;
    };
    const link = find(CitationRow({ bridge, c: live, focused: false, register: () => {}, back: () => {} }));
    link?.onClick?.({ preventDefault: () => {} });
    expect(openExternal).toHaveBeenCalledWith({ target: { type: "document", document_id: "d", chunk_id: "k" } });
  });
  it("shows the speaker of a citation as a person chip that opens their page, and none when the core names nobody", () => {
    const speaker = { id: "p_1", display_name: "Dmitri Sokolov", short_name: "Dmitri S.", initials: "DS", is_you: false };
    const named = call(1, { speaker } as never);
    const h = html("See [1]", [named]);
    expect(h).toContain('data-component="cpt-noter-component-ui-person-chip"');
    expect(h).toContain("Dmitri S.");
    expect(html("See [1]", [call(1, { speaker: null } as never)])).not.toContain("cpt-noter-component-ui-person-chip");
    const find = (n: unknown): { onAction?: (a: unknown) => void } | null => {
      const e = n as { type?: unknown; props?: { children?: unknown; onAction?: (a: unknown) => void } } | null;
      if (!e || typeof e !== "object") return null;
      if (e.props?.onAction && e.type === PersonChip) return e.props as never;
      return [e.props?.children].flat(9).map(find).find(Boolean) ?? null;
    };
    const chip = find(CitationRow({ bridge: {} as never, c: named, focused: false, register: () => {}, back: () => {} }));
    expect(chip).not.toBeNull();
    expect(() => chip?.onAction?.(null)).not.toThrow();
  });
});
