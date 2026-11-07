// The Transcript's note for an evidence span the archive pass rewrote: what changed, and the words before and after.
import { useState } from "react";

import type { ArchiveChange } from "../../core/bindings";
import { t } from "../../i18n/format";
import { DiffView } from "../../ui/diff/DiffView";

export type ArchiveNote = { change: ArchiveChange | null };

// @cpt-flow:cpt-noter-flow-ui-items-evidence:p1
export function ArchiveNotice({ note }: { note: ArchiveNote }) {
  const [show, setShow] = useState(false);
  return (
    <div className="cw-archive-note" data-component="cpt-noter-component-ui-archive-notice">
      <span role="status" className="np-dim">
        {t("transcript.archive_changed")}
        {note.change && <> <button type="button" className="np-link" aria-pressed={show} onClick={() => setShow(!show)}>{t(show ? "transcript.archive_hide" : "transcript.archive_show")}</button></>}
      </span>
      {show && note.change && <DiffView before={note.change.before} after={note.change.after} />}
    </div>
  );
}
