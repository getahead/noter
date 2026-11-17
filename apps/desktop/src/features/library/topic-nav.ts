import type { Bridge } from "../../app/bridge/bridge";

/** Opens a topic's thread (the Topics route `topic:<id>`), as the core's `nav:request` does. */
export const openTopic = (bridge: Bridge, id: string) =>
  void bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "topic", topic_id: id } }), { screen: "library-topics" });
