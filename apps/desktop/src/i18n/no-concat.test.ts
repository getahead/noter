// The "no sentence by concatenation" lint rule (cpt-noter-dod-ui-accessibility-l10n-strings) as a unit test:
// every component (.tsx) takes its interface text from the catalogue. It walks the real syntax tree
// (Vite's oxc parser), so JSX text next to {expressions} and attribute labels are seen too.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAst } from "vite";
import { describe, expect, it } from "vitest";

type Node = { type: string; start: number; [k: string]: unknown };

const WORD = /[A-Za-z]{2,}/;
/** Attributes whose value is read or shown to the user. */
const LABELS = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "title",
  "placeholder",
  "alt",
  "label",
]);
/** Attributes that hold identifiers, not text (template literals there are fine). */
const NOT_TEXT = new Set([
  "className",
  "class",
  "id",
  "key",
  "href",
  "style",
  "htmlFor",
  "role",
  "type",
  "name",
  "lang",
]);
const isWords = (n: unknown): boolean => {
  const v = n as Node | undefined;
  return (
    v?.type === "Literal" && typeof v.value === "string" && WORD.test(v.value)
  );
};

/** "file:line rule" for every violation in the source. */
export function violations(file: string, source: string): string[] {
  const out: string[] = [];
  const report = (n: Node, rule: string) =>
    out.push(`${file}:${source.slice(0, n.start).split("\n").length} ${rule}`);
  const visit = (n: unknown, attr: string | null): void => {
    if (Array.isArray(n)) return n.forEach((c) => visit(c, attr));
    if (!n || typeof n !== "object") return;
    const node = n as Node;
    if (node.type === "JSXText" && WORD.test(String(node.value)))
      report(node, "JSX text that is not from the catalogue");
    if (node.type === "JSXAttribute") {
      const name = String((node.name as { name?: unknown }).name);
      if (LABELS.has(name) && isWords(node.value))
        report(node, `${name} literal that is not from the catalogue`);
      attr = name;
    }
    if (
      node.type === "BinaryExpression" &&
      node.operator === "+" &&
      (isWords(node.left) || isWords(node.right))
    )
      report(node, "string literal with a word joined by +");
    if (
      node.type === "TemplateLiteral" &&
      (node.expressions as unknown[]).length > 0 &&
      !NOT_TEXT.has(attr ?? "") &&
      (node.quasis as { value: { raw: string } }[]).some((q) =>
        WORD.test(q.value.raw),
      )
    )
      report(node, "template literal with words around ${}");
    if (node.type === "CallExpression") {
      const callee = node.callee as Node & {
        property?: { name?: string };
        object?: Node & { elements?: unknown[] };
      };
      if (
        callee.type === "MemberExpression" &&
        callee.property?.name === "join" &&
        callee.object?.type === "ArrayExpression" &&
        callee.object.elements!.some(isWords)
      )
        report(node, "words joined with join()");
    }
    for (const [k, v] of Object.entries(node))
      if (k !== "type" && typeof v === "object") visit(v, attr);
  };
  visit(parseAst(source, { lang: "tsx" }), null);
  return out;
}

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );

describe("no concatenated sentences", () => {
  it.each([
    ["const x = <p>Copied for {name}</p>;", "JSX text"],
    ["const x = <p>{n} items</p>;", "JSX text"],
    ["const x = <b>Hello</b>;", "JSX text"],
    ['const s = "Copied for " + name;', "joined by +"],
    ["const s = `Copied${name}`;", "template literal"],
    ["const s = `${n} items`;", "template literal"],
    ['const x = <button aria-label="Close" />;', "aria-label literal"],
    ['const x = <i title="Hi there" />;', "title literal"],
    ['const x = <input placeholder="Search" />;', "placeholder literal"],
    ['const s = ["Copied", name].join(" ");', "join()"],
  ])("flags %s", (src, rule) => {
    expect(violations("a.tsx", src).join("\n")).toContain(rule);
  });

  it("reports the line and ignores comments, catalogue use and non-text code", () => {
    expect(violations("a.tsx", "\n\nconst s = 'a word' + c;")[0]).toMatch(
      /^a\.tsx:3 /,
    );
    expect(
      violations("a.tsx", '// "Copied " + name\n/* <b>Hello</b> */'),
    ).toEqual([]);
    const ok = [
      'const x = <b><Msg id="x" /></b>;',
      "const n = 1 + 2;",
      "const t = `${a}${b}`;",
      "const f = () => <i />;",
      "if (a) { b(); } else { c(); }",
      'const x = <div className={`row ${state}`} data-live="polite" aria-live="polite" />;',
      'const x = <p aria-label={t("window.error")}>{t("window.error")}</p>;',
    ];
    for (const src of ok) expect(violations("a.tsx", src)).toEqual([]);
  });

  it("holds for every component under src/", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const bad = walk(root)
      .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
      .flatMap((f) =>
        violations(f.slice(root.length), readFileSync(f, "utf8")),
      );
    expect(bad).toEqual([]);
  });
});
