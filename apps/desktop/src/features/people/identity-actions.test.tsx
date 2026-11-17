import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PersonRow } from "../../core/bindings";
import { undoMode } from "../history/undo";
import { find, rendered } from "../../ui/testing";
import { deletePerson, mergePeople, updatePerson } from "./actions";
import { EditPersonSheet, patchOf } from "./EditPersonSheet";
import { MergePeopleSheet, mergeTargets, readPreview } from "./MergePeopleSheet";
import { rowMenu } from "./PeoplePage";
import { leave } from "./leave";
import { confirmDelete } from "./sheets";

const person = (o: Partial<PersonRow> = {}): PersonRow => ({
  id: "per_p", rev: 3, display_name: "Pavel Romanov", short_name: "Pavel", initials: "PR", email: null, role: "Eng", org: null,
  aliases: ["Pasha"], is_you: false, voice_profile: true, last_call_at: null, open_items: 0, ...o,
});
const draft = (o = {}) => ({ name: "Pavel Romanov", aka: "Pasha", email: "", role: "Eng", org: "", notes: "", keep: true, ...o });
const bridgeOf = (res: unknown) => ({ act: vi.fn(async (_k: string, _c: string, run: () => unknown) => (run(), res)), core: { personUpdate: vi.fn(), peopleMerge: vi.fn(), personDelete: vi.fn(), personGet: vi.fn(), windowNavigate: vi.fn() } }) as never;
const ok = (extra = {}) => ({ status: "ok", data: { person: person({ display_name: "Pavel R." }), change_id: "chg_1", ...extra } });

describe("cpt-noter-flow-ui-people-edit-merge", () => {
  it("a changed name keeps the old one as an alias when asked, and drops it otherwise", () => {
    expect(patchOf(person(), draft({ name: "Pavel R." }))).toEqual({ display_name: "Pavel R.", aliases: ["Pasha", "Pavel Romanov"] });
    expect(patchOf(person(), draft({ name: "Pavel R.", keep: false }))).toEqual({ display_name: "Pavel R." });
  });
  it("sends only what changed, clears emptied fields, and notes only when typed", () => {
    expect(patchOf(person(), draft())).toEqual({});
    expect(patchOf(person({ email: "p@x.io" }), draft({ email: "" }))).toEqual({ email: null });
    expect(patchOf(person(), draft({ role: "PM", org: "Acme", notes: "ex-colleague" }))).toEqual({ role: "PM", org: "Acme", notes: "ex-colleague" });
  });
  it("person_update carries the rev; success offers Undo, a stale rev is re-read, other errors fail", async () => {
    const b = bridgeOf(ok()) as { core: { personUpdate: ReturnType<typeof vi.fn> } };
    expect(await updatePerson(b as never, person(), { role: "PM" })).toBe("ok");
    expect(b.core.personUpdate).toHaveBeenCalledWith({ person_id: "per_p", rev: 3, patch: { role: "PM" } });
    expect(undoMode()).toBe("undo");
    expect(await updatePerson(bridgeOf({ status: "error", error: { code: "conflict" } }), person(), {})).toBe("conflict");
    expect(await updatePerson(bridgeOf({ status: "error", error: { code: "internal" } }), person(), {})).toBe("failed");
  });
  it("people_merge opens the kept person with Undo; a refusal returns false", async () => {
    const b = bridgeOf(ok()) as { act: ReturnType<typeof vi.fn> };
    expect(await mergePeople(b as never, person(), person({ id: "per_q" }))).toBe(true);
    expect(b.act).toHaveBeenCalledWith("window_navigate", "window_navigate", expect.any(Function), expect.anything());
    expect(await mergePeople(bridgeOf({ status: "error", error: { code: "not_found" } }), person(), person({ id: "per_q" }))).toBe(false);
  });
  it("person_delete answers whether the person is gone", async () => {
    expect(await deletePerson(bridgeOf({ status: "ok", data: { deleted: 1 } }), "per_p")).toBe(true);
    expect(await deletePerson(bridgeOf({ status: "error", error: { code: "internal" } }), "per_p")).toBe(false);
  });
  it("Delete asks first with Cancel as the way out; a confirmed delete returns to People, a failed one says so", async () => {
    const spec = vi.fn();
    const left = vi.fn();
    leave.toPeople = left;
    const failed = vi.fn();
    expect(await confirmDelete(bridgeOf({}), person(), failed, async (a) => (spec(a), false))).toBe(false);
    expect(spec).toHaveBeenCalledWith(expect.objectContaining({ title: "Delete Pavel?", cancel: "Cancel", confirm: "Delete", destructive: true }));
    expect(left).not.toHaveBeenCalled();
    expect(await confirmDelete(bridgeOf({ status: "ok", data: { deleted: 1 } }), person(), failed, async () => true)).toBe(true);
    expect(left).toHaveBeenCalledOnce();
    expect(await confirmDelete(bridgeOf({ status: "error", error: { code: "internal" } }), person(), failed, async () => true)).toBe(false);
    expect(failed).toHaveBeenCalledWith("Couldn’t delete Pavel. Nothing was changed.");
    leave.toPeople = null;
  });
  it("merge targets exclude You and the source", () => {
    const you = person({ id: "me", is_you: true });
    expect(mergeTargets([you, person(), person({ id: "per_q" })], "per_p").map((p) => p.id)).toEqual(["per_q"]);
  });
  it("the Edit sheet lists the six fields and offers the alias choice only for a changed name", () => {
    const html = renderToString(<EditPersonSheet bridge={bridgeOf({})} person={person()} close={() => {}} />);
    for (const f of ["Name", "Also known as", "Email", "Role", "Organisation", "Notes", "Save", "Cancel"]) expect(html).toContain(f);
    expect(html).not.toContain("as an alias");
    const tree = rendered(EditPersonSheet, { bridge: bridgeOf({}), person: person(), close: () => {} });
    expect(tree).toBeTruthy();
  });
  it("the Merge sheet names the source, lists the keep choices and disables Merge until one is chosen", () => {
    const html = renderToString(<MergePeopleSheet bridge={bridgeOf({})} source={person()} people={[person(), person({ id: "per_q", display_name: "Pasha Q." })]} close={() => {}} />);
    expect(html).toContain("Merge Pavel with another entry");
    expect(html).toContain("Pasha Q.");
    expect(html).toContain("disabled");
    expect(html).not.toContain("What moves");
    const preset = renderToString(<MergePeopleSheet bridge={bridgeOf({})} source={person()} people={[person(), person({ id: "per_q", display_name: "Pasha Q." })]} target="per_q" close={() => {}} />);
    expect(preset).toContain("What moves to Pasha Q.");
    expect(preset).toContain("The voice profile");
  });
  it("Save sends the patch through the sheet; Merge sends the chosen pair; the preview read answers null on failure", async () => {
    const b = bridgeOf(ok()) as { core: { personUpdate: ReturnType<typeof vi.fn>; peopleMerge: ReturnType<typeof vi.fn> } };
    const close = vi.fn();
    const edit = rendered(EditPersonSheet, { bridge: b as never, person: person(), close });
    const def = (t: ReturnType<typeof rendered>) => (find(t, (p) => p.defaultButton !== undefined).props.defaultButton as { props: { onAction: () => Promise<void> } }).props.onAction;
    await def(edit)();
    expect(b.core.personUpdate).toHaveBeenCalledWith({ person_id: "per_p", rev: 3, patch: {} });
    const merge = rendered(MergePeopleSheet, { bridge: b as never, source: person(), people: [person(), person({ id: "per_q" })], target: "per_q", close });
    await def(merge)();
    expect(b.core.peopleMerge).toHaveBeenCalledWith({ source: "per_p", target: "per_q" });
    // a refused save keeps the sheet; typing, the alias box and the Keep choice take their handlers
    const refused = rendered(EditPersonSheet, { bridge: bridgeOf({ status: "error", error: { code: "internal" } }), person: person(), close });
    await def(refused)();
    expect(close).toHaveBeenCalledTimes(2);
    (find(edit, (p) => p.label === "Name").props.onChange as (v: string) => void)("Pavel R.");
    (find(edit, (p) => p.label === "Name").props.onEnter as () => void)();
    (find(merge, (p) => p["aria-label"] === "Keep").props.onChange as (e: unknown) => void)({ target: { value: "per_q" } });
    expect(await readPreview(bridgeOf({ status: "ok", data: { calls: [] } }), "per_p")).toEqual({ calls: [] });
    expect(await readPreview(bridgeOf({ status: "error", error: { code: "not_found" } }), "per_p")).toBeNull();
  });
  it("the list menu offers Merge 2 People only with exactly two chosen", () => {
    const on = { open: vi.fn(), close: vi.fn(), edit: vi.fn(), merge: vi.fn(), del: vi.fn() };
    const labelled = (items: ReturnType<typeof rowMenu>) => items.filter((i): i is Extract<typeof i, { label: string }> => "label" in i);
    const two = labelled(rowMenu([person(), person({ id: "per_q" })], on));
    expect(two.find((i) => i.label === "Merge 2 People…")!.disabled).toBe(false);
    expect(two.find((i) => i.label === "Open")!.disabled).toBe(true);
    const one = labelled(rowMenu([person()], on));
    expect(one.find((i) => i.label === "Merge 2 People…")!.disabled).toBe(true);
    one.find((i) => i.label === "Edit Details…")!.onSelect!();
    one.find((i) => i.label === "Open")!.onSelect!();
    one.find((i) => i.label === "Delete Person…")!.onSelect!();
    two.find((i) => i.label === "Merge 2 People…")!.onSelect!();
    expect([on.edit, on.open, on.del, on.merge].every((f) => f.mock.calls.length === 1)).toBe(true);
    void find;
  });
});
