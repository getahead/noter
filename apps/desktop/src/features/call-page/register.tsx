// Registers the call page with the shell: the Library routes that name a call (`call:<id>:<tab>`) show it, with its
// own toolbar (PC-R1), banner slot (PC-R2) and Call info docked in the inspector slot (PC-R4).
import { registerPage } from "../shell/pages";
import { CallBanners } from "./CallBanners";
import { CallInfo } from "./CallInfo";
import { CallPage } from "./CallPage";
import { CallToolbar } from "./CallToolbar";
import { parseCallKey } from "./logic";
import { t } from "../../i18n/format";

const at = (key: string) => parseCallKey(key)!;

registerPage(
  "library",
  {
    title: () => t("callpage.title"),
    render: (route, bridge) => <CallPage bridge={bridge!} callId={at(route.key).callId} />,
    toolbar: CallToolbar,
    banners: CallBanners,
    inspector: { width: 280, label: "callpage.info", openByDefault: true, render: (route, bridge) => <CallInfo bridge={bridge} callId={at(route.key).callId} /> },
  },
  (route) => parseCallKey(route.key) !== null,
);
