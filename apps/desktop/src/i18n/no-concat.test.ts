// The "no sentence by concatenation" lint rule (cpt-noter-dod-ui-accessibility-l10n-strings) as a unit test.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RULES: [name: string, re: RegExp][] = [
  ["string literal with a word joined by +", /(["'])[^"'\n]*[A-Za-z][^"'\n]*\1\s*\+|\+\s*(["'])[^"'\n]*[A-Za-z][^"'\n]*\2/g],
  ["template literal with words around ${", /`[^`]*[A-Za-z] \$\{[^`]*`|`[^`]*\} [A-Za-z][^`]*`/g],
  ["JSX text that is not from the catalogue", /(?<![=-]>)(?<=>)\s*[A-Za-z][^<>{}]*(?=<)/g],
];

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

/** "file:line rule" for every violation in the source. */
export function violations(file: string, source: string): string[] {
  const src = stripComments(source);
  return RULES.flatMap(([name, re]) =>
    [...src.matchAll(re)].map((m) => `${file}:${src.slice(0, m.index + (m[0].length - m[0].trimStart().length)).split("\n").length} ${name}`),
  );
}

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));

describe("no concatenated sentences", () => {
  it("flags each kind of violation", () => {
    expect(violations("a.tsx", 'const s = "Copied for " + name;')).toHaveLength(1);
    expect(violations("a.tsx", "const s = `Copied ${name}`;")).toHaveLength(1);
    expect(violations("a.tsx", "const s = `${n} items`;")).toHaveLength(1);
    expect(violations("a.tsx", "const x = <b>Hello</b>;")).toEqual(["a.tsx:1 JSX text that is not from the catalogue"]);
  });
  it("reports the line and ignores comments, catalogue use and non-text code", () => {
    expect(violations("a.tsx", "\n\nconst s = 'a b' + c;")[0]).toMatch(/^a\.tsx:3 /);
    expect(violations("a.tsx", '// "Copied " + name\n/* <b>Hello</b> */')).toEqual([]);
    expect(violations("a.tsx", 'const x = <b><Msg id="x" /></b>; const n = 1 + 2; const t = `${a}${b}`; const f = () => <i />;')).toEqual([]);
  });

  it("holds for every component under src/", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const bad = walk(root)
      .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
      .flatMap((f) => violations(f.slice(root.length), readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
