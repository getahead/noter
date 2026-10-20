import type { GlossaryTerm, GlossaryUpsertArgs } from "../../core/bindings";

/** "a, b ,, c" → ["a", "b", "c"] */
export const splitVariants = (text: string): string[] => text.split(",").map((v) => v.trim()).filter(Boolean);

export interface TermForm {
  term: string;
  latin: string;
  cyrillic: string;
  spoken: string;
}

export const EMPTY_FORM: TermForm = { term: "", latin: "", cyrillic: "", spoken: "" };

/** The `glossary_upsert` args for a new term; null while the term itself is empty. */
export function newTermArgs(f: TermForm): GlossaryUpsertArgs | null {
  const term = f.term.trim();
  return term ? { term, variants_latin: splitVariants(f.latin), variants_cyrillic: splitVariants(f.cyrillic), spoken_forms: splitVariants(f.spoken), always_apply: false } : null;
}

/** A row's cell text: variants joined as the table shows them. */
export const cell = (variants: readonly string[]): string => variants.join(", ");

/** The terms after a removal answered; the core's list is the truth, this only orders it by term. */
export const byTerm = (terms: readonly GlossaryTerm[]): GlossaryTerm[] => [...terms].sort((a, b) => a.term.localeCompare(b.term));
