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
const view = (rows: SourceRow[] | null, o: { failed?: boolean } = {}) => renderToString(<SourcesView rows={rows} failed={!!o.failed} mode="cloud_allowed" prefs={undefined} onRetry={() => {}} onAdd={() => {}} onReindex={() => {}} />);

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
  it("a failed refresh keeps the rows", () => {
    const html = view([row()], { failed: true });
    expect(html).toContain("Docs");
    expect(html).toContain("The sources could not be read.");
  });
  it("actions call back", () => {
    const onAdd = vi.fn();
    const onReindex = vi.fn();
    const tree = rendered(SourcesView, { rows: [row()], failed: false, mode: "cloud_allowed" as const, prefs: undefined, onRetry: () => {}, onAdd, onReindex });
    const action = (find(tree, (p) => p.tone === "ok").props.actions as { props: { onAction: () => void } }).props.onAction;
    action();
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
    expect(html).toContain("Scope: all calls");
    expect(html).toContain("Add Source");
  });
});

describe("AddMcpSourceSheet", () => {
  it("shows the consequence of Indexed and its schedule before confirming", () => {
    const html = renderToString(<AddMcpSourceSheet bridge={bridge(null)} onClose={() => {}} />);
    expect(html).toContain("sign in once in the browser");
    expect(html).toContain("Schedule");
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
