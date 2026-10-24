// MW-R4: the trailing inspector slot (Call info 280, Item inspector 320, Handoff drawer 400). It slides in over 250 ms
// and out over 250 ms, purely visual (D-13): the layer is inert while it leaves, focus returns to the opener at once,
// and Reduce Motion unmounts it immediately.
import { useEffect, useRef, useState } from "react";

import { t } from "../../i18n/format";
import { IconButton } from "../../ui/primitives/icon-button";
import type { Bridge } from "../../app/bridge/bridge";
import type { Route } from "./history";
import type { PageDef } from "./pages";
import { leaveTimer, openFocus } from "./shell-effects";

type Def = NonNullable<PageDef["inspector"]>;

export function InspectorSlot({ def, route, bridge, overlay, onClose }: { def: Def | undefined; route: Route; bridge: Bridge; overlay: boolean; onClose: () => void }) {
  const held = useRef(def);
  if (def) held.current = def;
  const leaving = !def && held.current !== undefined;
  const [, redraw] = useState(0);
  const ref = useRef<HTMLElement>(null);
  useEffect(
    () =>
      leaveTimer(leaving, () => {
        held.current = undefined;
        redraw((n) => n + 1);
      }),
    [leaving],
  );
  useEffect(() => openFocus(def !== undefined, ref.current ?? undefined, () => document.activeElement as HTMLElement | null), [def !== undefined]);
  const shown = held.current;
  if (!shown) return null;
  return (
    <aside
      ref={ref}
      className={["np-inspector", overlay && "is-overlay", leaving && "is-leaving"].filter(Boolean).join(" ")}
      data-region="MW-R4"
      data-state={leaving ? "leaving" : "open"}
      style={{ width: shown.width }}
      aria-label={t(shown.label)}
      aria-hidden={leaving || undefined}
      inert={leaving}
      tabIndex={-1}
    >
      <div className="np-inspector__close">
        <IconButton icon="x" label={t("shell.close_inspector")} size="inline" onAction={onClose} />
      </div>
      {shown.render(route, bridge)}
    </aside>
  );
}
