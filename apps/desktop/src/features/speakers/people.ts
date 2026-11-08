// One `people_list` read per window for every picker on the page (Recent people). M3 owns the command: until then the
// real core answers not_implemented and the group stays out (`null`).
import { useEffect, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { PersonRow } from "../../core/bindings";

const reads = new WeakMap<Bridge, { seen: unknown; read: Promise<readonly PersonRow[] | null> }>();

/** The people of the window's directory, read once per bridge and again when `seen` (the store's people) changes; a failed read is not kept. */
export function readPeople(
  bridge: Bridge,
  seen?: unknown,
): Promise<readonly PersonRow[] | null> {
  const held = reads.get(bridge);
  if (held && held.seen === seen) return held.read;
  const read = bridge
    .act("people:list", "people_list", () => bridge.core.peopleList({}), {
      named: { not_implemented: "no_directory" },
      screen: "person-picker",
    })
    .then((r) => {
      if (r.status === "ok") return r.data.people;
      if (reads.get(bridge)?.read === read) reads.delete(bridge);
      return null;
    });
  reads.set(bridge, { seen, read });
  return read;
}

/** `skip` leaves the read to a host that passes the rows down; `undefined` while it loads. */
export function usePeople(
  bridge: Bridge,
  skip = false,
): readonly PersonRow[] | null | undefined {
  const [people, setPeople] = useState<readonly PersonRow[] | null | undefined>(
    undefined,
  );
  const known = useWindow(bridge, (s) => s.entities.person);
  useEffect(
    () => void (!skip && readPeople(bridge, known).then(setPeople)),
    [bridge, skip, known],
  );
  return people;
}
