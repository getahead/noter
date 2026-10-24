import {
  useEffect,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
} from "react";
import type { CallRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { Menu } from "../../ui/primitives/menu";
import { Table, Th } from "../../ui/primitives/table";
import { CallRowView } from "./call-row";
import type { CallsState } from "./calls-list";
import { groupByMonth, sortOf, subtitle, type Column } from "./calls-model";
import type { Selection } from "./selection";
import "./library.css";

export const COLUMNS = {
  when: "library.col.when",
  call: "library.col.call",
  length: "library.col.length",
} as const satisfies Record<Column, string>;

export interface CallsViewProps {
  state: CallsState;
  selection: Selection;
  /** The first read has taken longer than 300 ms: skeleton rows. */
  slow: boolean;
  failed: string | null;
  selfTestPassed: boolean;
  menu: { x: number; y: number } | null;
  sentinel?: Ref<HTMLDivElement>;
  onSort: (col: Column) => void;
  onPress: (id: string, e: MouseEvent) => void;
  onOpen: (id: string) => void;
  onContext: (id: string, e: MouseEvent) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onRetry: () => void;
  onSelfTest: () => void;
  onDismissFailed: () => void;
  onCloseMenu: () => void;
  onDelete: () => void;
}

const selectedRows = (rows: CallRow[], s: Selection) =>
  rows.filter((r) => s.ids.includes(r.id));

/** Library › Calls as the prototype draws it: LC-R1 (title and counts) and LC-R3 (table, empty state, skeleton or error). */
export function CallsView(p: CallsViewProps) {
  const { state, selection } = p;
  const chosen = selectedRows(state.rows, selection);
  return (
    <>
      <div data-region="LC-R1" className="lb-head">
        <strong>{t("library.calls.title")}</strong>{" "}
        {state.status === "LISTED" &&
          subtitle(
            state.rows,
            state.total ?? state.rows.length,
            selection.ids.length,
          )}
      </div>
      {p.failed && (
        <InlineBanner
          banner={{
            id: "calls-delete-failed",
            severity: "error",
            text: p.failed,
          }}
          onDismiss={p.onDismissFailed}
        />
      )}
      <div
        data-region="LC-R3"
        role="region"
        aria-label={t("library.calls.title")}
      >
        <Body {...p} />
      </div>
      {p.menu && (
        <div className="lb-ctx" style={{ left: p.menu.x, top: p.menu.y }}>
          <ContextMenu
            onClose={p.onCloseMenu}
            single={chosen.length === 1 ? chosen[0]! : null}
            onOpen={p.onOpen}
            onDelete={p.onDelete}
          />
        </div>
      )}
    </>
  );
}

function Body(p: CallsViewProps) {
  const { state, selection } = p;
  if (state.status === "ERROR")
    return (
      <InlineBanner
        banner={{
          id: "calls-error",
          severity: "error",
          text: t("library.calls.error"),
          actions: [{ label: t("action.try_again"), onAction: p.onRetry }],
        }}
      />
    );
  // @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-empty
  if (state.status === "EMPTY")
    return (
      <EmptyState
        variant="first-use"
        icon="list"
        title={t("library.calls.empty_title")}
        body={t("library.calls.empty_body")}
        actionLabel={
          p.selfTestPassed ? undefined : t("library.calls.self_test")
        }
        onAction={p.onSelfTest}
      />
    );
  // @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-empty
  if (state.status === "LOADING")
    return p.slow ? (
      <div
        className="lb-skel"
        data-component="cpt-noter-component-ui-primitives"
        data-primitive="table"
        data-state="loading"
        aria-busy="true"
        aria-label={t("library.calls.loading")}
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="lb-skel__row">
            <span />
            <span />
            <span />
          </div>
        ))}
      </div>
    ) : null;
  const head = (col: Column, width: string) => (
    <Th
      label={t(COLUMNS[col])}
      sort={sortOf(state.sort, col)}
      width={width}
      cls="lb-th"
      onSort={() => p.onSort(col)}
    />
  );
  return (
    <>
      <Table
        variant="sortable"
        label={t("library.calls.title")}
        cls="lb-table"
        wrapCls="lb-tablewrap"
      >
        <thead>
          <tr>
            {head("when", "120px")}
            {head("call", "")}
            <th scope="col" style={{ width: "120px" }}>
              {t("library.col.type")}
            </th>
            {head("length", "80px")}
            <th scope="col" style={{ width: "60px" }}>
              {t("library.col.open")}
            </th>
            <th scope="col" style={{ width: "200px" }}>
              <span className="np-sr">{t("library.col.status")}</span>
            </th>
            <th style={{ width: "36px" }}>
              <span className="np-sr">{t("library.col.open")}</span>
            </th>
          </tr>
        </thead>
        <tbody onKeyDown={p.onKeyDown}>
          {groupByMonth(state.rows).flatMap((g) => [
            <tr
              key={g.label}
              className="lb-month"
              data-variant="sticky-group-header"
            >
              <th colSpan={7} scope="rowgroup">
                {g.label}
              </th>
            </tr>,
            ...g.rows.map((c) => (
              <CallRowView
                key={c.id}
                call={c}
                selected={selection.ids.includes(c.id)}
                onPress={(e) => p.onPress(c.id, e)}
                onOpen={() => p.onOpen(c.id)}
                onContext={(e) => p.onContext(c.id, e)}
              />
            )),
          ])}
        </tbody>
      </Table>
      <div ref={p.sentinel} aria-hidden="true" />
    </>
  );
}

export function ContextMenu({
  onClose,
  single,
  onOpen,
  onDelete,
}: {
  onClose: () => void;
  single: CallRow | null;
  onOpen: (id: string) => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    document.addEventListener("pointerdown", onClose);
    return () => document.removeEventListener("pointerdown", onClose);
  }, [onClose]);
  const run = (f: () => void) => () => (onClose(), f());
  return (
    <div onPointerDown={(e) => e.stopPropagation()}>
      <Menu
        variant="context-menu"
        onClose={onClose}
        items={[
          {
            label: t("library.menu.open"),
            disabled: !single,
            onSelect: run(() => single && onOpen(single.id)),
          },
          { divider: true },
          {
            label: t("library.menu.delete"),
            kbd: "⌘⌫",
            destructive: true,
            onSelect: run(onDelete),
          },
        ]}
      />
    </div>
  );
}
