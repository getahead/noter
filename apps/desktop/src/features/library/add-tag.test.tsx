import { describe, expect, it, vi } from "vitest";
import { find, rendered } from "../../ui/testing";
import { AddTagPopover } from "./add-tag";

const setup = (onAdd: (t: string) => Promise<boolean>) => {
  const onClose = vi.fn();
  const tree = rendered(AddTagPopover, { anchor: null, count: 3, inUse: ["release", "hotfix"], onAdd, onClose });
  const field = find(tree, (p) => typeof p.onAddToken === "function");
  const button = find(tree, (p) => p.label === "Add Tag");
  return { onClose, tree, field, button };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("AddTagPopover (cpt-noter-flow-ui-library-search-topics-filter-tag)", () => {
  it("names the selection and the tags in use", () => {
    const { tree } = setup(async () => true);
    expect(JSON.stringify(tree.props.label)).toContain("Add tag to 3 calls");
  });
  it("commits a good tag from Return, comma or the button, and closes on success", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    const { onClose, field, button } = setup(onAdd);
    (field.props.onAddToken as (v: string) => void)("release");
    await tick();
    expect(onAdd).toHaveBeenCalledWith("release");
    expect(onClose).toHaveBeenCalledTimes(1);
    (button.props.onAction as () => void)();
    await tick();
    expect(onAdd).toHaveBeenCalledTimes(1); // the empty draft is refused, not sent
  });
  it("refuses a blank or a 33-character tag without calling the core", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    const { onClose, field } = setup(onAdd);
    (field.props.onAddToken as (v: string) => void)("   ");
    (field.props.onAddToken as (v: string) => void)("x".repeat(33));
    await tick();
    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
  it("stays open when the write fails, so the draft can be tried again", async () => {
    const { onClose, field } = setup(vi.fn().mockResolvedValue(false));
    (field.props.onAddToken as (v: string) => void)("release");
    await tick();
    expect(onClose).not.toHaveBeenCalled();
  });
});
