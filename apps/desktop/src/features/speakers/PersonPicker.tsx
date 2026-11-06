// Person picker (DESIGN › Person picker; prototype src/js/20-b-components.js C.personPicker): a combobox over grouped
// people, a no-match line and the New person form in place. It returns a PersonRef; the host runs its command.
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";

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
import { PushButton } from "../../ui/primitives/push-button";
import {
  candidates,
  CAP_INLINE,
  CAP_POPOVER,
  created,
  existing,
  fold,
  matchPeople,
  validateNew,
  type Entry,
} from "./picker";
import "./speakers.css";

export interface PersonPickerProps {
  bridge: Bridge;
  variant: "inline" | "popover";
  /** The call's participants (In this call). */
  participants: readonly PersonChip[];
  speakers: readonly SpeakerView[];
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
  const [people, setPeople] = useState<readonly PersonRow[] | null>(null);
  const list = useId();
  useEffect(() => setQuery(p.value ?? ""), [p.value]);
  // Recent people come from M3's people_list: not_implemented leaves the group out
  useEffect(
    () =>
      void p.bridge
        .act("people:list", "people_list", () => p.bridge.core.peopleList({}), {
          named: { not_implemented: "no_directory" },
          screen: "person-picker",
        })
        .then((r) => setPeople(r.status === "ok" ? r.data.people : null)),
    [p.bridge],
  );

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
  const current = active ?? (none ? newIndex : -1);

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
      p.onConfirm?.(existing(entry), entry.display_name, false);
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
        onBack={() => setForm(null)}
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
          {none && (
            <div className="cw-pp__none">
              {t("speakers.none", { query: quoted })}
            </div>
          )}
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

interface NewFormProps extends Pick<
  PersonPickerProps,
  "variant" | "confirmLabel" | "error" | "disabled" | "onPick" | "onConfirm"
> {
  initial: string;
  people: readonly PersonRow[] | null;
  onBack: () => void;
}

/** The New person form, in place of the list: Name prefilled with the query, Email, Role, a duplicate check against the people. */
export function NewPersonForm(p: NewFormProps) {
  const [form, setForm] = useState<{
    name: string;
    email: string;
    role: string;
    shown: boolean;
    dup: Entry | null;
  }>({ name: p.initial, email: "", role: "", shown: false, dup: null });
  const people = p.people;
  // @cpt-begin:cpt-noter-algo-ui-speakers-picker:p1:inst-validate
  const errors = validateNew(form);
  // @cpt-end:cpt-noter-algo-ui-speakers-picker:p1:inst-validate
  const set = (patch: Partial<typeof form>) =>
    setForm({ ...form, ...patch, dup: null });
  const dupOf = () =>
    people?.find((x) => fold(x.display_name) === fold(form.name));
  // @cpt-begin:cpt-noter-algo-ui-speakers-picker:p1:inst-duplicate
  const submit = (anyway = false) => {
    setForm({ ...form, shown: true });
    if (errors.name || errors.email) return;
    const dup = dupOf();
    if (dup && !anyway)
      return setForm({
        ...form,
        shown: true,
        dup: {
          id: dup.id,
          display_name: dup.display_name,
          short_name: dup.short_name,
          initials: dup.initials,
          caption: dup.role ?? "",
        },
      });
    p.onConfirm?.(created(form), form.name.trim(), true);
  };
  // @cpt-end:cpt-noter-algo-ui-speakers-picker:p1:inst-duplicate
  const field = (
    name: "name" | "email" | "role",
    label: string,
    msg?: string,
    placeholder?: string,
  ) => (
    <label className="cw-pp__lbl">
      {label}
      <span className={cx("np-field", msg && form.shown && "is-invalid")}>
        <input
          className="np-field__input"
          type="text"
          aria-label={label}
          placeholder={placeholder}
          aria-invalid={(msg && form.shown) || undefined}
          value={form[name]}
          onChange={(e) => set({ [name]: e.target.value })}
          onBlur={() => set({ shown: true })}
          onKeyDown={(e) =>
            e.key === "Enter" &&
            !e.nativeEvent.isComposing &&
            (e.preventDefault(), submit())
          }
        />
      </span>
      {msg && form.shown && (
        <span role="alert" className="cw-pp__err">
          {t(msg as never)}
        </span>
      )}
    </label>
  );
  return (
    <div
      data-component="cpt-noter-component-ui-person-picker"
      data-variant={p.variant}
      data-state={
        form.dup
          ? "duplicate-found"
          : errors.name && form.shown
            ? "name-missing"
            : "new-person-form"
      }
      className="cw-pp cw-pp--form"
    >
      <h3 className="cw-pp__formtitle">{t("speakers.new.title")}</h3>
      {field("name", t("speakers.new.name"), errors.name)}
      {field(
        "email",
        t("speakers.new.email"),
        errors.email,
        t("speakers.new.email_ph"),
      )}
      {field(
        "role",
        t("speakers.new.role"),
        undefined,
        t("speakers.new.role_ph"),
      )}
      {form.dup && (
        <div className="cw-pp__dup" role="status">
          <Icon name="info" size={13} />
          <span>{t("speakers.new.dup", { name: form.dup.display_name })}</span>
          <span className="cw-pp__dupacts">
            <PushButton
              size="small"
              label={t("speakers.new.dup_use", { name: form.dup.short_name })}
              onAction={() => (
                p.onPick(existing(form.dup!), form.dup!.display_name),
                p.onConfirm?.(
                  existing(form.dup!),
                  form.dup!.display_name,
                  false,
                )
              )}
            />
            <PushButton
              size="small"
              variant="quiet"
              label={t("speakers.new.dup_anyway")}
              onAction={() => submit(true)}
            />
          </span>
        </div>
      )}
      {p.error && (
        <span role="alert" className="cw-pp__err">
          {p.error}
        </span>
      )}
      <div className="cw-pp__foot">
        <PushButton label={t("speakers.new.back")} onAction={p.onBack} />
        <PushButton
          label={p.confirmLabel}
          variant="primary"
          disabled={p.disabled}
          onAction={() => submit()}
        />
      </div>
    </div>
  );
}
