import { expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import { find, rendered } from "../../ui/testing";
import { seg } from "../transcript/testing";
import { SplitLinePopover } from "./SplitLinePopover";

const line = seg("line", 0, { text: "First second", t1_ms: 3000 });
const point = { seg: line, anchor: {} as HTMLElement, at: 6 };

it.each(["ok", "conflict", "not_found", "invalid_input"] as const)("sends the previewed text and handles %s", async (status) => {
  const reply = status === "ok" ? { status, data: { change_id: "c", speakers: [], segments: [line, line] } }
    : { status: "error", error: { code: status } };
  const split = vi.fn(async () => reply);
  const act = vi.fn(async (_key: string, _command: string, request: () => Promise<unknown>) => request());
  const bridge = { act, core: { transcriptSplitSegment: split } } as unknown as Bridge;
  const onSplit = vi.fn();
  const onClose = vi.fn();
  const onStale = vi.fn();
  const view = rendered(SplitLinePopover, { bridge, participants: [], speakers: [], point, measured: 2200, onSplit, onClose, onStale });
  expect(view.props.label).toBe("Split line at 00:00:02");
  const action = find(view, (props) => props.label === "Split").props.onAction as () => Promise<void>;
  await Promise.all([action(), action()]);
  expect(split).toHaveBeenCalledTimes(1);
  expect(split).toHaveBeenCalledWith({ call_id: line.call_id, segment_id: line.id, at: 6, speaker: { type: "new" }, expected_text: line.text });
  expect(onSplit).toHaveBeenCalledTimes(status === "ok" ? 1 : 0);
  expect(onClose).toHaveBeenCalledTimes(status === "ok" ? 1 : 0);
  expect(onStale).toHaveBeenCalledTimes(status === "conflict" || status === "not_found" ? 1 : 0);
});
