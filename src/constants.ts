/**
 * BitRouter deployment constants.
 *
 * These used to be code-generated from `shared/bitrouter.json` in the
 * bitrouter-integrations monorepo. This package is standalone, so they are
 * hand-maintained here — keep them in sync with the gateway's cloud endpoints
 * when BitRouter Cloud moves.
 */
export const bitrouter = {
  cloud: {
    /** OpenAI-compatible inference surface for BitRouter Cloud. */
    apiBaseUrl: "https://api.bitrouter.ai/v1",
  },
  /** Loopback daemon default, as served by `bitrouter start`. */
  local: {
    apiBaseUrl: "http://127.0.0.1:4356/v1",
  },
  /**
   * Listed when the catalog cannot be fetched, so the route is still
   * serviceable — `llm-pi-ai` refuses a hand-declared route with no models.
   */
  defaultModel: "kimi-k2.5",
} as const;

/** The `llm-pi-ai` settings namespace this plugin writes its route into. */
export const LLM_NAMESPACE = "llm-pi-ai";

/** Wire protocol BitRouter speaks. */
export const PROTOCOL = "openai-completions";

export type BitrouterConstants = typeof bitrouter;
