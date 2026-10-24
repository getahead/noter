import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DialogsProvider, useSheet } from "./host";
import { createSheets } from "./sheets";

describe("DialogsProvider (cpt-noter-flow-ui-dialogs-host-sheet)", () => {
  it("renders the open registered sheet after the page, and nothing when none is open", () => {
    const sheets = createSheets();
    sheets.register("x", ({ close, label }) => (
      <b data-x={String(label)} data-close={typeof close} />
    ));
    expect(
      renderToString(
        <DialogsProvider sheets={sheets}>
          <i />
        </DialogsProvider>,
      ),
    ).toBe("<i></i>");
    sheets.open("x", { label: "hi" });
    expect(
      renderToString(
        <DialogsProvider sheets={sheets}>
          <i />
        </DialogsProvider>,
      ),
    ).toBe('<i></i><b data-x="hi" data-close="function"></b>');
  });

  it("registers the Delete Old Audio sheet by default and gives features useSheet", () => {
    let host: ReturnType<typeof useSheet> | undefined;
    const Probe = () => ((host = useSheet()), null);
    renderToString(
      <DialogsProvider>
        <Probe />
      </DialogsProvider>,
    );
    expect(host!.component("delete-old-audio")).toBeDefined();
  });

  it("refuses useSheet outside the provider", () => {
    const Probe = () => (useSheet(), null);
    expect(() => renderToString(<Probe />)).toThrow("DialogsProvider");
  });
});
