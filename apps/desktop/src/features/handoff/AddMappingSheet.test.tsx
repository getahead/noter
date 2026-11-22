import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { AddMappingSheet } from "./AddMappingSheet";
import { resetRepos } from "./mappings";

const primary = (tree: ReturnType<typeof rendered>) => (find(tree, (p) => !!p.defaultButton).props.defaultButton as { props: Record<string, unknown> }).props;
let bridge: Bridge;
let fake: FakeCore;
beforeEach(async () => {
  resetRepos();
  fake = new FakeCore({ window: "main" });
  bridge = createBridge("main", fake);
  await bridge.open();
});
afterEach(() => bridge.close());

describe("Add Mapping sheet", () => {
  it("prefills the handoff project, keeps the folder blank, and names every control", () => {
    const html = renderToString(<AddMappingSheet bridge={bridge} sourceKey="OTHER" fromHandoff close={() => {}} />);
    for (const text of ["From the Handoff drawer", "Jira project or component", 'value="OTHER"', "Folder", "Choose…", "Default tool", "Claude Code", "Codex", "Cancel", "Add Mapping"]) expect(html).toContain(text);
    const tree = rendered(AddMappingSheet, { bridge, sourceKey: "OTHER", close() {} });
    expect(primary(tree).disabled).toBe(true);
  });

  it("Cancel closes the sheet, then hands focus back to the opener", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => cb());
    const close = vi.fn();
    const returnFocus = vi.fn();
    const tree = rendered(AddMappingSheet, { bridge, sourceKey: "OTHER", close, returnFocus });
    (find(tree, (p) => typeof p.onCancel === "function").props.onCancel as () => void)();
    vi.unstubAllGlobals();
    expect(close).toHaveBeenCalledOnce();
    expect(returnFocus).toHaveBeenCalledOnce();
  });

  // #1066: Choose… asks the core for a folder only; nothing is saved and the sheet stays for Add Mapping or Cancel
  it("Choose asks the core for a folder without saving or closing, and a closed panel keeps the draft", async () => {
    const close = vi.fn();
    const pick = vi.spyOn(bridge.core, "repoFolderPick");
    const upsert = vi.spyOn(bridge.core, "repoUpsert");
    const tree = rendered(AddMappingSheet, { bridge, sourceKey: "OTHER", close });
    fake.failNext("repo_folder_pick", "cancelled");
    await (find(tree, (p) => p.label === "Choose…").props.onAction as () => Promise<void>)();
    await (find(tree, (p) => p.label === "Choose…").props.onAction as () => Promise<void>)();
    expect(pick).toHaveBeenCalledTimes(2);
    expect(pick).toHaveBeenCalledWith({ key: "OTHER" });
    expect(upsert).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("editing sends the mapping id and retains the sheet on failure", async () => {
    const close = vi.fn();
    const mapping = fake.world.repos.mappings[0]!;
    const upsert = vi.spyOn(bridge.core, "repoUpsert");
    const tree = rendered(AddMappingSheet, { bridge, mapping, close });
    fake.failNext("repo_upsert", "repo_path_missing");
    await (primary(tree).onAction as () => Promise<void>)();
    expect(upsert).toHaveBeenCalledWith({ id: mapping.id, key: mapping.key, local_path: mapping.local_path, default_tool: mapping.default_tool });
    expect(close).not.toHaveBeenCalled();
    await (primary(tree).onAction as () => Promise<void>)();
    expect(close).toHaveBeenCalledOnce();
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
