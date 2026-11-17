import { t } from "../../i18n/format";
import { registerPage } from "../shell/pages";
import { ThreadPage } from "./ThreadPage";
import { TopicsPage } from "./TopicsPage";
import { TopicsToolbar } from "./TopicsToolbar";
import { parseTopicKey } from "./topics-model";

// The Topics section (⌘5): its table at the root, a topic's thread at `topic:<id>`.
registerPage("topics", { title: () => t("topics.title"), render: (_route, bridge) => <TopicsPage bridge={bridge!} />, toolbar: TopicsToolbar, search: false });
registerPage(
  "topics",
  { title: () => t("topics.title"), render: (route, bridge) => <ThreadPage key={route.key} bridge={bridge!} topicId={parseTopicKey(route.key)!} /> },
  (route) => parseTopicKey(route.key) !== null,
);
