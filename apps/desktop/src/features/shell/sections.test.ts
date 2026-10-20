import { describe, expect, it } from "vitest";

import { GROUPS, SECTIONS, navRoute, searchRoute, sectionOf } from "./sections";

describe("sections", () => {
  it("lists the eight sections in the prototype's order and groups, ⌘1 to ⌘8", () => {
    expect(SECTIONS.map((s) => s.key)).toEqual(["today", "ask", "library", "people", "topics", "activity", "agents", "performance"]);
    expect(SECTIONS.map((s) => s.digit)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(GROUPS.map((g) => g.sections.length)).toEqual([2, 3, 3]);
    expect(GROUPS.map((g) => g.title)).toEqual([null, "group.library", "group.workspace"]);
  });

  it("finds a section by key", () => {
    expect(sectionOf("library").label).toBe("section.library");
  });

  it("routes the core's navigation requests to a section page, and leaves the other windows' targets alone", () => {
    expect(navRoute({ type: "activity" })).toEqual({ section: "activity", key: "root" });
    expect(navRoute({ type: "call_page", call_id: "call_1", tab: "summary" })).toEqual({ section: "library", key: "call:call_1:summary" });
    expect(navRoute({ type: "person", person_id: "p1" })).toEqual({ section: "people", key: "person:p1" });
    expect(navRoute({ type: "topic", topic_id: "t1" })).toEqual({ section: "topics", key: "topic:t1" });
    expect(navRoute({ type: "item", item_id: "i1" })).toEqual({ section: "activity", key: "item:i1" });
    expect(["today", "ask", "agents", "performance"].map((type) => navRoute({ type } as never)?.section)).toEqual(["today", "ask", "agents", "performance"]);
    expect(navRoute({ type: "settings", pane: "privacy" })).toBeNull();
    expect(navRoute({ type: "first_run" })).toBeNull();
  });

  it("opens the search results of the Library", () => {
    expect(searchRoute("zoom")).toEqual({ section: "library", key: "search:zoom" });
  });
});
