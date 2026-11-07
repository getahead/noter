import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { initialMapping, mappingArgs, mappingError, readRepos, removeRepo, reposOf, resetRepos, saveRepo, watchRepoFocus } from "./mappings";

let bridge: Bridge;
let fake: FakeCore;
beforeEach(async () => {
  resetRepos();
  fake = new FakeCore({ window: "settings" });
  bridge = createBridge("settings", fake);
  await bridge.open();
});
afterEach(() => bridge.close());

describe("cpt-noter-flow-ui-handoff-mapping", () => {
  it("prefills the source key or the existing mapping without inventing a folder", () => {
    expect(initialMapping("VSTOR")).toEqual({ key: "VSTOR", path: "", target: "claude_code" });
    const repo = fake.world.repos.mappings[0]!;
    expect(initialMapping("ignored", repo)).toEqual({ id: repo.id, key: repo.key, path: repo.local_path, target: repo.default_tool });
    expect(mappingArgs({ key: " ", path: "/work", target: "codex" }, false)).toBeNull();
    expect(mappingArgs({ key: "OTHER", path: " ", target: "codex" }, false)).toBeNull();
    expect(mappingArgs({ key: " OTHER ", path: "/ignored", target: "codex" }, true)).toEqual({ key: "OTHER", local_path: null, default_tool: "codex" });
  });

  it("persists add/edit/remove and shares only returned repository lists", async () => {
    await readRepos(bridge);
    const original = reposOf()!.mappings.length;
    const added = await saveRepo(bridge, { key: "OTHER", local_path: "/work/other", default_tool: "codex" });
    expect(added.status).toBe("ok");
    expect(reposOf()!.mappings).toHaveLength(original + 1);
    const repo = reposOf()!.mappings.find((r) => r.key === "OTHER")!;
    await saveRepo(bridge, { id: repo.id, key: "OTHER/ui", local_path: "/work/ui", default_tool: "claude_code" });
    expect(reposOf()!.mappings.find((r) => r.id === repo.id)).toMatchObject({ key: "OTHER/ui", local_path: "/work/ui", default_tool: "claude_code" });
    await removeRepo(bridge, repo.id);
    expect(reposOf()!.mappings).toHaveLength(original);
  });

  it("keeps the list on duplicate, missing-folder and picker-cancel failures", async () => {
    await readRepos(bridge);
    const before = structuredClone(reposOf());
    const duplicate = await saveRepo(bridge, { key: before!.mappings[0]!.key, local_path: "/other", default_tool: "codex" });
    expect(duplicate.status).toBe("error");
    for (const code of ["repo_path_missing", "cancelled"] as const) {
      fake.failNext("repo_upsert", code);
      const result = await saveRepo(bridge, { key: "OTHER", local_path: null, default_tool: "claude_code" });
      expect(result.status).toBe("error");
      expect(reposOf()).toEqual(before);
    }
    expect(mappingError("invalid_input")?.field).toBe("key");
    expect(mappingError("repo_path_missing")?.field).toBe("path");
    expect(mappingError("cancelled")).toBeNull();
    expect(mappingError("internal")?.message).toBeTruthy();
  });

  it("refreshes mappings when this window regains focus after another window changed them", async () => {
    await readRepos(bridge);
    const events = new EventTarget();
    const read = vi.spyOn(bridge.core, "reposList");
    const stop = watchRepoFocus(bridge, events);
    fake.world.repos.mappings = [];
    events.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(reposOf()!.mappings).toHaveLength(0));
    expect(read).toHaveBeenCalledOnce();
    stop();
    events.dispatchEvent(new Event("focus"));
    expect(read).toHaveBeenCalledOnce();
  });
});
