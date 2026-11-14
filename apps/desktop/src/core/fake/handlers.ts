// Default fake-core handlers, assembled by domain so each section stays reviewable.
import type { FakeCore, Handlers } from "./fake-core";
import { appHandlers } from "./handlers/app";
import { captureHandlers } from "./handlers/capture";
import { transcriptHandlers } from "./handlers/transcript";
import { copilotHandlers } from "./handlers/copilot";
import { itemsHandlers } from "./handlers/items";
import { todayHandlers } from "./handlers/today";
import { outputsHandlers } from "./handlers/outputs";
import { handoffHandlers } from "./handlers/handoff";
import { libraryHandlers } from "./handlers/library-search-ask-topics";
import { historyHandlers } from "./handlers/history-undo";
import { peopleHandlers } from "./handlers/people";
import { agentsHandlers } from "./handlers/agents";
import { settingsHandlers } from "./handlers/settings-credentials";
import { performanceHandlers } from "./handlers/performance";
import { firstRunHandlers } from "./handlers/first-run-permissions";
import { windowsHandlers } from "./handlers/windows";

export function createDefaultHandlers(fake: FakeCore): Handlers {
  return {
    ...appHandlers(fake),
    ...captureHandlers(fake),
    ...transcriptHandlers(fake),
    ...copilotHandlers(fake),
    ...itemsHandlers(fake),
    ...todayHandlers(fake),
    ...outputsHandlers(fake),
    ...handoffHandlers(fake),
    ...libraryHandlers(fake),
    ...historyHandlers(fake),
    ...peopleHandlers(fake),
    ...agentsHandlers(fake),
    ...settingsHandlers(fake),
    ...performanceHandlers(fake),
    ...firstRunHandlers(fake),
    ...windowsHandlers(fake),
  };
}
