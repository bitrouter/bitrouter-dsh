/**
 * BitRouter route for DeepSeek Harness.
 *
 * BitRouter is an OpenAI-compatible gateway, and the harness already knows how
 * to speak to one: `@deepseek-ai/dsh-llm-pi-ai` serves a hand-declared route
 * given an `api`, a `baseURL`, and a model list. What configuration alone
 * cannot do is keep that model list *live* — a static `models:` block goes
 * stale every time BitRouter's catalog changes.
 *
 * So this plugin owns exactly that gap. On load it picks the data plane, reads
 * `GET ${baseUrl}/models`, and writes the resulting route into the `llm-pi-ai`
 * settings namespace; on unload it takes the route back out. The streaming,
 * retry, replay, and token-metering work stays where it belongs, in the
 * adapter that already does it.
 *
 * ```yaml
 * - name: '@bitrouter/dsh'
 *   config:
 *     target: auto
 * ```
 *
 * @module @bitrouter/dsh
 */

import type { Context } from "@deepseek-ai/cordis";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { Config } from "./config.js";
import { LLM_NAMESPACE } from "./constants.js";
import { syncProfile } from "./sync.js";

export { Config } from "./config.js";
export { bitrouter, LLM_NAMESPACE, PROTOCOL } from "./constants.js";
export { discoverModels } from "./discovery.js";
export type { DiscoveredModel } from "./discovery.js";
export {
  BITROUTER_COMPAT,
  buildProfile,
  placeholderModels,
  toModelProfile,
} from "./profile.js";
export type {
  PiAiCompatProfile,
  PiAiModelProfile,
  PiAiProviderProfile,
  ProfileOptions,
} from "./profile.js";
export { syncProfile } from "./sync.js";
export type { SyncDeps, SyncResult } from "./sync.js";
export { localDaemonServesModels, resolveSmartTarget, resolveTarget } from "./target.js";
export type { Target, TargetMode } from "./target.js";

export const name = "bitrouter";

/**
 * `settings` is required, not optional: writing the route into the `llm-pi-ai`
 * namespace is the whole of what this plugin does, so there is nothing to
 * degrade to without the seam. A composition with no settings provider leaves
 * this plugin PENDING — declare the route in `llm-pi-ai`'s own entry config
 * instead (see the README).
 */
export const inject = ["settings"];

const NS = settingsNamespace(LLM_NAMESPACE);

export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!config.manageProfile) {
    ctx.logger.info(
      `bitrouter: manageProfile is off; leaving the "${config.route}" route to configuration`,
    );
    return;
  }

  await syncProfile(config, {
    env: process.env,
    fetch,
    log: {
      info: (message) => ctx.logger.info(message),
      warn: (message) => ctx.logger.warn(message),
    },
    updateSettings: (patch) => ctx.settings.update(NS, patch),
  });

  if (!config.removeOnUnload) return;
  // An op naming the one route, rather than rewriting the section: the rest of
  // the namespace belongs to routes this plugin never saw.
  ctx.effect(() => () => {
    void ctx.settings
      .mutate(NS, [{ op: "unset", path: ["providers", config.route] }])
      .catch((err: unknown) => {
        ctx.logger.warn(
          `bitrouter: could not remove the "${config.route}" route on unload: ${String(err)}`,
        );
      });
  });
}
