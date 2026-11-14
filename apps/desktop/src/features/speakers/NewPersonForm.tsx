// New person form for the person picker: validation, duplicate resolution and creation.
import { useState } from "react";

import type { PersonRef, PersonRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import { cx } from "../../ui/primitives/attrs";
import { Icon } from "../../ui/icons";
import { PushButton } from "../../ui/primitives/push-button";
import { created, existing, fold, validateNew, type Entry } from "./picker";
import "./speakers.css";

export interface NewPersonFormProps {
  variant: "inline" | "popover";
  confirmLabel: string;
  error?: string | null;
  disabled?: boolean;
  onPick: (ref: PersonRef | null, name: string) => void;
  onConfirm?: (ref: PersonRef, name: string, isNew: boolean) => void;
  initial: string;
  people: readonly PersonRow[] | null;
  onBack: (name: string) => void;
}

/** The New person form, in place of the list: Name prefilled with the query, Email, Role, a duplicate check against the people. */
export function NewPersonForm(p: NewPersonFormProps) {
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
    // @cpt-begin:cpt-noter-algo-ui-speakers-picker:p1:inst-return
    // @cpt-begin:cpt-noter-flow-ui-speakers-live-name:p1:inst-new
    p.onConfirm?.(created(form), form.name.trim(), true);
    // @cpt-end:cpt-noter-flow-ui-speakers-live-name:p1:inst-new
    // @cpt-end:cpt-noter-algo-ui-speakers-picker:p1:inst-return
  };
  // @cpt-end:cpt-noter-algo-ui-speakers-picker:p1:inst-duplicate
  const field = (
    name: "name" | "email" | "role",
    label: string,
    msg?: string,
    placeholder?: string,
    disabled = false,
  ) => (
    <label className="cw-pp__lbl">
      {label}
      <span className={cx("np-field", msg && form.shown && "is-invalid")}>
        <input
          className="np-field__input"
          type="text"
          aria-label={label}
          autoFocus={name === "name"} // the combobox that had focus unmounted with the list
          disabled={p.disabled || disabled}
          placeholder={placeholder}
          aria-invalid={(msg && form.shown) || undefined}
          value={form[name]}
          onChange={(e) => set({ [name]: e.target.value })}
          onBlur={() => setForm((f) => ({ ...f, shown: true }))}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Escape") {
              e.preventDefault();
              p.onBack(form.name);
            } else if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
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
      {field("role", t("speakers.new.role"), undefined, t("speakers.new.role_ph"), true)}
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
        <PushButton label={t("speakers.new.back")} onAction={() => p.onBack(form.name)} />
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
