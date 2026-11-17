// Person picker (DESIGN › Person picker; prototype src/js/20-b-components.js C.personPicker): a combobox over grouped
// people, a no-match line and the New person form in place. It returns a PersonRef; the host runs its command.
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";

import { NewPersonForm } from "./NewPersonForm";

import type { Bridge } from "../../app/bridge/bridge";
import type {
  PersonChip,
  PersonRef,
  PersonRow,
  SpeakerView,
} from "../../core/bindings";
import { t } from "../../i18n/format";
import { cx } from "../../ui/primitives/attrs";
import { Icon } from "../../ui/icons";
import {
  candidates,
  CAP_INLINE,
  CAP_POPOVER,
  existing,
  matchPeople,
  stepActive,
  type Entry,
} from "./picker";
import { PersonChip as SharedChip } from "../../ui/primitives/person-chip";
import { usePeople } from "./people";
import "./speakers.css";

export interface PersonPickerProps {
  bridge: Bridge;
  variant: "inline" | "popover";
  /** The call's participants (In this call). */
  participants: readonly PersonChip[];
  speakers: readonly SpeakerView[];
  /** The directory's rows when the host read them (`null`: no directory yet); omitted, the picker reads them. */
  people?: readonly PersonRow[] | null;
  /** The New form's host button: **Create and Name**. */
  confirmLabel: string;
  /** The field's text when the host seeds it (a suggestion chip). */
  value?: string;
  /** A valid person is chosen (or the choice is dropped: `null`). */
  onPick: (ref: PersonRef | null, name: string) => void;
  /** Return on a chosen person, or the New form's confirm. */
  onConfirm?: (ref: PersonRef, name: string, isNew: boolean) => void;
  /** The error under the field, from the host's command. */
  error?: string | null;
  disabled?: boolean;
  /** Esc with nothing to clear. */
  onClose?: () => void;
  /** A multi-select holds people that exist (no New person form, You included); picking adds a chip and keeps the list open. */
  multiple?: true;
  selected?: readonly PersonChip[];
  onChange?: (next: PersonChip[]) => void;
}

// @cpt-component:cpt-noter-component-ui-person-picker:p1
export function PersonPicker(p: PersonPickerProps) {
  const [query, setQuery] = useState(p.value ?? "");
  const [open, setOpen] = useState(p.variant === "popover");
  const [active, setActive] = useState<number | null>(null);
  const [form, setForm] = useState<string | null>(null);
  const list = useId();
  // the host reads the directory once and passes the rows down; a lone picker reads it itself
  const read = usePeople(p.bridge, p.people !== undefined);
  const people = (p.people !== undefined ? p.people : read) ?? null;
  useEffect(() => setQuery(p.value ?? ""), [p.value]);

  const cap = p.variant === "inline" ? CAP_INLINE : CAP_POPOVER;
  const multi = p.multiple === true;
  const chosen = p.selected ?? [];
  const all = useMemo(() => {
    const groups = candidates(p.participants, p.speakers, people, multi);
    if (!multi) return groups;
    const taken = new Set(chosen.map((c) => c.id));
    return groups.map((g) => ({ ...g, entries: g.entries.filter((e) => !taken.has(e.id)) })).filter((g) => g.entries.length);
  }, [p.participants, p.speakers, people, multi, chosen]);
  const groups = useMemo(() => matchPeople(query, all, cap), [query, all, cap]);
  const flat = groups.flatMap((g) => g.entries);
  const quoted = query.trim();
  const none = !!quoted && flat.length === 0;
  const newIndex = multi ? -1 : flat.length;
  const current = active ?? (quoted && flat.length ? 0 : none && !multi ? newIndex : -1);

  // a multi-select adds the chip, clears the field and stays open for the next person
  const add = (e: Entry) => {
    p.onChange?.([...chosen, { id: e.id, display_name: e.display_name, short_name: e.short_name, initials: e.initials, is_you: e.is_you ?? false }]);
    setQuery("");
    setActive(null);
  };
  const pick = (e: Entry) => {
    if (multi) return add(e);
    setQuery(e.display_name);
    setOpen(false);
    setActive(null);
    p.onPick(existing(e), e.display_name);
  };
  const openForm = () => !multi && setForm(quoted);
  const type = (v: string) => {
    setQuery(v);
    setOpen(true);
    setActive(null);
    p.onPick(null, v);
  };
  // @cpt-begin:cpt-noter-algo-ui-speakers-picker:p1:inst-focus
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return; // Return, Esc and arrows belong to the input method
    if (multi && e.key === "Backspace" && !query && chosen.length) {
      e.preventDefault();
      return p.onChange?.(chosen.slice(0, -1));
    }
    if (e.metaKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      openForm();
      return;
    }
    // the New person row is the last option in single mode; a multi-select ends at its last match
    const last = multi ? flat.length - 1 : newIndex;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive(stepActive(current, e.key === "ArrowDown" ? 1 : -1, last));
    } else if (e.key === "Enter" && open && current >= 0) {
      e.preventDefault();
      if (current === newIndex) return openForm();
      const entry = flat[current];
      pick(entry);
      // @cpt-begin:cpt-noter-algo-ui-speakers-picker:p1:inst-return
      if (!multi) p.onConfirm?.(existing(entry), entry.display_name, false);
      // @cpt-end:cpt-noter-algo-ui-speakers-picker:p1:inst-return
    } else if (e.key === "Escape" && query) {
      e.preventDefault(); // the first Esc clears, a second closes the host
      type("");
    } else if (e.key === "Escape") p.onClose?.();
  };
  // @cpt-end:cpt-noter-algo-ui-speakers-picker:p1:inst-focus

  if (form !== null)
    return (
      <NewPersonForm
        variant={p.variant}
        initial={form}
        people={people}
        confirmLabel={p.confirmLabel}
        error={p.error}
        disabled={p.disabled}
        onBack={(name) => {
          setQuery(name);
          setForm(null);
        }}
        onPick={p.onPick}
        onConfirm={p.onConfirm}
      />
    );

  const header = (key: string) =>
    t(key === "call" ? "speakers.group.call" : "speakers.group.recent");
  let n = -1;
  const option = (
    id: string,
    selected: boolean,
    onClick: () => void,
    children: React.ReactNode,
    cls?: string,
  ) => (
    <button
      key={id}
      type="button"
      role="option"
      id={id}
      aria-selected={selected}
      tabIndex={-1}
      className={cx("cw-pp__opt", selected && "is-sel", cls)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
  return (
    <div
      data-component="cpt-noter-component-ui-person-picker"
      data-variant={p.variant}
      data-state={none ? "no-match" : query ? "typing" : "empty"}
      className={cx("cw-pp", p.variant === "inline" && "cw-pp--field")}
    >
      {multi && chosen.length > 0 && (
        <span className="cw-pp__chips">
          {chosen.map((c) => (
            <span key={c.id} className="cw-pp__chip">
              <SharedChip variant={c.is_you ? "you" : "link"} initials={c.initials} name={c.is_you ? t("cw.speaker.you") : c.short_name} title={c.display_name} />
              <button type="button" className="cw-pp__x" aria-label={t("speakers.remove", { name: c.short_name })} onClick={() => p.onChange?.(chosen.filter((x) => x.id !== c.id))}>
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
        </span>
      )}
      <span className="np-field">
        <input
          className="np-field__input"
          type="text"
          role="combobox"
          aria-label={t("speakers.name_field")}
          aria-expanded={open}
          aria-controls={list}
          aria-activedescendant={
            open && current >= 0 ? `${list}-${current}` : undefined
          }
          aria-autocomplete="list"
          aria-invalid={p.error ? true : undefined}
          placeholder={t("speakers.name_field")}
          autoFocus={p.variant === "popover"}
          disabled={p.disabled}
          value={query}
          onChange={(e) => type(e.target.value)}
          onFocus={() => p.variant === "inline" && setOpen(true)}
          onBlur={() => p.variant === "inline" && setOpen(false)}
          onKeyDown={key}
        />
      </span>
      {p.error && (
        <span role="alert" className="cw-pp__err">
          {p.error}
        </span>
      )}
      {open && (
        <div
          id={list}
          role="listbox"
          aria-label={t("speakers.name_field")}
          className={cx(
            "cw-pp__list",
            p.variant === "inline" && "cw-pp__list--drop",
          )}
        >
          {/* @cpt-begin:cpt-noter-algo-ui-speakers-picker:p1:inst-empty */}
          {none && (
            <div className="cw-pp__none">
              {t("speakers.none", { query: quoted })}
            </div>
          )}
          {/* @cpt-end:cpt-noter-algo-ui-speakers-picker:p1:inst-empty */}
          {groups.map((g) => (
            <div key={g.key} role="group" aria-label={header(g.key)}>
              <div className="cw-pp__hdr" aria-hidden="true">
                {header(g.key)}
              </div>
              {g.entries.map((e) => {
                n += 1;
                const i = n;
                return option(
                  `${list}-${i}`,
                  i === current,
                  () => pick(e),
                  <>
                    <span className="np-person__ini" aria-hidden="true">
                      {e.initials}
                    </span>
                    <span className="cw-pp__optmain">
                      <span className="cw-pp__name">{e.display_name}</span>
                      {e.caption && (
                        <span className="cw-pp__role">{e.caption}</span>
                      )}
                    </span>
                  </>,
                );
              })}
            </div>
          ))}
          {!multi && option(
            `${list}-${newIndex}`,
            current === newIndex,
            openForm,
            <>
              <Icon name="plus" size={12} />
              {quoted
                ? t("speakers.new_q", { query: quoted })
                : t("speakers.new")}
            </>,
            "cw-pp__new",
          )}
        </div>
      )}
    </div>
  );
}
