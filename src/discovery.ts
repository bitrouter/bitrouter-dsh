/**
 * One entry from BitRouter's `GET /v1/models` response. BitRouter enriches the
 * plain OpenAI shape with routing metadata; everything past `id` is optional
 * because a bare OpenAI-compatible upstream will not send it.
 */
export interface DiscoveredModel {
  id: string;
  object?: string;
  providers?: string[];
  name?: string;
  reasoning?: boolean;
  input_modalities?: string[];
  context_window?: number;
  max_output_tokens?: number;
}

/**
 * Fetch BitRouter's model catalog. Throws on a non-OK response so the caller
 * can decide between "fall back to a placeholder" and "surface the error".
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
