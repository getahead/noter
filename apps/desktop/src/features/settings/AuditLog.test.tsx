import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AuditEntry } from "../../core/bindings";
import type { AuditView } from "./audit";
import { AuditLogView } from "./AuditLog";

const row = (id: string, callId: string | null = null): AuditEntry => ({ id, kind: "run", llm_run_id: null, at: 1_700_000_000_000, call: callId ? { id: callId, title: "Planning", started_at: 0, call_type: "t" } : null, runtime: null, destination: "Claude", what: "full_transcript", bytes_out: 1800, redacted: true });
const view = (o: Partial<AuditView> = {}): AuditView => ({ rows: [], cursor: null, status: "ready", failed: false, busy: false, exporting: false, exported: null, exportFailed: false, total: null, ...o });
const html = (v: AuditView | null, callId: string | null = null) => renderToString(<AuditLogView v={v} callId={callId} prefs={undefined} onLoad={() => {}} onExport={() => {}} />);

describe("AuditLogView", () => {
  it("shows a loading line, not an empty frame", () => {
    expect(html(null)).toContain("Reading the log");
    expect(html(view({ status: "loading" }))).toContain("Reading the log");
  });
  it("says nothing left only for a complete empty log", () => {
    expect(html(view())).toContain("Nothing has left this Mac.");
    expect(html(view({ cursor: "c" }))).not.toContain("Nothing has left");
    expect(html(view(), "1")).toContain("No requests match this call.");
  });
  it("renders rows, a partial total with Load More, and redaction", () => {
    const out = html(view({ rows: [row("a", "1"), row("b")], cursor: "c" }));
    expect(out).toContain("Transcript text · Planning");
    expect(out).toContain("redacted");
    expect(out).toContain("2 requests so far · 3.6 KB");
    expect(out).toContain("Load More");
  });
  it("a complete log shows the plain total and no Load More", () => {
    const out = html(view({ rows: [row("a")] }));
    expect(out).toContain("1 request · 1.8 KB");
    expect(out).not.toContain("Load More");
  });
  it("a failed read keeps the rows and offers Try Again", () => {
    const out = html(view({ rows: [row("a")], cursor: "c", failed: true }));
    expect(out).toContain("Transcript text");
    expect(out).toContain("The log could not be read.");
    expect(out).toContain("Try Again");
    expect(out).not.toContain("Load More");
  });
  it("shows the core total while pages remain, and the export result and failure", () => {
    expect(html(view({ rows: [row("a", "1")], cursor: "n", total: 41 }), "1")).toContain("1 of 41 entries so far");
    expect(html(view({ rows: [row("a")], exported: "/x.md" }))).toContain("Saved to /x.md");
    expect(html(view({ rows: [row("a")], exportFailed: true }))).toContain("could not be exported");
  });
});
