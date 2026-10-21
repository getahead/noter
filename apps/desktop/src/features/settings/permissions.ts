import type { PermissionKind, PermissionRow } from "../../core/bindings";
import { initialPermissionRow, type PermissionRowState } from "../first-run/permission-row";

/** The state a Settings permission row shows for what the core reports; a permission it does not list reads as never asked. */
export const rowState = (kind: PermissionKind, permissions: readonly PermissionRow[] | undefined): PermissionRowState =>
  initialPermissionRow(kind, permissions?.find((p) => p.kind === kind)?.state ?? "not_asked");
