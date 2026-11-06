import { describe, expect, it } from "vitest";

import type { CallOutputs } from "../../core/bindings";
import { copiedLabel, shareKey, scopeLine, scopeOf, shareState, validateTag } from "./share-logic";

const out = (o: Partial<CallOutputs>) => ({ status: "ready", sensitive: false, sections: [], ...o }) as unknown as CallOutputs;

describe("share scope", () => {
  it("is the whole call from the toolbar, one section from a section, and never broader than asked", () => {
    expect(scopeOf({ type: "toolbar" }, false)).toEqual({ sections: [], item_ids: [], include_unreviewed: false });
    expect(scopeOf({ type: "row", kind: "action_items", id: "itm_a0" }, false)).toEqual({ sections: ["action_items"], item_ids: ["itm_a0"], include_unreviewed: false });
    expect(scopeLine({ type: "row", kind: "action_items", id: "itm_a0" })).toBe("This item");
    expect(scopeOf({ type: "section", kind: "decisions" }, true)).toEqual({ sections: ["decisions"], item_ids: [], include_unreviewed: true });
  });
  it("names the scope on the menu's first line", () => {
    expect(scopeLine({ type: "toolbar" })).toBe("Whole call");
    expect(scopeLine({ type: "section", kind: "action_items" })).toBe("Action items");
  });
});

describe("share state", () => {
  it("disables copying while nothing is ready, names unreviewed suggestions and sensitive calls", () => {
    expect(shareState(out({ status: "writing" }))).toEqual({ ready: false, sensitive: false });
    expect(shareState(out({ status: "not_started" })).ready).toBe(false);
    expect(shareState(out({ status: "ready", sensitive: true }))).toEqual({ ready: true, sensitive: true });
    expect(shareState(undefined).ready).toBe(true); // not read yet: the core answers `outputs_not_ready`
  });
  it("uses the current call privacy when the held outputs still have the earlier privacy", () => {
    expect(shareState(out({ sensitive: false }), "sensitive").sensitive).toBe(true);
    expect(shareState(out({ sensitive: true }), "normal").sensitive).toBe(false);
    expect(shareState(undefined, "sensitive").sensitive).toBe(true);
  });
  it("labels the copy for the format, and plain Copied for a sensitive call", () => {
    expect(copiedLabel("slack", false)).toBe("Copied for Slack");
    expect(copiedLabel("jira", false)).toBe("Copied for Jira");
    expect(copiedLabel("markdown", false)).toBe("Copied as Markdown");
    expect(copiedLabel("slack", true)).toBe("Copied");
  });
  it("maps the share chords and leaves ⌘C alone", () => {
    expect(shareKey("Shift+Meta+KeyC")).toBe("slack");
    expect(shareKey("Alt+Meta+KeyC")).toBe("jira");
    expect(shareKey("Alt+Shift+Meta+KeyC")).toBe("markdown");
    expect(shareKey("Meta+KeyE")).toBe("export");
    expect(shareKey("Meta+KeyC")).toBeNull();
  });
});

describe("tag validation", () => {
  it("trims, and rejects empty, duplicate ignoring case, and over 32 characters", () => {
    expect(validateTag("  release ", ["Bug"])).toEqual({ ok: true, tag: "release" });
    expect(validateTag("   ", [])).toMatchObject({ ok: false });
    expect(validateTag("BUG", ["bug"])).toMatchObject({ ok: false });
    expect(validateTag("x".repeat(33), [])).toMatchObject({ ok: false });
    expect(validateTag("x".repeat(32), [])).toMatchObject({ ok: true });
  });
});
