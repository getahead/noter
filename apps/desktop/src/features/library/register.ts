import { createElement } from "react";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { registerPage } from "../shell/pages";
import { CallsPage } from "./calls-page";

// @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-user-open
/** The Library section's root page is the Calls view (⌘3); the call and search routes belong to later features. */
registerPage("library", {
  title: () => t("library.calls.title"),
  render: (route) =>
    route.key === "root"
      ? createElement(CallsPage)
      : createElement(EmptyState, {
          variant: "large",
          heading: true,
          icon: "wand",
          title: t("section.empty_title", { section: t("section.library") }),
          body: t("section.empty_body"),
        }),
});
// @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-user-open
