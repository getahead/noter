import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { setPersonStatus, usePersonStatus } from "./person-store";

const Line = ({ id }: { id: string }) => <p>{usePersonStatus(id) ?? "none"}</p>;

describe("cpt-noter-flow-ui-people-voice-profile status line", () => {
  it("Voice profile created shows on that person's page and not on another's", () => {
    setPersonStatus({ id: "per_anna", text: "Voice profile created for Anna K." });
    expect(renderToString(<Line id="per_anna" />)).toContain("Voice profile created for Anna K.");
    expect(renderToString(<Line id="per_pavel" />)).toContain("none");
    setPersonStatus(null);
    expect(renderToString(<Line id="per_anna" />)).toContain("none");
  });
});
