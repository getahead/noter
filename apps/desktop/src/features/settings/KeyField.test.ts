// #1057: after a stored key is removed, the first-run row's draft goes back to empty (no stale verified line).
import { describe, expect, it, vi } from "vitest";

const { setters } = vi.hoisted(() => ({ setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    // the hook runs outside a render here: each useState hands back its initial value and a spy setter
    useState: (initial: unknown) => {
      const set = vi.fn();
      setters.push(set);
      return [initial, set];
    },
    useRef: (current: unknown) => ({ current }),
  };
});

const { useKeyDraft } = await import("./KeyField");

describe("useKeyDraft (cpt-noter-seq-first-run-connect-assistant)", () => {
  it("#1057: reset empties the draft, returns to DRAFT and clears the line under the field", () => {
    setters.length = 0;
    const key = useKeyDraft({} as never, "anthropic");
    const [setDraft, setState, setMessage] = setters;
    key.edit("typed-but-not-a-key");
    key.reset();
    expect(setDraft).toHaveBeenLastCalledWith("");
    expect(setState).toHaveBeenLastCalledWith("DRAFT");
    expect(setMessage).toHaveBeenLastCalledWith(null);
  });
});
