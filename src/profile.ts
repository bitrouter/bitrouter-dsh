import type {
  PiAiCompatProfile,
  PiAiModelProfile,
  PiAiProviderProfile,
} from "@deepseek-ai/dsh-llm-pi-ai";
import { AUTO_MODEL_ID, PROTOCOL } from "./constants.js";
import { hasCapability, type DiscoveredModel } from "./discovery.js";

export type {
  PiAiCompatProfile,
  PiAiModelProfile,
  PiAiProviderProfile,
} from "@deepseek-ai/dsh-llm-pi-ai";

/**
 * BitRouter is an OpenAI-compatible gateway, not an OpenAI backend, and pi-ai
 * shapes a request whose URL it cannot recognize as though it were OpenAI
 * itself. Each switch corrects one field BitRouter's gateway rejects outright
 * with a strict "Extra inputs are not permitted", or would mis-address:
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

/**
 * Capacities assumed for the synthesized `auto` entry, used only while
 * BitRouter's own catalog does not list it. They are deliberately the floor
 * rather than the ceiling of what the route can reach: `auto` may land on any
 * model in the tier ladder, and the two wrong answers do not cost the same.
 * Under-claiming compacts a session earlier than it needed to; over-claiming
 * sends a request the chosen model rejects outright, mid-turn — after the
 * message is durable. A catalog that lists `auto` replaces both with the
 * served values.
 */
const AUTO_CONTEXT_WINDOW = 128_000;
const AUTO_MAX_TOKENS = 16_384;

/**
 * The synthesized `auto` entry, used only while BitRouter's catalog does not
 * list one itself.
 */
export function autoModel(): DiscoveredModel {
  return {
    id: AUTO_MODEL_ID,
    name: "BitRouter Auto",
    description: "Let BitRouter choose the model for each request.",
    max_input_tokens: AUTO_CONTEXT_WINDOW,
    max_output_tokens: AUTO_MAX_TOKENS,
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
    capabilities: ["tools", "reasoning"],
  };
}

/**
 * Put the auto route at the head of the catalog, synthesizing it when the
 * gateway does not serve one yet.
 *
 * This is also what keeps a route with no reachable catalog serviceable at
 * all: `llm-pi-ai` refuses a hand-declared route with an empty `models` list,
 * so writing nothing would leave the deployment with no BitRouter route.
 *
 * A served entry still wins if one ever appears, though none does today:
 * `bitrouter/` is resolved before any provider lookup, and BitRouter's registry
 * validator refuses catalog models under it, so the entry has to come from
 * here. The check costs nothing and keeps the placeholder from shadowing a
 * future one. Order matters because the head of
 * this list is what a model selector offers first.
 */
export function withAutoModel(discovered: DiscoveredModel[]): DiscoveredModel[] {
  const served = discovered.find((m) => m.id === AUTO_MODEL_ID);
  const rest = discovered.filter((m) => m.id !== AUTO_MODEL_ID);
  return [served ?? autoModel(), ...rest];
}

const PI_AI_MODALITIES = new Set(["text", "image"]);

/**
 * Map a `/v1/models` entry to an llm-pi-ai model entry. Fields BitRouter does
 * not disclose are left off rather than guessed: llm-pi-ai then applies the
 * route's `defaultContextWindow` / `defaultMaxTokens`, which a deployment can
 * correct in one place instead of per model.
 */
export function toModelProfile(m: DiscoveredModel): PiAiModelProfile {
  const declared = (m.input_modalities ?? []).filter(
    (x): x is "text" | "image" => PI_AI_MODALITIES.has(x),
  );
  // A plane may advertise the capability while leaving `input_modalities`
  // empty, so the token and the list are read together.
  const merged = new Set<"text" | "image">(declared);
  if (hasCapability(m, "image_input")) merged.add("image");
  // Text is the floor every supported protocol certainly carries, so a model
  // this route describes as taking images is never declared image-*only*: a
  // list omitting text would refuse the prompt before the image is attached.
  // An entirely empty set stays empty, though — that is "no answer here", and
  // llm-pi-ai answers it with the route's `defaultInput`.
  if (merged.size > 0) merged.add("text");
  const input = (["text", "image"] as const).filter((x) => merged.has(x));
  return {
    id: m.id,
    ...(m.name ? { name: m.name } : {}),
    // `max_input_tokens` is the context window on the wire; there is no
    // `context_window` field on either data plane.
    ...(m.max_input_tokens ? { contextWindow: m.max_input_tokens } : {}),
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
  // The auto route leads the list and is synthesized when the gateway serves
  // none, so `models` is never empty — which is also what `llm-pi-ai` requires
  // of a hand-declared route.
  const models = withAutoModel(options.models);
  return {
    displayName: options.displayName,
    ...(options.apiKeyEnv ? { apiKeyEnv: options.apiKeyEnv } : {}),
    api: PROTOCOL,
    baseURL: options.baseUrl,
    compat: { ...BITROUTER_COMPAT, ...(options.compat ?? {}) },
    models: models.map(toModelProfile),
  };
}
