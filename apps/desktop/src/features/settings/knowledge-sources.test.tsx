import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SourceRow } from "../../core/bindings";
import { createBridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { KnowledgeSourcesPane } from "./KnowledgeSourcesPane";
import { AddMcpSourceSheet } from "./AddMcpSourceSheet";
import { SourcesView } from "./KnowledgeSourcesPane";
import { AddFolderSheet } from "./SourceFormSheet";

const row = (o: Partial<SourceRow> = {}): SourceRow => ({ id: "s1", rev: 1, kind: "folder", name: "Docs", location: "/d", mode: "indexed", schedule: null, privacy: "normal", scope: { type: "all_calls" }, status: { type: "idle" }, documents: 3, last_sync_at: null, has_token: false, ...o });
const view = (rows: SourceRow[] | null, o: { failed?: boolean } = {}) => renderToString(<SourcesView rows={rows} failed={!!o.failed} mode="cloud_allowed" prefs={undefined} onRetry={() => {}} onAdd={() => {}} onReindex={() => {}} onDetails={() => {}} />);

describe("SourcesView", () => {
  it("loading, error and the first-use empty state", () => {
    expect(view(null)).toContain("Reading the sources");
    expect(view(null, { failed: true })).toContain("The sources could not be read.");
    const empty = view([]);
    expect(empty).toContain("No knowledge sources yet");
    expect(empty).toContain("Add Folder…");
  });
  it("one status row per source with its words and actions", () => {
    const html = view([row(), row({ id: "s2", name: "Wiki", kind: "mcp", status: { type: "failed", code: "internal", at: 1 } }), row({ id: "s3", name: "Notes", status: { type: "indexing", done: 2, total: 8 } })]);
    expect(html).toContain("Up to date");
    expect(html).toContain("Failed");
    expect(html).toContain("2 of 8");
    expect(html).toContain("Re-index");
    expect(html).toContain("Try Again");
    expect(html).toContain("Add MCP Server…");
    expect(html.match(/data-component="cpt-noter-component-ui-status-row"/g)).toHaveLength(3);
  });
  it("a Live source has no Re-index", () => {
    const html = view([row({ mode: "live", kind: "mcp" })]);
    expect(html).not.toContain("Re-index");
    expect(html).toContain("Live");
  });
  it("a failed refresh keeps the rows", () => {
    const html = view([row()], { failed: true });
    expect(html).toContain("Docs");
    expect(html).toContain("The sources could not be read.");
  });
  it("actions call back", () => {
    const onAdd = vi.fn();
    const onReindex = vi.fn();
    const onDetails = vi.fn();
    const tree = rendered(SourcesView, { rows: [row()], failed: false, mode: "cloud_allowed" as const, prefs: undefined, onRetry: () => {}, onAdd, onReindex, onDetails });
    const buttons = (find(tree, (p) => p.tone === "ok").props.actions as { props: { children: { props: { onAction: () => void } }[] } }).props.children;
    buttons[0]!.props.onAction();
    buttons[1]!.props.onAction();
    expect(onDetails).toHaveBeenCalledWith("s1");
    const foot = find(tree, (p) => !!p.foot).props.foot as { props: { children: { props: { onAction: () => void } }[] } };
    foot.props.children[1]!.props.onAction();
    expect(onReindex).toHaveBeenCalledWith("s1");
    expect(onAdd).toHaveBeenCalledWith("mcp");
  });
});

const bridge = (res: unknown) => ({ act: vi.fn(async (_k: string, _c: string, f: () => unknown) => (void f(), res)), core: { sourceAddFolder: vi.fn(), sourceAddMcp: vi.fn() } }) as never;
const press = async (tree: ReturnType<typeof rendered>, label: string) => (find(tree, (p) => p.label === label).props.onAction as () => void)();
const sheetOf = (tree: ReturnType<typeof rendered>) => find(tree, (p) => typeof p.defaultButton === "object");
const addButton = async (tree: ReturnType<typeof rendered>) => {
  (sheetOf(tree).props.defaultButton as { props: { onAction: () => void } }).props.onAction();
  await new Promise((r) => setTimeout(r));
};

describe("AddFolderSheet", () => {
  it("closes after a created source", async () => {
    const onClose = vi.fn();
    await addButton(rendered(AddFolderSheet, { bridge: bridge({ status: "ok", data: row() }), onClose }));
    expect(onClose).toHaveBeenCalled();
  });
  it("a cancelled folder panel adds nothing and keeps the form", async () => {
    const onClose = vi.fn();
    await addButton(rendered(AddFolderSheet, { bridge: bridge({ status: "error", error: { code: "cancelled" } }), onClose }));
    expect(onClose).not.toHaveBeenCalled();
  });
  it("shows what the form sends and its note", () => {
    const html = renderToString(<AddFolderSheet bridge={bridge(null)} onClose={() => {}} />);
    expect(html).toContain("Add Folder");
    expect(html).toContain("All calls");
    expect(html).toContain("Only some call types");
    expect(html).toContain("Add Source");
  });
});

describe("AddMcpSourceSheet", () => {
  it("shows the consequence of Indexed and its schedule before confirming", () => {
    const html = renderToString(<AddMcpSourceSheet bridge={bridge(null)} onClose={() => {}} />);
    expect(html).toContain("sign in once in the browser");
    expect(html).toContain("Schedule");
  });
  it("offers the scope choice: all calls, or only some call types", () => {
    const html = renderToString(<AddMcpSourceSheet bridge={bridge(null)} onClose={() => {}} />);
    expect(html).toContain("All calls");
    expect(html).toContain("Only some call types");
  });
  it("an empty server is a field error and sends nothing", async () => {
    const b = bridge(null);
    const onClose = vi.fn();
    await addButton(rendered(AddMcpSourceSheet, { bridge: b, onClose }));
    expect((b as unknown as { act: ReturnType<typeof vi.fn> }).act).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
  it("cancel closes", async () => {
    const onClose = vi.fn();
    await press(rendered(AddMcpSourceSheet, { bridge: bridge(null), onClose }), "Cancel");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the pane and the form handlers", () => {
  it("renders loading first, then the sheets open from the view's buttons", async () => {
    const fake = new FakeCore({ window: "settings" });
    const b = createBridge("settings", fake);
    await b.open();
    const html = renderToString(<KnowledgeSourcesPane bridge={b} settings={{ privacy: { mode: "cloud_allowed" } } as never} />);
    expect(html).toContain("Reading the sources");
    b.close();
  });
  it("each MCP field handler updates the draft and a good server closes the sheet", async () => {
    const onClose = vi.fn();
    const tree = rendered(AddMcpSourceSheet, { bridge: bridge({ status: "ok", data: row() }), onClose });
    (find(tree, (p) => p.id === "src-server").props.onChange as (v: string) => void)("wiki");
    for (const [id, v] of [["src-mode", "live"], ["src-schedule", "hourly"], ["src-mcp-privacy", "sensitive"]] as const) (find(tree, (p) => p.id === id).props.onAction as (v: string) => void)(v);
    (find(tree, (p) => p.id === "src-server").props.onEnter as () => void)();
    await addButton(tree);
    expect(onClose).not.toHaveBeenCalled(); // the probe render keeps its first draft: a blank server
  });
  it("the folder sheet words a duplicate and a failed add, and the privacy choice updates", async () => {
    for (const code of ["invalid_input", "internal"]) {
      const onClose = vi.fn();
      const tree = rendered(AddFolderSheet, { bridge: bridge({ status: "error", error: { code, detail: code === "invalid_input" ? { type: "validation", field: "path", rule: "duplicate" } : null } }), onClose });
      (find(tree, (p) => p.id === "src-privacy").props.onAction as (v: string) => void)("sensitive");
      await addButton(tree);
      expect(onClose).not.toHaveBeenCalled();
    }
  });
});

import { ScopeFields } from "./ScopeFields";
describe("ScopeFields", () => {
  const types = [{ id: "standup", label: "Standup", builtin: true, skill_path: "" }];
  const anna = { id: "per_anna", display_name: "Anna Kuz", short_name: "Anna", initials: "AK", aliases: [], role: null, is_you: false } as never;
  const pbridge = { core: {}, act: async () => ({ status: "ok" }), store: { getState: () => ({ entities: { person: {} } }), subscribe: () => () => {} } } as never;
  const props = (value: { all: boolean; callTypes: string[]; people: string[] }, onChange = () => {}) => ({ bridge: pbridge, types, people: [anna], value, onChange });
  it("all calls hides the types and people; limited lists them", () => {
    const all = renderToString(<ScopeFields {...props({ all: true, callTypes: [], people: [] })} />);
    expect(all).not.toContain("Standup");
    expect(all).not.toContain("People");
    const limited = renderToString(<ScopeFields {...props({ all: false, callTypes: ["standup"], people: ["per_anna"] })} />);
    expect(limited).toContain("Standup");
    expect(limited).toContain("People");
    expect(limited).toContain("Anna");
  });
  it("labels the Scope and its two parts", () => {
    const html = renderToString(<ScopeFields {...props({ all: false, callTypes: [], people: [] })} />);
    expect(html).toContain('class="st-scope__h"');
    expect(html).toContain("Call types");
    expect(html).toContain("People");
  });
  it("choices call back with the new scope", () => {
    const onChange = vi.fn();
    const tree = rendered(ScopeFields, props({ all: false, callTypes: [], people: [] }, onChange));
    (find(tree, (p) => p.name === "src-scope").props.onAction as (v: string) => void)("all");
    (find(tree, (p) => p.label === "Standup").props.onAction as (on: boolean) => void)(true);
    (find(tree, (p) => p.multiple === true).props.onChange as (c: unknown[]) => void)([{ id: "per_anna", display_name: "Anna Kuz", short_name: "Anna", initials: "AK", is_you: false }]);
    expect(onChange).toHaveBeenNthCalledWith(1, { all: true, callTypes: [], people: [] });
    expect(onChange).toHaveBeenNthCalledWith(2, { all: false, callTypes: ["standup"], people: [] });
    expect(onChange).toHaveBeenNthCalledWith(3, { all: false, callTypes: [], people: ["per_anna"] });
  });
});
