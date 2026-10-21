import type { Bridge } from "../../app/bridge/bridge";
import type { GlossaryTerm, GlossaryUpsertArgs, Result, GlossaryList } from "../../core/bindings";

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

const terms = (res: Result<GlossaryList>): GlossaryTerm[] | null => (res.status === "ok" ? byTerm(res.data.terms) : null);

/** `glossary_list`: the terms, or null when the core refused. */
export const listTerms = async (bridge: Bridge) => terms(await bridge.act("glossary:list", "glossary_list", () => bridge.core.glossaryList({})));

// @cpt-begin:cpt-noter-flow-ui-settings-change-setting:p1:inst-case-glossary
/** `glossary_upsert` of a new term: the whole list after it, or null when the core refused. */
export const addTerm = async (bridge: Bridge, args: GlossaryUpsertArgs) => terms(await bridge.act("glossary:upsert", "glossary_upsert", () => bridge.core.glossaryUpsert(args)));

/** `glossary_remove`: the whole list after it, or null when the core refused. */
export const removeTerm = async (bridge: Bridge, id: string) => terms(await bridge.act("glossary:remove", "glossary_remove", () => bridge.core.glossaryRemove({ id })));
// @cpt-end:cpt-noter-flow-ui-settings-change-setting:p1:inst-case-glossary

export interface GlossaryCtx {
  form: TermForm | null;
  selected: string | null;
  setTerms: (t: GlossaryTerm[]) => void;
  setForm: (f: TermForm | null) => void;
  setSelected: (id: string | null) => void;
}

/** **+** saves the form as a new term; **−** removes the selected one. */
export function createGlossaryActions(bridge: Bridge, ctx: GlossaryCtx) {
  return {
    add: async () => {
      const args = ctx.form && newTermArgs(ctx.form);
      const list = args && (await addTerm(bridge, args));
      if (list) (ctx.setTerms(list), ctx.setForm(null));
    },
    remove: async () => {
      const list = ctx.selected && (await removeTerm(bridge, ctx.selected));
      if (list) ctx.setTerms(list);
      ctx.setSelected(null);
    },
  };
}
