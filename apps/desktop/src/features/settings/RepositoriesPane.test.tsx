import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { DialogsProvider } from "../../ui/dialogs/host";
import { createSheets } from "../../ui/dialogs/sheets";
import { find } from "../../ui/testing";
import { readRepos, resetRepos } from "../handoff/mappings";
import { RepositoriesPane } from "./RepositoriesPane";

let bridge: Bridge;
let fake: FakeCore;
beforeEach(async () => {
  resetRepos();
  fake = new FakeCore({ window: "settings" });
  bridge = createBridge("settings", fake);
  await bridge.open();
});
afterEach(() => bridge.close());
const draw = () => renderToString(<DialogsProvider><RepositoriesPane bridge={bridge} /></DialogsProvider>);
function tree() {
  const sheets = createSheets();
  sheets.register("add-mapping", () => null);
  let content: ReactNode;
  const Probe = () => { content = RepositoriesPane({ bridge }); return null; };
  renderToString(<DialogsProvider sheets={sheets}><Probe /></DialogsProvider>);
  return { content, sheets };
}

describe("Repositories pane", () => {
  it("renders returned mappings and a missing-folder warning, and an empty state when none exist", async () => {
    fake.world.repos.mappings[0]!.path_exists = false;
    await readRepos(bridge);
    expect(draw()).toContain("Folder missing");
    expect(draw()).toContain("VSTOR");
    fake.world.repos.mappings = [];
    await readRepos(bridge);
    expect(draw()).toContain("Map a Jira project or component to a folder");
  });

  it("offers a retry when the repository read fails", async () => {
    fake.failNext("repos_list", "internal");
    await readRepos(bridge);
    expect(draw()).toContain("Couldn't read repository mappings");
    const { content } = tree();
    await (find(content, (p) => p.label === "Try Again").props.onAction as () => Promise<void>)();
  });

  it("opens new and existing mappings through the shared sheet host", async () => {
    await readRepos(bridge);
    const { content, sheets } = tree();
    (find(content, (p) => p.label === "Add Mapping…").props.onAction as () => void)();
    expect(sheets.current()?.id).toBe("add-mapping");
    expect(sheets.current()?.props.mapping).toBeUndefined();
    const row = find(content, (p) => typeof p.onDoubleClick === "function");
    (row.props.onClick as () => void)();
    (row.props.onFocus as () => void)();
    (row.props.onDoubleClick as () => void)();
    expect(sheets.current()?.props.mapping).toMatchObject({ key: "VSTOR" });
  });

  it("persists a row's default tool and surfaces a refused change without replacing the list", async () => {
    await readRepos(bridge);
    const { content } = tree();
    const control = find(content, (p) => p.label === "Default tool" && typeof p.onAction === "function");
    const upsert = vi.spyOn(bridge.core, "repoUpsert");
    (control.props.onAction as (v: string) => void)("codex");
    await vi.waitFor(() => expect(fake.world.repos.mappings[0]!.default_tool).toBe("codex"));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: fake.world.repos.mappings[0]!.id, default_tool: "codex" }));
    fake.failNext("repo_upsert", "repo_path_missing");
    (control.props.onAction as (v: string) => void)("claude_code");
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(2));
    expect(fake.world.repos.mappings[0]!.default_tool).toBe("codex");
  });
});
