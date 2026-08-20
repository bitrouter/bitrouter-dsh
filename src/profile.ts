import { bitrouter, PROTOCOL } from "./constants.js";
import type { DiscoveredModel } from "./discovery.js";

/**
 * The subset of `@deepseek-ai/dsh-llm-pi-ai`'s `PiAiProviderProfile` this
 * plugin writes. Mirrored rather than imported: `@deepseek-ai/dsh-llm-pi-ai`
 * declares a peer dependency on `@deepseek-ai/dsh-environment`, which is not
 * published to npm as of `0.0.1-rc.1`, so the package cannot be installed
 * standalone. The shape below is validated by llm-pi-ai's own schema when the
 * section is written, so a drift shows up as a `settings-rejected` naming the
 * offending field rather than as silent breakage.
 */
export interface PiAiModelProfile {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: ("text" | "image")[];
}

export interface PiAiCompatProfile {
  supportsStore?: boolean;
  supportsUsageInStreaming?: boolean;
  supportsDeveloperRole?: boolean;
  maxTokensField?: "max_tokens" | "max_completion_tokens";
}

export interface PiAiProviderProfile {
  displayName?: string;
  apiKeyEnv?: string;
  api?: string;
  baseURL?: string;
  compat?: PiAiCompatProfile;
  models?: PiAiModelProfile[];
}

/**
 * BitRouter is not an OpenAI backend, and pi-ai shapes a request it cannot
 * recognize as though it were OpenAI itself. Each switch below corrects one
 * field BitRouter's gateway rejects outright with a strict "Extra inputs are
 * not permitted", or would mis-address:
 *
 * - `supportsStore` / `supportsUsageInStreaming` — suppress `store: false` and
 *   `stream_options`, the two OpenAI-only request fields the gateway refuses.
 * - `supportsDeveloperRole` — a reasoning model's system prompt would otherwise
 *   go out under the `developer` role.
 * - `maxTokensField` — the output cap travels as `max_tokens`, not
 *   `max_completion_tokens`.
 */
export const BITROUTER_COMPAT: PiAiCompatProfile = {
  supportsStore: false,
  supportsUsageInStreaming: false,
  supportsDeveloperRole: false,
  maxTokensField: "max_tokens",
};

/** A one-model catalog so an undiscoverable route is still serviceable. */
export function placeholderModels(): DiscoveredModel[] {
  return [{ id: bitrouter.defaultModel, name: `${bitrouter.defaultModel} (BitRouter)` }];
}

const PI_AI_MODALITIES = new Set(["text", "image"]);

/**
 * Map a `/v1/models` entry to an llm-pi-ai model entry. Fields BitRouter does
 * not disclose are left off rather than guessed: llm-pi-ai then applies the
 * route's `defaultContextWindow` / `defaultMaxTokens`, which a deployment can
 * correct in one place instead of per model.
 */
export function toModelProfile(m: DiscoveredModel): PiAiModelProfile {
  const input = (m.input_modalities ?? []).filter(
    (x): x is "text" | "image" => PI_AI_MODALITIES.has(x),
  );
  return {
    id: m.id,
    ...(m.name ? { name: m.name } : {}),
    ...(m.context_window ? { contextWindow: m.context_window } : {}),
    ...(m.max_output_tokens ? { maxTokens: m.max_output_tokens } : {}),
    // An empty list means "no answer here" to llm-pi-ai, so omit it entirely
    // rather than writing one and having resolution skip past it anyway.
    ...(input.length > 0 ? { input } : {}),
  };
}

export interface ProfileOptions {
  displayName: string;
  apiKeyEnv?: string;
  baseUrl: string;
  models: DiscoveredModel[];
  compat?: PiAiCompatProfile;
}

/**
 * Build the hand-declared llm-pi-ai route for BitRouter. A route the pi-ai
 * catalog does not ship needs `api`, `baseURL`, and a non-empty `models` list,
 * so all three are always present.
 */
export function buildProfile(options: ProfileOptions): PiAiProviderProfile {
  const models = options.models.length > 0 ? options.models : placeholderModels();
  return {
    displayName: options.displayName,
    ...(options.apiKeyEnv ? { apiKeyEnv: options.apiKeyEnv } : {}),
    api: PROTOCOL,
    baseURL: options.baseUrl,
    compat: { ...BITROUTER_COMPAT, ...(options.compat ?? {}) },
    models: models.map(toModelProfile),
  };
}
