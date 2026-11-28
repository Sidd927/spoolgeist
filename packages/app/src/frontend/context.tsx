import { createContext, useContext } from "react";
import type { AppState } from "./state.js";

export interface AppCtx {
  state: AppState;
  setState: (s: AppState) => void;
  /** Lines carried from the process view into onboarding. */
  onboardLines: readonly string[] | null;
  setOnboardLines: (l: readonly string[] | null) => void;
  now: () => string;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("no app context");
  return c;
}
