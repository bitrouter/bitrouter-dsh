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
 * `GET ${baseUrl}/models`, and writes the resulting route — led by the `auto`
 * route — into the `llm-pi-ai` settings namespace; on unload it takes that
 * route back out, but only while the route is still the one it wrote. The
 * streaming, retry, replay, and token-metering work stays where it belongs, in
 * the adapter that already does it.
 *
 * Making BitRouter the harness *default* is not done here at all: it is a row
 * in this bundle's `cordis.patch.yml`, applied at install.
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
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { SettingsConflictError, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { adoptCliLogin, describeOutcome } from "./auth.js";
import { Config } from "./config.js";
import { LLM_NAMESPACE } from "./constants.js";
import {
  decideRemoval,
  describeDecision,
  routeFromSection,
  type RemovalDecision,
  type StoredRouteView,
} from "./ownership.js";
import { syncProfile } from "./sync.js";

export { adoptCliLogin, describeOutcome } from "./auth.js";
export type { AdoptDeps, AdoptOutcome, CredentialSeam } from "./auth.js";
export { Config } from "./config.js";
export {
  AGENT_DEFAULT_MODEL_NAMESPACE,
  AUTO_MODEL_ID,
  bitrouter,
  LLM_NAMESPACE,
  PROTOCOL,
} from "./constants.js";
export {
  credentialsPath,
  extractCloudToken,
  loadCloudToken,
} from "./credentials.js";
export type { TokenResult } from "./credentials.js";
export { discoverModels, hasCapability, providerCount } from "./discovery.js";
export type { DiscoveredModel, DiscoveredPricing } from "./discovery.js";
export {
  decideRemoval,
  describeDecision,
  routeFromSection,
} from "./ownership.js";
export type { RemovalDecision, StoredRouteView } from "./ownership.js";
export {
  BITROUTER_COMPAT,
  autoModel,
  buildProfile,
  toModelProfile,
  withAutoModel,
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
 *
 * `credentials` is deliberately absent. Cordis `inject` is a list of services
 * to *wait for*, with no optional form — an entry here would leave this plugin
 * PENDING in a composition that mounts no credential provider, which is the
 * one case the credential seam is supposed to degrade through. So it is read
 * at run time through `ctx.get('credentials')`, exactly as `llm-pi-ai` reads
 * it, and an absent one resolves the route's key straight off the process
 * environment — what every earlier release did.
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

  // Before the route is written: if it names a credential reference that
  // resolves to nothing, and the BitRouter CLI is holding a live token, fill
  // the gap. Ordered first so the discovery request below authenticates with
  // the same credential the route will use per request.
  const credentials = ctx.get("credentials");
  if (config.adoptCliLogin && config.apiKeyEnv && credentials) {
    const outcome = await adoptCliLogin(config.apiKeyEnv, {
      env: process.env,
      now: () => new Date(),
      credentials: {
        describe: (ref) => credentials.describe(credentialRef(ref)),
        set: (ref, value) => credentials.set(credentialRef(ref), value),
      },
      log: {
        info: (message) => ctx.logger.info(message),
        warn: (message) => ctx.logger.warn(message),
      },
    });
    const line = describeOutcome(config.apiKeyEnv, outcome);
    if (outcome.adopted || outcome.reason === "already-configured") {
      ctx.logger.info(line);
    } else {
      ctx.logger.warn(line);
    }
  }

  const result = await syncProfile(config, {
    env: process.env,
    fetch,
    // Resolve the way llm-pi-ai will at request time, so a key held in the
    // managed document or a `.env` authenticates discovery too.
    ...(credentials
      ? {
          resolveApiKey: async (ref: string) =>
            (await credentials.resolve(credentialRef(ref)))?.value,
        }
      : {}),
    log: {
      info: (message) => ctx.logger.info(message),
      warn: (message) => ctx.logger.warn(message),
    },
    // No `expectedRevision` here, deliberately. This is a blind deep-merge of
    // one key, not a read-modify-write, so there is no stale snapshot to fence
    // — and the revision counts the whole raw section, so fencing it would
    // refuse the write whenever anyone had touched an unrelated route. The
    // service's per-namespace write queue already orders concurrent writers.
    updateSettings: (patch) => ctx.settings.update(NS, patch),
  });

  if (!config.removeOnUnload) return;

  // The profile as written, kept as the ownership baseline for unload. It is
  // what the *raw user layer* should still hold if nobody has touched the route
  // since — the resolved value would differ, since it folds in the composition
  // base and schema defaults.
  const written = result.profile;

  /** Read the raw user-layer route and the revision it stands at. */
  const readStoredRoute = (): StoredRouteView | undefined => {
    const descriptor = ctx.settings.describe().find((entry) => entry.ns === NS);
    if (descriptor === undefined) return undefined;
    return {
      route: routeFromSection(descriptor.user, config.route),
      revision: descriptor.revision,
    };
  };

  ctx.effect(() => () => {
    // Everything up to the write is synchronous, deliberately. The settings
    // service drains writes already queued when teardown starts, but a write
    // enqueued a microtask later — after an `await` — races a process that is
    // already exiting, and loses. `describe()` is synchronous, so the ownership
    // decision costs nothing here and the `mutate` is queued before the
    // disposer returns.
    let decision: RemovalDecision;
    try {
      decision = decideRemoval(readStoredRoute(), written);
    } catch (err) {
      ctx.logger.warn(
        `bitrouter: could not check ownership of the "${config.route}" route on unload (${String(err)}); leaving it in place`,
      );
      return;
    }

    if (!decision.remove) {
      ctx.logger.info(describeDecision(config.route, decision));
      return;
    }

    // An op naming the one route, rather than rewriting the section: the rest
    // of the namespace belongs to routes this plugin never saw.
    //
    // The revision fences the gap between the ownership read above and this
    // write. Without it the check would be advisory — a writer landing in
    // between would have its edit deleted by a decision made before it
    // existed. A refusal here is the outcome we want anyway, so it is reported
    // and not retried: the section moved, which is exactly the case in which
    // this plugin should not be deleting anything.
    void ctx.settings
      .mutate(NS, [{ op: "unset", path: ["providers", config.route] }], decision.revision)
      .then(() => {
        ctx.logger.info(describeDecision(config.route, decision));
      })
      .catch((err: unknown) => {
        if (err instanceof SettingsConflictError) {
          ctx.logger.info(
            `bitrouter: the "${config.route}" route changed while it was being removed; leaving it in place`,
          );
          return;
        }
        // At process shutdown the settings service is disposed before a
        // dependent plugin's queued write runs, so this write cannot land and
        // the route stays in the document until the next load rewrites it.
        // That is ordinary news rather than a failure — see `removeOnUnload`
        // in the README. Matching the message is admittedly loose, but it only
        // decides a log level, and the alternative is warning on every exit.
        if (err instanceof Error && err.message.includes("disposed")) {
          ctx.logger.info(
            `bitrouter: the settings service was already gone when the "${config.route}" route was to be removed; leaving it for the next load`,
          );
          return;
        }
        ctx.logger.warn(
          `bitrouter: could not remove the "${config.route}" route on unload: ${String(err)}`,
        );
      });
  });
}
