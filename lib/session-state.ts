import type { WebSessionState } from "./pi-types";

export interface RuntimeControls {
  fastModeEnabled: boolean;
  fastModeActive: boolean | undefined;
  autoRetryEnabled: boolean;
  interruptMode: "immediate" | "wait";
  autoCompactionEnabled: boolean;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
}

export const INITIAL_RUNTIME_CONTROLS: RuntimeControls = {
  fastModeEnabled: false,
  fastModeActive: undefined,
  autoRetryEnabled: false,
  interruptMode: "immediate",
  autoCompactionEnabled: true,
  steeringMode: "all",
  followUpMode: "all",
};

export function runtimeControlPatch(
  state: Partial<WebSessionState> | undefined,
  scope: "full" | "fast",
): Partial<RuntimeControls> {
  const patch: Partial<RuntimeControls> = {
    fastModeActive: state?.fastModeActive,
  };
  if (state?.fastModeEnabled !== undefined) patch.fastModeEnabled = state.fastModeEnabled;
  if (scope === "full") {
    if (state?.autoRetryEnabled !== undefined) patch.autoRetryEnabled = state.autoRetryEnabled;
    if (state?.interruptMode !== undefined) patch.interruptMode = state.interruptMode;
    if (state?.autoCompactionEnabled !== undefined) patch.autoCompactionEnabled = state.autoCompactionEnabled;
    if (state?.steeringMode !== undefined) patch.steeringMode = state.steeringMode;
    if (state?.followUpMode !== undefined) patch.followUpMode = state.followUpMode;
  }
  return patch;
}

export function mergeRuntimeControls(
  current: RuntimeControls,
  patch: Partial<RuntimeControls>,
): RuntimeControls {
  let changed = false;
  for (const key of Object.keys(patch) as Array<keyof RuntimeControls>) {
    if (current[key] !== patch[key]) {
      changed = true;
      break;
    }
  }
  return changed ? { ...current, ...patch } : current;
}
