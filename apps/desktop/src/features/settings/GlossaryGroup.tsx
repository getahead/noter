import { useEffect, useRef, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { GlossaryTerm } from "../../core/bindings";
import { t } from "../../i18n/format";
import { IconButton } from "../../ui/primitives/icon-button";
import { PushButton } from "../../ui/primitives/push-button";
import { Table, Th } from "../../ui/primitives/table";
import { TextField } from "../../ui/primitives/text-field";
import { Group } from "./form";
import { cell, createGlossaryActions, EMPTY_FORM, listTerms, newTermArgs, type TermForm } from "./glossary";

/** **Glossary**: the terms of `glossary_list`, **+** adds one, **−** removes the selected one. */
export function GlossaryGroup({ bridge }: { bridge: Bridge }) {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<TermForm | null>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void listTerms(bridge).then((list) => list && setTerms(list));
  }, [bridge]);

  const { add, remove } = createGlossaryActions(bridge, { form, selected, setTerms, setForm, setSelected });

  const field = (key: keyof TermForm, label: string) => <TextField ariaLabel={label} placeholder={label} value={form![key]} onChange={(v) => setForm({ ...form!, [key]: v })} onEnter={() => void add()} />;
  return (
    <Group
      title={t("settings.glossary.title")}
      foot={
        <>
          <IconButton icon="plus" label={t("settings.glossary.add")} size="inline" onAction={() => setForm(EMPTY_FORM)} />
          <IconButton icon="minus" label={t("settings.glossary.remove")} size="inline" disabled={!selected} onAction={() => void remove()} />
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
          {terms.map((g) => (
            <tr key={g.id} tabIndex={0} aria-selected={g.id === selected} onClick={() => setSelected(g.id)} onFocus={() => setSelected(g.id)}>
              <td>{g.term}</td>
              <td>{cell(g.variants_latin)}</td>
              <td lang="ru">{cell(g.variants_cyrillic)}</td>
              <td>{cell(g.spoken_forms)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {form && (
        <div className="st-inline st-glossary-form" role="group" aria-label={t("settings.glossary.add")}>
          {field("term", t("settings.glossary.term"))}
          {field("latin", t("settings.glossary.latin"))}
          {field("cyrillic", t("settings.glossary.cyrillic"))}
          {field("spoken", t("settings.glossary.spoken"))}
          <PushButton label={t("settings.glossary.save")} size="small" variant="primary" disabled={!newTermArgs(form)} onAction={() => void add()} />
          <PushButton label={t("settings.glossary.cancel")} size="small" onAction={() => setForm(null)} />
        </div>
      )}
    </Group>
  );
}
