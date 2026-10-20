import type { NavTarget } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import type { IconName } from "../../ui/icons";
import type { Route, SectionKey } from "./history";

export interface Section {
  key: SectionKey;
  label: MsgKey;
  icon: IconName;
  /** ⌘1 to ⌘8. */
  digit: number;
}

/** The sidebar's eight sections in their three groups (the prototype's SECTIONS). */
export const GROUPS: ReadonlyArray<{ title: MsgKey | null; sections: readonly Section[] }> = [
  {
    title: null,
    sections: [
      { key: "today", label: "section.today", icon: "sun", digit: 1 },
      { key: "ask", label: "section.ask", icon: "bubble", digit: 2 },
    ],
  },
  {
    title: "group.library",
    sections: [
      { key: "library", label: "section.library", icon: "list", digit: 3 },
      { key: "people", label: "section.people", icon: "people", digit: 4 },
      { key: "topics", label: "section.topics", icon: "thread", digit: 5 },
    ],
  },
  {
    title: "group.workspace",
    sections: [
      { key: "activity", label: "section.activity", icon: "inbox", digit: 6 },
      { key: "agents", label: "section.agents", icon: "agent", digit: 7 },
      { key: "performance", label: "section.performance", icon: "gauge", digit: 8 },
    ],
  },
];

export const SECTIONS: readonly Section[] = GROUPS.flatMap((g) => g.sections);

export const sectionOf = (key: SectionKey): Section => SECTIONS.find((s) => s.key === key)!;

/** Return in the search field opens Library › Search results (its page arrives with M3). */
export const searchRoute = (query: string): Route => ({ section: "library", key: ["search", query].join(":") });

/** Where a `nav:request` of the core lands in the main window, or null when another window shows it (Settings, first run). */
export function navRoute(target: NavTarget): Route | null {
  switch (target.type) {
    case "today":
    case "ask":
    case "activity":
    case "agents":
    case "performance":
      return { section: target.type, key: "root" };
    case "call_page":
      return { section: "library", key: ["call", target.call_id, target.tab].join(":") };
    case "item":
      return { section: "activity", key: ["item", target.item_id].join(":") };
    case "person":
      return { section: "people", key: ["person", target.person_id].join(":") };
    case "topic":
      return { section: "topics", key: ["topic", target.topic_id].join(":") };
    case "settings":
    case "first_run":
      return null;
  }
}
