import { createContext, useContext } from "react";
import type { Bridge } from "./bridge";

const Ctx = createContext<Bridge | null>(null);

/** The window's bridge for the pages the shell renders (`registerPage` gives them only the route). */
export const BridgeProvider = Ctx.Provider;

export function useBridge(): Bridge {
  const bridge = useContext(Ctx);
  if (!bridge) throw new Error("useBridge needs a BridgeProvider");
  return bridge;
}
