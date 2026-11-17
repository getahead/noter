import { navigate } from "../shell/navigate";
import type { Route } from "../shell/history";
import type { Bridge } from "../../app/bridge/bridge";

/** Opens a topic's thread (the Topics route `topic:<id>`), as the core's `nav:request` does. */
export const openTopic = (bridge: Bridge, id: string) =>
  void bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "topic", topic_id: id } }), { screen: "library-topics" });

// @cpt-begin:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-topic-ask
/** Ask About This (Thread): a new Ask thread scoped to the topic, which asks "What was decided and what is still open about <name>?" once (route `new-topic:<id>`). */
export const askTopicRoute = (id: string): Route => ({ section: "ask", key: `new-topic:${id}` });
export const askAboutTopic = (id: string) => navigate(askTopicRoute(id));
// @cpt-end:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-topic-ask
