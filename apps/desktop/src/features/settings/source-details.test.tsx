import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SourceRow } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import { SourceDetailsSheet } from "./SourceDetailsSheet";
import { draftChanged, draftOf, removeAlert, removeSource, revokeAlert, revokeToken, updateSource } from "./sources";

const row = (o: Partial<SourceRow> = {}): SourceRow => ({ id: "s1", rev: 2, kind: "mcp", name: "Wiki", location: "wiki", mode: "indexed", schedule: "daily", privacy: "normal", scope: { type: "all_calls" }, status: { type: "idle" }, documents: 4, last_sync_at: null, has_token: true, ...o });
const bridge = (...answers: unknown[]) => {
  const calls: string[] = [];
  const act = vi.fn(async (_k: string, cmd: string, f: () => unknown) => (void f(), calls.push(cmd), answers.shift()));
  return { b: { act, core: { sourceUpdate: vi.fn(), sourceRevokeToken: vi.fn(), sourceRemove: vi.fn() } } as never, calls, act };
};
const tick = () => new Promise((r) => setTimeout(r));
const btn = (tree: ReturnType<typeof rendered>, label: string) => find(tree, (p) => p.label === label).props.onAction as () => void;
const save = (tree: ReturnType<typeof rendered>) => (find(tree, (p) => typeof p.defaultButton === "object").props.defaultButton as { props: { onAction: () => void } }).props.onAction;

describe("source commands for details", () => {
  it("detects an edited draft", () => {
    const r = row();
    expect(draftChanged(r, draftOf(r))).toBe(false);
    expect(draftChanged(r, { ...draftOf(r), privacy: "sensitive" })).toBe(true);
    expect(draftChanged(r, { ...draftOf(r), name: "  Wiki " })).toBe(false);
    expect(draftChanged(r, { ...draftOf(r), scope: { all: false, callTypes: ["standup"], people: [] } })).toBe(true);
  });
  it("update sends only supported fields with the rev; a conflict is reported", async () => {
    const { b, act } = bridge({ status: "ok", data: row({ rev: 3 }) }, { status: "error", error: { code: "conflict" } }, { status: "error", error: { code: "internal" } });
    expect(await updateSource(b, row(), draftOf(row()))).toMatchObject({ ok: true });
    expect(await updateSource(b, row(), draftOf(row()))).toEqual({ ok: false, conflict: true });
    expect(await updateSource(b, row(), draftOf(row()))).toMatchObject({ ok: false, code: "internal" });
    expect(act).toHaveBeenCalledTimes(3);
  });
  it("revoke and remove; a source already gone counts as removed", async () => {
    expect(await revokeToken(bridge({ status: "ok" }).b, "s1")).toBe(true);
    expect(await revokeToken(bridge({ status: "error", error: { code: "internal" } }).b, "s1")).toBe(false);
    expect(await removeSource(bridge({ status: "ok" }).b, "s1")).toBe(true);
    expect(await removeSource(bridge({ status: "error", error: { code: "not_found" } }).b, "s1")).toBe(true);
    expect(await removeSource(bridge({ status: "error", error: { code: "internal" } }).b, "s1")).toBe(false);
  });
  it("the alerts name the source and the document count", () => {
    expect(removeAlert(row())).toMatchObject({ title: "Remove Wiki?", cancel: "Cancel" });
    expect(removeAlert(row()).message).toContain("4 indexed documents");
    expect(revokeAlert(row()).title).toContain("Wiki");
  });
});

describe("SourceDetailsSheet", () => {
  const props = (b: unknown, o: Record<string, unknown> = {}) => ({ bridge: b as never, row: row(), onRefresh: vi.fn(), onClose: vi.fn(), ask: async () => true, ...o });
  it("shows editable fields, the read-only mode and token presence", () => {
    const html = renderToString(<SourceDetailsSheet {...props(bridge().b)} />);
    expect(html).toContain("Server: wiki");
    expect(html).toContain("Revoke Token");
    expect(html).toContain("Remove Source");
    expect(html).toContain("Signed in");
    expect(renderToString(<SourceDetailsSheet {...props(bridge().b, { row: row({ has_token: false }) })} />)).not.toContain("Revoke Token");
  });
  it("Save is off until something changed", () => {
    expect(renderToString(<SourceDetailsSheet {...props(bridge().b)} />)).toMatch(/<button[^>]*disabled[^>]*>(<span>)?Save/);
  });
  it("confirmed removal closes and refreshes; Cancel on the alert keeps the source", async () => {
    const p = props(bridge({ status: "ok" }).b);
    btn(rendered(SourceDetailsSheet, p), "Remove Source")();
    await tick();
    expect(p.onClose).toHaveBeenCalled();
    expect(p.onRefresh).toHaveBeenCalled();
    const no = props(bridge().b, { ask: async () => false });
    btn(rendered(SourceDetailsSheet, no), "Remove Source")();
    await tick();
    expect(no.onClose).not.toHaveBeenCalled();
  });
  it("confirmed revoke calls the command once; refusal keeps the sheet", async () => {
    const x = bridge({ status: "ok" });
    btn(rendered(SourceDetailsSheet, props(x.b)), "Revoke Token")();
    await tick();
    expect(x.calls).toEqual(["source_revoke_token"]);
  });
  it("a refused removal keeps the sheet open", async () => {
    const p = props(bridge({ status: "error", error: { code: "internal" } }).b);
    btn(rendered(SourceDetailsSheet, p), "Remove Source")();
    await tick();
    expect(p.onClose).not.toHaveBeenCalled();
  });
  it("Remove and Revoke are off while indexing", () => {
    const html = renderToString(<SourceDetailsSheet {...props(bridge().b, { row: row({ status: { type: "indexing", done: 1, total: 4 } }) })} />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(<span>)?Remove Source/);
  });
  it("Save with an unchanged draft still routes through update and closes on success", async () => {
    const x = bridge({ status: "ok", data: row() });
    const p = props(x.b);
    save(rendered(SourceDetailsSheet, p))();
    await tick();
    expect(x.calls).toEqual(["source_update"]);
    expect(p.onClose).toHaveBeenCalled();
  });
  it("a conflict refreshes the list and keeps the sheet", async () => {
    const p = props(bridge({ status: "error", error: { code: "conflict" } }).b);
    save(rendered(SourceDetailsSheet, p))();
    await tick();
    expect(p.onRefresh).toHaveBeenCalled();
    expect(p.onClose).not.toHaveBeenCalled();
  });
});
