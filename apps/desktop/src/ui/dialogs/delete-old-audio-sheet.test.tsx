// The Delete Old Audio sheet's primary button: the label stays while the command runs and a press is ignored.
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { find, rendered } from "../testing";
import { DeleteOldAudioSheet } from "./delete-old-audio-sheet";

describe("DeleteOldAudioSheet (inst-sheet-submit)", () => {
  it("keeps the button's label and marks it busy while the command runs", () => {
    const idle = renderToString(<DeleteOldAudioSheet close={() => {}} onDelete={() => {}} />);
    const busy = renderToString(<DeleteOldAudioSheet close={() => {}} busy onDelete={() => {}} />);
    expect(idle).toContain("Delete Audio");
    expect(busy).toContain("Delete Audio"); // the label stays: no "Deleting…" swap
    expect(busy).not.toBe(idle);
  });

  it("sends the delete once: a press while busy does nothing", () => {
    const onDelete = vi.fn();
    const press = (busy: boolean) => {
      const tree = rendered(DeleteOldAudioSheet, { close: () => {}, busy, onDelete });
      const footer = find(tree, (p) => "defaultButton" in p);
      return (footer.props.defaultButton as { props: Record<string, unknown> }).props;
    };
    expect(press(false).loading).toBeFalsy();
    expect(press(true).loading).toBe(true);
    expect(press(true).onAction).toBe(onDelete); // the button itself ignores presses while loading
  });
});
