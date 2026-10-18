// The attributes every primitive root carries (the prototype's base() in src/js/02-primitives.js):
// data-component, data-primitive and, where set, data-variant, data-size, data-state, data-region,
// the id and the help tag. Importing this module loads the component stylesheets, which hold the
// 24 by 24 pt hit area and the keyboard-only focus ring (styles/components/hit-area.css).
import "../../styles/components";

export const PRIM = "cpt-noter-component-ui-primitives";

/** Options every primitive takes: element id, extra class, help tag text and layout region. */
export interface Common {
  id?: string;
  cls?: string;
  help?: string;
  region?: string;
}

export interface BaseOptions extends Common {
  variant?: string;
  size?: string;
  state?: string;
}

/** Root attributes of a primitive; unset ones stay out of the markup, as in the prototype's attrs(). */
export function base(primitive: string, o: BaseOptions) {
  return {
    "data-component": PRIM,
    "data-primitive": primitive,
    "data-variant": o.variant,
    "data-size": o.size,
    "data-state": o.state,
    "data-region": o.region,
    id: o.id,
    title: o.help,
  };
}

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
