// Lets Node's ESM loader import the fixture world the way Vite, Vitest and tsx do.
//
// src/core/fake/fake-core.ts imports contracts/fixtures/world.json without an import
// attribute. Bundlers accept that; Node's ESM loader (Playwright's test runner) refuses it
// ("needs an import attribute of type: json"). This in-thread hook serves .json modules as
// a JS module with a default export, so the Playwright flows can build the fake core in Node.
// Register it before the first import of the fake (tests/e2e/support/fixtures.ts does).
// Not needed once the fake imports the fixture `with { type: "json" }` (contract lane).
import * as nodeModule from "node:module";

type LoadResult = { format?: string | null; source?: string | ArrayBuffer | Uint8Array | null; shortCircuit?: boolean };
type RegisterHooks = (hooks: {
  load: (url: string, context: { format?: string | null; importAttributes?: Record<string, string> }, nextLoad: (url: string, context?: unknown) => LoadResult) => LoadResult;
}) => unknown;

let registered = false;

export function registerJsonModules(): void {
  if (registered) return;
  const registerHooks = (nodeModule as unknown as { registerHooks?: RegisterHooks }).registerHooks;
  if (!registerHooks) throw new Error("node:module registerHooks is missing (Node >= 22.15 needed)");
  registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith("file:") || !url.endsWith(".json") || context.importAttributes?.type === "json") return nextLoad(url, context);
      const loaded = nextLoad(url, { ...context, format: "json", importAttributes: { ...context.importAttributes, type: "json" } });
      const text = typeof loaded.source === "string" ? loaded.source : new TextDecoder().decode(loaded.source as Uint8Array);
      return { format: "module", source: `export default ${text};`, shortCircuit: true };
    },
  });
  registered = true;
}
