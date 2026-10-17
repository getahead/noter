// A scripted core speaking the noter-core-harness wire format, for StdioCore's tests.
import { createInterface } from "node:readline";

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
process.stdout.write("\n"); // blank lines are ignored
process.stdout.write("not json\n"); // garbage is reported, not fatal

createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, window, cmd, channel } = JSON.parse(line);
  if (cmd === "app_exit") process.exit(3);
  if (cmd === "calls_delete") return out({ id, error: { code: "window_not_allowed", message: "no", retryable: false, detail: null } });
  out({ id, ok: { window, cmd } });
  if (channel) {
    out({ id, message: { seq: 1 } });
    out({ id, message: { seq: 2 } });
    out({ event: "capture:state", payload: { state: "idle" } });
  }
});
