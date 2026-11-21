import type { NativeEnvironment } from "../../core/bindings";
import { t } from "../../i18n/format";

// @cpt-dod:cpt-noter-dod-ui-first-run-components:p1
export function NativePermissionDetails({ native }: { native?: NativeEnvironment | null }) {
  if (!native) return null;
  return <div className="fr-perm__how fr-perm__native" data-region="running-copy">
    <p>{t("permission.copy", { app: native.app_name, path: native.app_path, id: native.bundle_id ?? native.app_name })}</p>
    <p>{t("permission.os", { version: native.os_version })}</p>
    <p>{t("permission.copy_help")}</p>
  </div>;
}
