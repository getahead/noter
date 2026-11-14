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
  type Entry,
} from "./picker";
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
  const all = useMemo(
    () => candidates(p.participants, p.speakers, people),
    [p.participants, p.speakers, people],
  );
  const groups = useMemo(() => matchPeople(query, all, cap), [query, all, cap]);
  const flat = groups.flatMap((g) => g.entries);
  const quoted = query.trim();
  const none = !!quoted && flat.length === 0;
  const newIndex = flat.length;
  const current = active ?? (quoted && flat.length ? 0 : none ? newIndex : -1);

  const pick = (e: Entry) => {
    setQuery(e.display_name);
    setOpen(false);
    setActive(null);
    p.onPick(existing(e), e.display_name);
  };
  const openForm = () => setForm(quoted);
  const type = (v: string) => {
    setQuery(v);
    setOpen(true);
    setActive(null);
    p.onPick(null, v);
  };
  // @cpt-begin:cpt-noter-algo-ui-speakers-picker:p1:inst-focus
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return; // Return, Esc and arrows belong to the input method
    if (e.metaKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      openForm();
      return;
    }
    const last = newIndex;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive(
        Math.min(
          last,
          Math.max(
            0,
            (current < 0 ? (step > 0 ? -1 : last + 1) : current) + step,
          ),
        ),
      );
    } else if (e.key === "Enter" && open && current >= 0) {
      e.preventDefault();
      if (current === newIndex) return openForm();
      const entry = flat[current];
      pick(entry);
      // @cpt-begin:cpt-noter-algo-ui-speakers-picker:p1:inst-return
      p.onConfirm?.(existing(entry), entry.display_name, false);
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
          {option(
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
