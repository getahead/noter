// One `people_list` read per window for every picker on the page (Recent people). M3 owns the command: until then the
// real core answers not_implemented and the group stays out (`null`).
import { useEffect, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { PersonRow } from "../../core/bindings";

const reads = new WeakMap<Bridge, Promise<readonly PersonRow[] | null>>();

/** The people of the window's directory, read once per bridge. */
export function readPeople(bridge: Bridge): Promise<readonly PersonRow[] | null> {
  let read = reads.get(bridge);
  if (!read) {
    read = bridge
      .act("people:list", "people_list", () => bridge.core.peopleList({}), { named: { not_implemented: "no_directory" }, screen: "person-picker" })
      .then((r) => (r.status === "ok" ? r.data.people : null));
    reads.set(bridge, read);
  }
  return read;
}

/** A person was created from a picker: the next read is a new one. */
export const forgetPeople = (bridge: Bridge) => void reads.delete(bridge);

/** `skip` leaves the read to a host that passes the rows down; `undefined` while it loads. */
export function usePeople(bridge: Bridge, skip = false): readonly PersonRow[] | null | undefined {
  const [people, setPeople] = useState<readonly PersonRow[] | null | undefined>(undefined);
  useEffect(() => void (!skip && readPeople(bridge).then(setPeople)), [bridge, skip]);
  return people;
}
