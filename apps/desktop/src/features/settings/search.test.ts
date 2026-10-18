import { describe, expect, it } from "vitest";

import { PANES, searchPanes } from "./search";

describe("searchPanes", () => {
  it("lists all 11 panes in their fixed order for empty or blank text", () => {
    expect(PANES).toHaveLength(11);
    expect(searchPanes("")).toEqual({ kind: "all", panes: PANES });
    expect(searchPanes("   ")).toEqual({ kind: "all", panes: PANES });
  });

  it("matches the pane name, ignoring case", () => {
    const r = searchPanes("HOTKEYS");
    expect(r.kind).toBe("matches");
    expect(r.panes.map((p) => p.id)).toEqual(["hotkeys"]);
  });

  it("matches keywords as substrings and keeps the pane order", () => {
    // the prototype's keyword lists put "login" in General and Models & Runtimes
    expect(searchPanes("login").panes.map((p) => p.id)).toEqual(["general", "models_and_runtimes"]);
    expect(searchPanes("zoom").panes.map((p) => p.id)).toEqual(["privacy", "call_screen_and_menu_bar"]);
  });

  it("matches a text that spans a name and its keywords, as the prototype joins them", () => {
    expect(searchPanes("transcription archive").panes.map((p) => p.id)).toEqual(["audio_and_transcription"]);
  });

  it("returns the empty state with the typed text when no pane matches", () => {
    expect(searchPanes("  qqqq ")).toEqual({ kind: "none", panes: [], text: "qqqq" });
  });
});
