/**
 * BitRouter's `GET /v1/models` catalog.
 *
 * The two data planes answer with genuinely different bodies, and neither is
 * the plain OpenAI shape:
 *
 * - **Local daemon** (`crates/bitrouter-sdk/src/server.rs`) lists ids only —
 *   `{ id, object, providers: string[] }`. Every capability field is absent,
 *   so a local route is described entirely by the route's own defaults.
 * - **Cloud** (`bitrouter-cloud/src/v1/http/models.rs`) lists a rich catalog:
 *   `max_input_tokens`, `max_output_tokens`, `input_modalities`,
 *   `output_modalities`, `pricing`, `capabilities`, and `providers` as an
 *   object (`{ total_online }`) rather than a list.
 *
 * Note what cloud does *not* send: there is no `context_window`, no `cost`,
 * and no `reasoning` boolean. Reading those names — as this package used to —
 * leaves every model sized by `defaultContextWindow` even where BitRouter
 * disclosed a real window. The window is `max_input_tokens`; the capability
 * booleans are carried by `capabilities` token strings.
 */

/** Per-million-token rates, as `bitrouter-cloud/src/service/billing.rs` emits them. */
export interface DiscoveredPricing {
  input_tokens?: {
    /** Cost per million non-cached input tokens. */
    no_cache?: number;
    /** Cost per million cache-read input tokens. */
    cache_read?: number;
    /** Cost per million cache-write input tokens. */
    cache_write?: number;
  };
  output_tokens?: {
    /** Cost per million text output tokens. */
    text?: number;
    reasoning?: number;
    image?: number;
    audio?: number;
  };
}

/**
 * One entry as it arrives on the wire, union of both planes. Everything past
 * `id` is optional: the local daemon sends none of it, and cloud omits any
 * field no provider of that model declares.
 */
export interface DiscoveredModel {
  id: string;
  object?: string;
  name?: string;
  description?: string;
  /** Context window. Cloud's name for it; there is no `context_window` field. */
  max_input_tokens?: number;
  max_output_tokens?: number;
  input_modalities?: string[];
  output_modalities?: string[];
  /** Per-million rates; there is no flat `cost` field. */
  pricing?: DiscoveredPricing;
  /**
   * Capability tokens, from `Capability` in
   * `crates/bitrouter-sdk/src/language_model/types.rs`: `reasoning`, `tools`,
   * `structured_outputs`, `image_input`, `file_input`, `web_search`, and so on.
   */
  capabilities?: string[];
  /** `string[]` from the local daemon; `{ total_online }` from cloud. */
  providers?: string[] | { total_online?: number };
}

/** A capability token BitRouter advertises for a model. */
export function hasCapability(m: DiscoveredModel, token: string): boolean {
  return Array.isArray(m.capabilities) && m.capabilities.includes(token);
}

/**
 * How many providers can serve this model, when the plane says. Cloud answers
 * with a count; the local daemon answers with the provider names.
 */
export function providerCount(m: DiscoveredModel): number | undefined {
  if (Array.isArray(m.providers)) return m.providers.length;
  if (m.providers && typeof m.providers.total_online === "number") {
    return m.providers.total_online;
  }
  return undefined;
}

/**
 * Fetch BitRouter's model catalog. Throws on a non-OK response so the caller
 * can decide between "fall back to the auto route alone" and "surface the
 * error".
 *
 * Entries without a usable string id are dropped rather than failing the whole
 * listing — one malformed row should not cost the deployment its whole route.
 */
export async function discoverModels(
  baseUrl: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetchImpl(`${baseUrl}/models`, { headers, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as { data?: unknown };
  if (!Array.isArray(payload.data)) return [];
  return payload.data.filter(
    (m): m is DiscoveredModel =>
      typeof m === "object" &&
      m !== null &&
      typeof (m as DiscoveredModel).id === "string" &&
      (m as DiscoveredModel).id.length > 0,
  );
}
