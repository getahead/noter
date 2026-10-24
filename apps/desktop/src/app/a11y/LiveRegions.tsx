import type { CSSProperties } from "react";

const hidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

/** The window's two live regions, visually hidden; `announce` writes into them. */
export function LiveRegions() {
  return (
    <>
      <div
        data-live="polite"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={hidden}
      />
      <div
        data-live="assertive"
        aria-live="assertive"
        aria-atomic="true"
        style={hidden}
      />
    </>
  );
}
