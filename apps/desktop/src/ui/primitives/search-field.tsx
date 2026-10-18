import type { KeyboardEvent } from "react";

import { Icon } from "../icons";
import { base, cx, type Common } from "./attrs";

export interface SearchToken {
  label: string;
  /** filter (default), tag, person… as data-token-kind. */
  kind?: string;
}

export interface SearchFieldProps extends Common {
  /** plain, tokens (with suggestions) or token-field (Call info › Tags). */
  variant?: "plain" | "tokens" | "token-field";
  /** empty, typing, tokens, suggestions or searching; derived from the value and tokens when unset. */
  state?: string;
  value?: string;
  tokens?: SearchToken[];
  placeholder?: string;
  ariaLabel?: string;
  onChange?: (value: string) => void;
  /** Return runs the search. */
  onEnter?: (value: string) => void;
  /** Return or a comma in a token field adds the typed tag. */
  onAddToken?: (text: string) => void;
  onRemoveToken?: (index: number) => void;
}

export type SearchKeyAction = "run" | "add-token" | "remove-last-token" | "clear" | "leave";

/** What a key does in a search field: Return runs (adds a tag in a token field, as does a comma), ⌫ at the start
 *  removes the last token, Esc clears the text and a second Esc leaves the field. */
export function searchKey(key: string, f: { value: string; caret: number; tokens: number; tokenField: boolean }): SearchKeyAction | null {
  if (key === "Enter") return f.tokenField ? (f.value.trim() ? "add-token" : null) : "run";
  if (key === ",") return f.tokenField && f.value.trim() ? "add-token" : null;
  if (key === "Backspace") return f.caret === 0 && f.tokens > 0 ? "remove-last-token" : null;
  if (key === "Escape") return f.value ? "clear" : "leave";
  return null;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** search-field: a capsule with the search glyph, optional capsule tokens and a native search input. */
export function SearchField({ variant: v, state, value = "", tokens = [], placeholder, ariaLabel, onChange, onEnter, onAddToken, onRemoveToken, id, ...o }: SearchFieldProps) {
  const variant = v || (tokens.length ? "tokens" : "plain");
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const action = searchKey(e.key, { value: input.value, caret: input.selectionStart ?? 0, tokens: tokens.length, tokenField: variant === "token-field" });
    if (!action) return;
    if (action !== "remove-last-token") e.preventDefault();
    if (action === "run") onEnter?.(input.value);
    else if (action === "add-token") onAddToken?.(input.value.trim());
    else if (action === "remove-last-token") onRemoveToken?.(tokens.length - 1);
    else if (action === "clear") onChange?.("");
    else input.blur();
  };
  return (
    <label className={cx("np-search", `np-search--${variant}`, o.cls)} {...base("search-field", { ...o, variant, state: state || (value ? "typing" : tokens.length ? "tokens" : "empty") })}>
      {variant !== "token-field" && <Icon name="search" size={13} cls="np-search__icon" />}
      {tokens.map((t, i) => (
        <span key={`${i}:${t.label}`} className="np-token" data-token-kind={t.kind || "filter"}>
          {t.label}
          <button type="button" className="np-token__x" aria-label={`Remove ${t.label}`} onClick={() => onRemoveToken?.(i)}>
            <Icon name="x" size={9} />
          </button>
        </span>
      ))}
      <input type="search" id={id} placeholder={placeholder} value={value} aria-label={ariaLabel || placeholder} autoComplete="off" onChange={(e) => onChange?.(e.target.value)} onKeyDown={onKeyDown} />
    </label>
  );
}
