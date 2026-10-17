// Result helpers shared by the E2E flows and the conformance suite (framework-agnostic).
// Kept apart from scenario.ts so a spec can import them without loading the fake core.
import type { CoreError, Result } from "../../src/core/bindings";

/** The data of an ok result; throws with the error code otherwise. */
export function ok<T>(res: Result<T>): T {
  if (res.status !== "ok") throw new Error(`expected ok, got ${res.error.code}: ${res.error.message}`);
  return res.data;
}

/** The CoreError of a refused call; throws if the call succeeded. */
export function refused<T>(res: Result<T>): CoreError {
  if (res.status !== "error") throw new Error(`expected a CoreError, got ok: ${JSON.stringify(res.data).slice(0, 200)}`);
  return res.error;
}

/** Wait until `probe` returns a value that is not undefined/false, or fail after `timeout` ms. */
export async function until<T>(probe: () => T | undefined | false | Promise<T | undefined | false>, what: string, timeout = 8000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await probe();
    if (v !== undefined && v !== false) return v;
    if (Date.now() > end) throw new Error(`timed out after ${timeout} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * A step that a later milestone's command delivers (harness/milestones.toml): its data, or
 * null while the real core still answers `not_implemented` for it. The fake answers every
 * command, so on the fake the step always runs; any other error fails the test.
 */
export function ahead<T>(res: Result<T>): T | null {
  if (res.status === "error" && res.error.code === "not_implemented") return null;
  return ok(res);
}
