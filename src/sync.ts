import { LLM_NAMESPACE } from "./constants.js";
import { discoverModels, type DiscoveredModel } from "./discovery.js";
import { buildProfile, type PiAiProviderProfile } from "./profile.js";
import { resolveSmartTarget, type Target } from "./target.js";
import type { Config } from "./config.js";

/** The subset of the harness `ctx` this module needs, so tests need no kernel. */
export interface SyncDeps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  log: {
    info: (message: string) => void;
    warn: (message: string) => void;
  };
  /** Deep-merge a patch into the `llm-pi-ai` user settings section. */
  updateSettings: (patch: object) => Promise<void>;
}

export interface SyncResult {
  target: Target;
  profile: PiAiProviderProfile;
  /** True when discovery came back empty and the placeholder catalog was written. */
  placeholder: boolean;
}

/**
 * Resolve the data plane, read BitRouter's catalog, and write the route into
 * the `llm-pi-ai` settings namespace.
 *
 * Discovery failure is not fatal. `llm-pi-ai` refuses a hand-declared route
 * with no models, so writing nothing would leave the deployment with no
 * BitRouter route at all — a placeholder catalog keeps the route serviceable
 * and lets the next load replace it with the real list.
 */
export async function syncProfile(config: Config, deps: SyncDeps): Promise<SyncResult> {
  const target = await resolveSmartTarget(config.target, config.baseURL, deps.fetch);
  const apiKey = config.apiKeyEnv ? deps.env[config.apiKeyEnv] : undefined;

  let models: DiscoveredModel[] = [];
  try {
    models = await discoverModels(target.baseUrl, apiKey, deps.fetch);
  } catch (err) {
    deps.log.warn(
      `bitrouter: model discovery failed at ${target.baseUrl}/models (${String(err)}); writing a placeholder catalog`,
    );
  }
  const placeholder = models.length === 0;
  if (placeholder) {
    deps.log.warn(
      `bitrouter: no models listed at ${target.baseUrl}; writing a placeholder catalog`,
    );
  }

  const profile = buildProfile({
    displayName: config.displayName,
    apiKeyEnv: config.apiKeyEnv,
    baseUrl: target.baseUrl,
    models,
  });

  // Deep-merges into the user layer, so a field the user set on this route by
  // hand survives everything except the keys written here.
  await deps.updateSettings({ providers: { [config.route]: profile } });
  deps.log.info(
    `bitrouter: registered ${LLM_NAMESPACE} route "${config.route}" -> ${target.baseUrl} (${target.mode}) with ${profile.models?.length ?? 0} model(s)`,
  );

  return { target, profile, placeholder };
}
