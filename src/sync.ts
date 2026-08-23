import { LLM_NAMESPACE } from "./constants.js";
import { discoverModels, type DiscoveredModel } from "./discovery.js";
import { buildProfile, type PiAiProviderProfile } from "./profile.js";
import { resolveSmartTarget, type Target } from "./target.js";
import type { Config } from "./config.js";

/** The subset of the harness `ctx` this module needs, so tests need no kernel. */
export interface SyncDeps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  /**
   * Resolve the route's credential reference the way `llm-pi-ai` will at
   * request time — through `ctx.credentials`, which layers the process
   * environment over the managed document and the `.env` files.
   *
   * Discovery must authenticate with the *same* credential the route will,
   * or a key held anywhere but the process environment reads as "no key" here
   * and the catalog comes back empty while every real request succeeds.
   * Omitted, it falls back to reading {@link env} directly, which is the
   * behavior for a composition with no credentials provider mounted.
   */
  resolveApiKey?: (ref: string) => Promise<string | undefined>;
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
  /**
   * True when discovery listed nothing and the route was written with the auto
   * route alone.
   */
  autoOnly: boolean;
}

/**
 * Resolve the data plane, read BitRouter's catalog, and write the route into
 * the `llm-pi-ai` settings namespace.
 *
 * Discovery failure is not fatal. `llm-pi-ai` refuses a hand-declared route
 * with no models, so writing nothing would leave the deployment with no
 * BitRouter route at all. The auto route leads every catalog this plugin
 * writes and is synthesized when the gateway serves none, so an undiscoverable
 * gateway still leaves a serviceable `bitrouter/auto` — routing is the
 * gateway's job, not this plugin's — and the next load fills in the rest.
 */
/**
 * Read the route's credential through the seam when one is injected, else
 * straight off the environment. A seam failure degrades to the environment
 * rather than failing the load: discovery is best-effort, and a route written
 * from a short catalog still serves.
 */
async function resolveApiKey(
  ref: string | undefined,
  deps: SyncDeps,
): Promise<string | undefined> {
  if (!ref) return undefined;
  if (deps.resolveApiKey) {
    try {
      const resolved = await deps.resolveApiKey(ref);
      if (resolved) return resolved;
    } catch (err) {
      deps.log.warn(
        `bitrouter: could not resolve the credential reference ${ref} (${String(err)}); falling back to the process environment`,
      );
    }
  }
  return deps.env[ref];
}

export async function syncProfile(config: Config, deps: SyncDeps): Promise<SyncResult> {
  const target = await resolveSmartTarget(config.target, config.baseURL, deps.fetch);
  const apiKey = await resolveApiKey(config.apiKeyEnv, deps);

  let models: DiscoveredModel[] = [];
  try {
    models = await discoverModels(target.baseUrl, apiKey, deps.fetch);
  } catch (err) {
    deps.log.warn(
      `bitrouter: model discovery failed at ${target.baseUrl}/models (${String(err)}); writing the auto route alone`,
    );
  }
  const autoOnly = models.length === 0;
  if (autoOnly) {
    deps.log.warn(
      `bitrouter: no models listed at ${target.baseUrl}; writing the auto route alone`,
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

  return { target, profile, autoOnly };
}
