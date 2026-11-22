import { describe, expect, it } from "vitest";

import { modelsLine, releaseNotesUrl } from "./updates";

// #1130, #1131 (cpt-noter-flow-ui-settings-change-setting)
describe("Updates pane", () => {
  it("links a release build to its tag and a development build to the releases list", () => {
    expect(releaseNotesUrl("0.24.2")).toBe("https://github.com/getahead/noter/releases/tag/v0.24.2");
    expect(releaseNotesUrl("dev")).toBe("https://github.com/getahead/noter/releases");
  });

  it("says the speech models are up to date, updating or need attention from the selected bundles", () => {
    expect(modelsLine([{ state: "ready" }, { state: "pending", selected: false }])).toBe("settings.updates.models_current");
    expect(modelsLine([{ state: "ready" }, { state: "downloading" }])).toBe("settings.updates.models_updating");
    expect(modelsLine([{ state: "ready" }, { state: "checksum_failed" }])).toBe("settings.updates.models_failed");
  });
});
