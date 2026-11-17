import { describe, expect, it } from "vitest";

import { askState, offerPreset, setPresets } from "./ask-state";

describe("scope presets", () => {
  it("offers a transient preset once and keeps it when the core's list reloads", () => {
    const topic = { id: "topic:t9", label: "Topic: Old thing", scope: { preset: "topic:t9", topic_id: "t9" } };
    setPresets([{ id: "all", label: "All", scope: {} }]);
    offerPreset(topic);
    offerPreset(topic);
    expect(askState().presets.map((p) => p.id)).toEqual(["all", "topic:t9"]);
    setPresets([{ id: "all", label: "All", scope: {} }]);
    expect(askState().presets.map((p) => p.id)).toEqual(["all", "topic:t9"]);
    setPresets([{ id: "all", label: "All", scope: {} }, topic]); // the core now carries it: no duplicate
    expect(askState().presets.filter((p) => p.id === "topic:t9")).toHaveLength(1);
  });
});
