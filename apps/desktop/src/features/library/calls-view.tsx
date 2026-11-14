import {
  useEffect,
  useMemo,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
} from "react";
import type { CallRow, UiPrefs } from "../../core/bindings";
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
  selected: ReadonlySet<string>;
  /** The first read has taken longer than 300 ms: skeleton rows. */
  slow: boolean;
  failed: string | null;
  selfTestPassed: boolean;
  /** The core's time zone and 12/24-hour setting. */
  prefs?: UiPrefs;
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

const selectedRows = (rows: CallRow[], selected: ReadonlySet<string>) =>
  rows.filter((r) => selected.has(r.id));

/** Library › Calls as the prototype draws it: LC-R1 (title and counts) and LC-R3 (table, empty state, skeleton or error). */
export function CallsView(p: CallsViewProps) {
  const { state, selection } = p;
  const chosen = selectedRows(state.rows, p.selected);
  return (
    <>
      <div data-region="LC-R1" className="lb-head">
        <h2 className="lb-title" tabIndex={-1}>
          {t("library.calls.title")}
        </h2>{" "}
        {state.status === "LISTED" &&
          subtitle(
            state.rows,
            state.total ?? state.rows.length,
            chosen.length,
            p.prefs?.time_zone || undefined,
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
        // @cpt-begin:cpt-noter-state-ui-library-calls-list:p1:inst-listed-several
        // @cpt-begin:cpt-noter-state-ui-library-calls-list:p1:inst-several-listed
        data-state={chosen.length > 1 ? "selected-several" : state.status.toLowerCase()}
        // @cpt-end:cpt-noter-state-ui-library-calls-list:p1:inst-several-listed
        // @cpt-end:cpt-noter-state-ui-library-calls-list:p1:inst-listed-several
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
  const { state, selected } = p;
  const groups = useMemo(
    () => groupByMonth(state.rows, undefined, p.prefs?.time_zone || undefined),
    [state.rows, p.prefs?.time_zone],
  );
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
  // @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-if-empty
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
  // @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-if-empty
  if (state.status === "LOADING")
    // the area keeps its place (and says it is busy) from the first moment; the skeleton rows follow after 300 ms
    return (
      <div
        className="lb-loading"
        data-state="loading"
        aria-busy="true"
        aria-label={t("library.calls.loading")}
      >
        {p.slow && (
          <div
            className="lb-skel"
            data-component="cpt-noter-component-ui-primitives"
            data-primitive="table"
          >
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="lb-skel__row">
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  const stopId = state.rows.find((c) => selected.has(c.id))?.id ?? groups[0]?.rows[0]?.id;
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
          {groups.flatMap((g) => [
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
                selected={selected.has(c.id)}
                stop={c.id === stopId}
                onPress={p.onPress}
                onOpen={p.onOpen}
                onContext={p.onContext}
                prefs={p.prefs}
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
