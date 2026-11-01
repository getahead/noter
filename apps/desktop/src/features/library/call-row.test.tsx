import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CallRow } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import { CallRowView, peopleOf, typeLabel, whenOf } from "./call-row";

const person = (n: string, you = false) => ({
  id: n,
  display_name: n,
  short_name: `${n} K.`,
  initials: n[0]!,
  is_you: you,
});
const call = (o: Partial<CallRow> = {}) =>
  ({
    id: "c1",
    rev: 1,
    title: "Planning",
    call_type: "planning",
    started_at: Date.UTC(2026, 9, 2, 12),
    duration_ms: 2_880_000,
    participants: [],
    unnamed_speakers: 0,
    languages: ["en", { code: "fr" }],
    tags: ["a", "b", "c"],
    privacy: "sensitive",
    status: "ready",
    outputs: "ready",
    archive: "done",
    audio_kept_until: null,
    audio_deleted: true,
    open_items: 3,
    review_waiting: 0,
    ...o,
  }) as CallRow;

describe("call row (cpt-noter-component-ui-call-row)", () => {
  it("names the people, the user last, with +N past three", () => {
    expect(
      peopleOf(
        call({
          participants: [person("Anna"), person("You", true), person("Boris")],
        }),
      ),
    ).toBe("Anna, Boris, You");
    expect(
      peopleOf(
        call({ participants: ["A", "B", "C", "D", "E"].map((n) => person(n)) }),
      ),
    ).toBe("A, B, C +2");
  });

  it("writes the time as Today or the day, and a type id as words", () => {
    const now = Date.UTC(2026, 9, 2, 20);
    expect(whenOf(Date.UTC(2026, 9, 2, 12), now)).toMatch(/^Today \d\d:\d\d$/);
    expect(whenOf(Date.UTC(2026, 8, 1, 12), now)).toMatch(/^1 Sep \d\d:\d\d$/);
    expect(typeLabel("one_on_one")).toBe("One on one");
  });

  it("renders the table row: Local only, languages, two tags and +1, the open count and the audio glyph", () => {
    const h = renderToString(
      <table>
        <tbody>
          <CallRowView
            call={call()}
            onPress={() => {}}
            onOpen={() => {}}
            onContext={() => {}}
          />
        </tbody>
      </table>,
    );
    expect(h).toContain('data-component="cpt-noter-component-ui-call-row"');
    expect(h).toContain('data-variant="table-row"');
    expect(h).toContain("Local only");
    expect(h).toContain(">EN<");
    expect(h).toContain(">FR<");
    expect(h).toContain("+1");
    expect(h).toContain("Audio deleted");
    expect(h).toContain('aria-label="Open Planning"');
  });

  it("names an untitled call and shows the status link that opens the call", () => {
    const onOpen = vi.fn();
    const tree = rendered(CallRowView, {
      call: call({
        title: "",
        unnamed_speakers: 2,
        privacy: "normal",
        audio_deleted: false,
        audio_deleted_at: null,
        audio_retention_days: 30,
      }),
      onPress: vi.fn(),
      onOpen,
      onContext: vi.fn(),
    });
    expect(renderToString(tree)).toContain("Untitled call");
    (
      find(tree, (p) => p.label === "2 speakers not named").props
        .onAction as () => void
    )();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("opens on Return and on a double-click, and reports a press and a context click", () => {
    const [onPress, onOpen, onContext] = [vi.fn(), vi.fn(), vi.fn()];
    const tr = find(
      rendered(CallRowView, { call: call(), onPress, onOpen, onContext }),
      (p) => p["data-lib-row"] === "c1",
    );
    const prevent = vi.fn();
    (tr.props.onKeyDown as (e: unknown) => void)({
      key: "Enter",
      metaKey: false,
      preventDefault: prevent,
    });
    (tr.props.onKeyDown as (e: unknown) => void)({
      key: "Enter",
      metaKey: true,
      preventDefault: prevent,
    });
    (tr.props.onDoubleClick as () => void)();
    (tr.props.onClick as (e: unknown) => void)({});
    (tr.props.onContextMenu as (e: unknown) => void)({});
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect([onPress, onContext].map((f) => f.mock.calls.length)).toEqual([
      1, 1,
    ]);
  });
});
