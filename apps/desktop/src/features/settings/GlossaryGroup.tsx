import { useEffect, useRef, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { focusFirstAvailable } from "../../app/a11y/focus";
import type { GlossaryTerm } from "../../core/bindings";
import { t } from "../../i18n/format";
import { IconButton } from "../../ui/primitives/icon-button";
import { PushButton } from "../../ui/primitives/push-button";
import { Table, Th } from "../../ui/primitives/table";
import { TextField } from "../../ui/primitives/text-field";
import { Group } from "./form";
import { cell, createGlossaryActions, EMPTY_FORM, listTerms, newTermArgs, type TermForm } from "./glossary";
import { useWindow } from "../../app/use-window";

/** **Glossary**: the terms of `glossary_list`, **+** adds one, **−** removes the selected one. */
export function GlossaryGroup({ bridge }: { bridge: Bridge }) {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<TermForm | null>(null);
  const [editing, setEditing] = useState<GlossaryTerm | null>(null);
  const commands = useWindow(bridge, (s) => s.commands);
  const listFailed = commands["glossary:list"]?.state === "ERROR";
  const mutationFailed = commands["glossary:upsert"]?.state === "ERROR" || commands["glossary:remove"]?.state === "ERROR";
  const asked = useRef(false);
  const focusAfterRemove = useRef<number | null>(null);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void listTerms(bridge).then((list) => list && setTerms(list));
  }, [bridge]);
  useEffect(() => {
    const index = focusAfterRemove.current;
    if (index === null) return;
    focusAfterRemove.current = null;
    const next = Math.min(index, terms.length - 1);
    focusFirstAvailable(document, [...(next >= 0 ? ["g" + next] : []), "glossary-add"]);
  }, [terms]);

  const { add, remove } = createGlossaryActions(bridge, { form, selected, editing, setTerms, setForm, setSelected, setEditing });
  const edit = () => { const term = terms.find((item) => item.id === selected); if (!term) return; setEditing(term); setForm({ term: term.term, latin: term.variants_latin.join(", "), cyrillic: term.variants_cyrillic.join(", "), spoken: term.spoken_forms.join(", ") }); };
  const removeSelected = async () => {
    const index = terms.findIndex((term) => term.id === selected);
    const restore = document.activeElement?.id === "glossary-remove";
    if (restore && index >= 0) focusAfterRemove.current = index;
    if (!(await remove())) focusAfterRemove.current = null;
  };
  return (
    <Group
      title={t("settings.glossary.title")}
      foot={
        <>
          <IconButton id="glossary-add" icon="plus" label={t("settings.glossary.add")} size="inline" onAction={() => setForm(EMPTY_FORM)} />
          <PushButton label={t("settings.glossary.edit")} size="small" disabled={!selected} onAction={edit} />
          <IconButton id="glossary-remove" icon="minus" label={t("settings.glossary.remove")} size="inline" disabled={!selected} onAction={() => void removeSelected()} />
          <span className="np-dim">{t("settings.glossary.note")}</span>
        </>
      }
    >
      <Table variant="sortable" label={t("settings.glossary.title")}>
        <thead>
          <tr>
            <Th label={t("settings.glossary.term")} />
            <Th label={t("settings.glossary.latin")} />
            <Th label={t("settings.glossary.cyrillic")} />
            <Th label={t("settings.glossary.spoken")} />
          </tr>
        </thead>
        <tbody>
          <TermRows terms={terms} selected={selected} onSelect={setSelected} onEdit={edit} />
        </tbody>
      </Table>
      {form && (
        <GlossaryForm form={form} editing={editing} mutationFailed={mutationFailed} onChange={(key, value) => setForm({ ...form, [key]: value })} onSave={() => void add()} onCancel={() => { setEditing(null); setForm(null); }} />
      )}
      {mutationFailed && !form && <p className="hd__err" role="alert">{t("settings.glossary.update_failed")}</p>}
      {listFailed && <p className="hd__err" role="alert">{t("settings.glossary.read_failed")} <PushButton label={t("action.try_again")} size="small" onAction={() => void listTerms(bridge).then((list) => list && setTerms(list))} /></p>}
    </Group>
  );
}

export function GlossaryForm({ form, editing, mutationFailed, onChange, onSave, onCancel }: { form: TermForm; editing: GlossaryTerm | null; mutationFailed: boolean; onChange: (key: keyof TermForm, value: string) => void; onSave: () => void; onCancel: () => void }) {
  const field = (key: keyof TermForm, label: string) => <TextField ariaLabel={label} placeholder={label} value={form[key]} onChange={(value) => onChange(key, value)} onEnter={onSave} />;
  return (
    <div className="st-inline st-glossary-form" role="group" aria-label={t(editing ? "settings.glossary.edit" : "settings.glossary.add")}>
      {field("term", t("settings.glossary.term"))}
      {field("latin", t("settings.glossary.latin"))}
      {field("cyrillic", t("settings.glossary.cyrillic"))}
      {field("spoken", t("settings.glossary.spoken"))}
      <PushButton label={t(editing ? "settings.glossary.edit_save" : "settings.glossary.save")} size="small" variant="primary" disabled={!newTermArgs(form, editing ?? undefined)} onAction={onSave} />
      <PushButton label={t("settings.glossary.cancel")} size="small" onAction={onCancel} />
      {mutationFailed && <p className="hd__err" role="alert">{t("settings.glossary.update_failed")}</p>}
    </div>
  );
}

/** The table's one Tab stop is the selected term, else the first; the others are reached with ↑/↓. */
export function TermRows({ terms, selected, onSelect, onEdit }: { terms: GlossaryTerm[]; selected: string | null; onSelect: (id: string) => void; onEdit?: () => void }) {
  return (
    <>
      {terms.map((g, i) => (
        <tr key={g.id} id={"g" + i} tabIndex={g.id === selected || (!selected && i === 0) ? 0 : -1} aria-selected={g.id === selected} onClick={() => onSelect(g.id)} onFocus={() => onSelect(g.id)} onDoubleClick={onEdit} onKeyDown={(event) => { if (event.key === "Enter") onEdit?.(); }}>
          <td lang="und">{g.term}</td>
          <td lang="und">{cell(g.variants_latin)}</td>
          <td lang="ru">{cell(g.variants_cyrillic)}</td>
          <td lang="und">{cell(g.spoken_forms)}</td>
        </tr>
      ))}
    </>
  );
}
