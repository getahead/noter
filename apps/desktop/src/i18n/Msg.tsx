import { tParts, type Arg } from "./format";
import type { MsgKey } from "./en";

/** An interface string from the catalogue; quoted user text keeps its own `lang`. */
export function Msg({ id, args }: { id: MsgKey; args?: Record<string, Arg> }) {
  return tParts(id, args).map((p, i) =>
    p.lang ? (
      <span key={i} lang={p.lang}>
        {p.text}
      </span>
    ) : (
      p.text
    ),
  );
}
