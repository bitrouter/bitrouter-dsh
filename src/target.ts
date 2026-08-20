export type TargetMode = "local" | "cloud";

export interface Target {
  mode: TargetMode;
  baseUrl: string;
}

import { bitrouter } from "./constants.js";

/** Resolve the base URL for an explicitly named data plane. */
export function resolveTarget(mode: TargetMode, baseUrl?: string): Target {
  if (baseUrl) return { mode, baseUrl };
  return {
    mode,
    baseUrl:
      mode === "cloud" ? bitrouter.cloud.apiBaseUrl : bitrouter.local.apiBaseUrl,
  };
}

/** True when a local daemon answers `/models` with a non-empty catalog. */
export async function localDaemonServesModels(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 1500,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${baseUrl}/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const payload = (await res.json()) as { data?: unknown[] };
    return Array.isArray(payload.data) && payload.data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Pick the data plane. An explicit `target` always wins. `auto` prefers a
 * **reachable local daemon** (zero-login dev flow) and falls back to **cloud**
 * when none is serving models — so a fresh install lands on cloud while a
 * running daemon keeps its no-key experience.
 */
export async function resolveSmartTarget(
  target: TargetMode | "auto",
  baseUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Target> {
  if (target !== "auto") return resolveTarget(target, baseUrl);
  const local = resolveTarget("local", baseUrl);
  if (await localDaemonServesModels(local.baseUrl, fetchImpl)) return local;
  return resolveTarget("cloud", baseUrl);
}
