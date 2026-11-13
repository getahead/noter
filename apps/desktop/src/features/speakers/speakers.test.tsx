import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import type { PersonChip, SpeakerView } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import { NewPersonForm, PersonPicker } from "./PersonPicker";
import { SpeakerRenamePopover } from "./SpeakerRenamePopover";

const chip = (id: string, name: string): PersonChip => ({
  id,
  display_name: name,
  short_name: name.split(" ")[0],
  initials: name.slice(0, 2),
  is_you: false,
});
const spk = (over: Partial<SpeakerView> = {}): SpeakerView =>
  ({
    id: "spk_3",
    call_id: "c1",
    label: { type: "unnamed", n: 3 },
    channel: "system",
    segment_count: 4,
    talk_ms: null,
    sample: null,
    suggestion: null,
    named_by: null,
    ...over,
  }) as SpeakerView;

const bridgeFor = (answer: unknown, sent: unknown[] = []) =>
  ({
    core: {
      peopleList: async () => ({
        status: "error",
        error: { code: "not_implemented" },
      }),
      transcriptRenameSpeaker: async (a: unknown) => (sent.push(a), answer),
    },
    act: async (_k: string, _c: string, run: () => Promise<unknown>) => run(),
    store: { getState: () => ({ entities: { person: {} } }), subscribe: () => () => {} },
  }) as unknown as Bridge;

describe("PersonPicker", () => {
  it("lists In this call with the New Person… entry last, and offers the quoted query when nothing matches", () => {
    const html = renderToString(
      <PersonPicker
        bridge={bridgeFor(null)}
        variant="popover"
        participants={[chip("p1", "Pavel Romanov"), chip("p2", "Anna K.")]}
        speakers={[]}
        confirmLabel="Create and Name"
        onPick={() => {}}
      />,
    );
    expect(html).toContain("In this call");
    expect(html.indexOf("Pavel Romanov")).toBeLessThan(
      html.indexOf("New Person…"),
    );
    expect(html).toContain('role="combobox"');
    const none = renderToString(
      <PersonPicker
        bridge={bridgeFor(null)}
        variant="popover"
        participants={[chip("p1", "Pavel")]}
        speakers={[]}
        value="Lena"
        confirmLabel="x"
        onPick={() => {}}
      />,
    );
    expect(none).toContain("No one called");
    expect(none).toContain("New Person");
  });
  it("an inline picker keeps its list closed until the field has focus", () => {
    const html = renderToString(
      <PersonPicker
        bridge={bridgeFor(null)}
        variant="inline"
        participants={[chip("p1", "Pavel")]}
        speakers={[]}
        confirmLabel="x"
        onPick={() => {}}
      />,
    );
    expect(html).not.toContain('role="listbox"');
  });
});

type Ev = {
  key: string;
  metaKey?: boolean;
  preventDefault: () => void;
  nativeEvent: { isComposing: boolean };
};
const keyEv = (key: string, isComposing = false): Ev => ({
  key,
  preventDefault: () => {},
  nativeEvent: { isComposing },
});
const input = (
  value?: string,
  over: Partial<Parameters<typeof PersonPicker>[0]> = {},
) => {
  const calls = { pick: vi.fn(), confirm: vi.fn(), close: vi.fn() };
  const tree = rendered(PersonPicker, {
    bridge: bridgeFor(null),
    variant: "popover",
    participants: [chip("p1", "Pavel Romanov"), chip("p2", "Anna K.")],
    speakers: [],
    confirmLabel: "x",
    value,
    onPick: calls.pick,
    onConfirm: calls.confirm,
    onClose: calls.close,
    ...over,
  });
  const field = find(tree, (pr) => pr.role === "combobox").props as Record<
    string,
    (...a: unknown[]) => void
  >;
  return { calls, field, tree };
};

describe("PersonPicker keys and choices", () => {
  it("typing reports no person yet", () => {
    const { calls, field } = input();
    field.onChange({ target: { value: "Pa" } });
    expect(calls.pick).toHaveBeenCalledWith(null, "Pa");
  });
  it("Return selects the first matching person without requiring an arrow key", () => {
    const { calls, field } = input("Pavel");
    field.onKeyDown(keyEv("Enter"));
    expect(calls.confirm).toHaveBeenCalledWith(
      { type: "existing", person_id: "p1" },
      "Pavel Romanov",
      false,
    );
  });
  it("with no match the New Person… entry is the one Return opens, and the first Esc clears the query", () => {
    const { calls, field } = input("Zoya");
    field.onKeyDown(keyEv("Enter"));
    expect(calls.confirm).not.toHaveBeenCalled(); // opens the form, nothing is named yet
    field.onKeyDown(keyEv("Escape"));
    expect(calls.pick).toHaveBeenCalledWith(null, "");
    expect(calls.close).not.toHaveBeenCalled();
  });
  it("Meta+N prevents the browser shortcut while opening the new-person form", () => {
    const { field } = input("Pav");
    const preventDefault = vi.fn();
    field.onKeyDown({ ...keyEv("n"), metaKey: true, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  });
  it("Esc on an empty field closes the host; an input method's keys are left alone", () => {
    const { calls, field } = input();
    field.onKeyDown(keyEv("Escape", true));
    expect(calls.close).not.toHaveBeenCalled();
    field.onKeyDown(keyEv("Escape"));
    expect(calls.close).toHaveBeenCalled();
  });
  it("a click on an option picks that person", () => {
    const { calls, tree } = input();
    const opt = find(
      tree,
      (pr) => pr.role === "option" && String(pr.id).endsWith("-0"),
    ).props as { onClick: () => void };
    opt.onClick();
    expect(calls.pick).toHaveBeenCalledWith(
      { type: "existing", person_id: "p1" },
      "Pavel Romanov",
    );
  });
  it("the New Person… entry opens the form without naming anyone", () => {
    const { calls, tree } = input("Zoya");
    (
      find(tree, (pr) => pr.role === "option").props as { onClick: () => void }
    ).onClick();
    expect(calls.pick).not.toHaveBeenCalled();
  });
});

describe("NewPersonForm", () => {
  const form = (initial: string, over: Record<string, unknown> = {}) => {
    const calls = { confirm: vi.fn(), pick: vi.fn(), back: vi.fn() };
    const tree = rendered(NewPersonForm, {
      variant: "popover",
      initial,
      people: null,
      confirmLabel: "Create and Name",
      onPick: calls.pick,
      onConfirm: calls.confirm,
      onBack: calls.back,
      ...over,
    } as never);
    const button = (label: string) =>
      find(tree, (pr) => pr.label === label).props as { onAction: () => void };
    return { calls, tree, button };
  };
  it("creates the person with the typed name when the form is valid", () => {
    const { calls, button } = form("Zoya");
    button("Create and Name").onAction();
    expect(calls.confirm).toHaveBeenCalledWith(
      { type: "new", display_name: "Zoya", email: null },
      "Zoya",
      true,
    );
  });
  it("does not create without a name, and Back leaves the form", () => {
    const { calls, button } = form("");
    button("Create and Name").onAction();
    expect(calls.confirm).not.toHaveBeenCalled();
    button("Back").onAction();
    expect(calls.back).toHaveBeenCalledWith("");
  });
  it("a name already in people is not created until Create Anyway says so", () => {
    const row = {
      id: "p7",
      display_name: "Zoya Ivanova",
      short_name: "Zoya",
      initials: "ZI",
      role: null,
      aliases: [],
    };
    const { calls, button } = form("zoya ivanova", { people: [row] });
    button("Create and Name").onAction();
    expect(calls.confirm).not.toHaveBeenCalled();
  });
  it("Esc returns to the list with the current name", () => {
    const { calls, tree } = form("Zoya");
    const input = find(tree, (pr) => pr["aria-label"] === "Name").props as {
      onKeyDown: (event: Ev & { preventDefault: () => void }) => void;
    };
    input.onKeyDown({ ...keyEv("Escape"), preventDefault: vi.fn() });
    expect(calls.back).toHaveBeenCalledWith("Zoya");
  });
  it("Enter submits the current draft", () => {
    const { calls, tree } = form("Zoya");
    const name = find(tree, (pr) => pr["aria-label"] === "Name").props as {
      onKeyDown: (event: Ev) => void;
    };
    name.onKeyDown({ ...keyEv("Enter"), preventDefault: vi.fn() });
    expect(calls.confirm).toHaveBeenCalledWith({ type: "new", display_name: "Zoya", email: null }, "Zoya", true);
  });
  it("validates fields on blur and Esc returns the latest draft", () => {
    const { calls, tree } = form("Zoya");
    const name = find(tree, (pr) => pr["aria-label"] === "Name").props as {
      onBlur: () => void;
      onKeyDown: (event: Ev) => void;
    };
    name.onBlur();
    name.onKeyDown({ ...keyEv("Escape"), preventDefault: vi.fn() });
    expect(calls.back).toHaveBeenCalledWith("Zoya");
    expect(calls.confirm).not.toHaveBeenCalled();
  });
  it("the form is titled, its fields carry placeholders, and the footer pairs Back with the confirm", () => {
    const html = renderToString(
      <NewPersonForm
        variant="popover"
        initial="Zoya"
        people={null}
        confirmLabel="Create and Name"
        onPick={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />,
    );
    expect(html).toContain("New person");
    expect(html).toContain('placeholder="name@company.com"');
    expect(html).toContain('placeholder="Designer"');
    expect(html).toContain('aria-label="Role"');
    expect(html).toContain('disabled=""');
  });
});

describe("SpeakerRenamePopover", () => {
  const props = (bridge: Bridge, onNamed = vi.fn(), onClose = vi.fn()) => ({
    bridge,
    callId: "c1",
    speaker: spk(),
    segmentId: "seg_9",
    participants: [chip("p1", "Pavel Romanov")],
    speakers: [spk()],
    anchor: null,
    onClose,
    onNamed,
  });

  it("renames the whole call by default and reports the named line count with the change to undo", async () => {
    const sent: unknown[] = [];
    const named = spk({
      label: { type: "person", person: chip("p1", "Pavel Romanov") },
      segment_count: 7,
    });
    const p = props(
      bridgeFor(
        { status: "ok", data: { speakers: [named], change_id: "chg_1" } },
        sent,
      ),
    );
    const tree = rendered(SpeakerRenamePopover, p);
    const picker = find(
      tree,
      (pr) => "onConfirm" in pr && "confirmLabel" in pr,
    );
    (
      picker.props.onConfirm as (
        r: unknown,
        n: string,
        isNew: boolean,
      ) => Promise<void>
    )({ type: "existing", person_id: "p1" }, "Pavel Romanov", false);
    await vi.waitFor(() => expect(p.onClose).toHaveBeenCalled());
    expect(sent).toEqual([
      {
        call_id: "c1",
        speaker_id: "spk_3",
        person: { type: "existing", person_id: "p1" },
        scope: { type: "whole_call" },
      },
    ]);
    expect(p.onNamed).toHaveBeenCalledWith(
      "Named Speaker 3 as Pavel · 7 lines",
      "chg_1",
    );
    expect(p.onClose).toHaveBeenCalled();
  });

  it("says You added … for a created person", async () => {
    const named = spk({
      label: { type: "person", person: chip("p9", "Lena") },
      segment_count: 1,
    });
    const p = props(
      bridgeFor({
        status: "ok",
        data: { speakers: [named], change_id: "chg_2" },
      }),
    );
    const picker = find(
      rendered(SpeakerRenamePopover, p),
      (pr) => "onConfirm" in pr && "confirmLabel" in pr,
    );
    (
      picker.props.onConfirm as (
        r: unknown,
        n: string,
        isNew: boolean,
      ) => Promise<void>
    )({ type: "new", display_name: "Lena", email: null }, "Lena", true);
    await vi.waitFor(() => expect(p.onNamed).toHaveBeenCalled());
    expect(p.onNamed).toHaveBeenCalledWith(
      "You added Lena and named Speaker 3 as Lena · 1 line",
      "chg_2",
    );
  });

  it("keeps the popover open on a failed command", async () => {
    const sent: unknown[] = [];
    const sentCount = () => sent.length;
    const p = props(
      bridgeFor({ status: "error", error: { code: "not_found" } }, sent),
    );
    const picker = find(
      rendered(SpeakerRenamePopover, p),
      (pr) => "onConfirm" in pr && "confirmLabel" in pr,
    );
    (
      picker.props.onConfirm as (
        r: unknown,
        n: string,
        isNew: boolean,
      ) => Promise<void>
    )({ type: "existing", person_id: "p1" }, "Pavel", false);
    await vi.waitFor(() => expect(sentCount()).toBe(1));
    expect(p.onNamed).not.toHaveBeenCalled();
    expect(p.onClose).not.toHaveBeenCalled();
  });
});
