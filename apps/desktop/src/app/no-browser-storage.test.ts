// cpt-noter-feature-ui-core-bridge acceptance: the UI bundle keeps nothing in the browser (the core owns state).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });

describe("no browser storage", () => {
  it("no UI module reads or writes localStorage, sessionStorage, IndexedDB or cookies", () => {
    const files = sources(SRC);
    expect(files.length).toBeGreaterThan(50);
    const hits = files.filter((f) => /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
