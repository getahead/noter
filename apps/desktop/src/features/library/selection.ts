// Row selection of the Calls table, as a macOS table does it: click, ⌘-click, ⇧-click, ⌘A, ⇧↑ and ⇧↓.
export interface Selection {
  ids: string[];
  /** The row a ⇧-range starts from. */
  anchor: string | null;
}
export interface Mods {
  meta?: boolean;
  shift?: boolean;
  /** A right-click: a selected row keeps the selection, an unselected one replaces it. */
  context?: boolean;
}

export const NONE: Selection = { ids: [], anchor: null };

const range = (order: string[], a: string, b: string) => {
  const [i, j] = [order.indexOf(a), order.indexOf(b)];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
};

// @cpt-begin:cpt-noter-flow-ui-library-calls-delete:p1:inst-user-select
export function press(
  sel: Selection,
  order: string[],
  id: string,
  m: Mods,
): Selection {
  if (m.context) return sel.ids.includes(id) ? sel : { ids: [id], anchor: id };
  if (m.shift && sel.anchor && order.includes(sel.anchor))
    return { ids: range(order, sel.anchor, id), anchor: sel.anchor };
  if (m.meta)
    return {
      ids: sel.ids.includes(id)
        ? sel.ids.filter((x) => x !== id)
        : [...sel.ids, id],
      anchor: id,
    };
  return { ids: [id], anchor: id };
}

export const selectAll = (order: string[]): Selection => ({
  ids: [...order],
  anchor: order[0] ?? null,
});

/** The selected row farthest from the anchor: the one ⇧↑ and ⇧↓ move, and keyboard focus follows. */
export function edgeOf(sel: Selection, order: string[]): string | undefined {
  const anchor =
    sel.anchor && order.includes(sel.anchor) ? sel.anchor : sel.ids[0];
  if (!anchor) return undefined;
  const a = order.indexOf(anchor);
  return order[
    sel.ids.reduce(
      (far, id) =>
        Math.abs(order.indexOf(id) - a) > Math.abs(far - a)
          ? order.indexOf(id)
          : far,
      a,
    )
  ];
}

/** ⇧↑ (-1) and ⇧↓ (1): moves the edge opposite the anchor by one row. */
export function extend(
  sel: Selection,
  order: string[],
  dir: 1 | -1,
): Selection {
  if (!order.length) return sel;
  if (!sel.ids.length) return { ids: [order[0]!], anchor: order[0]! };
  const anchor =
    sel.anchor && order.includes(sel.anchor) ? sel.anchor : sel.ids[0]!;
  const next = Math.min(
    order.length - 1,
    Math.max(0, order.indexOf(edgeOf(sel, order)!) + dir),
  );
  return { ids: range(order, anchor, order[next]!), anchor };
}
// @cpt-end:cpt-noter-flow-ui-library-calls-delete:p1:inst-user-select
