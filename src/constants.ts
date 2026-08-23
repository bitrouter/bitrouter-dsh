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
} as const;

/** The `llm-pi-ai` settings namespace this plugin writes its route into. */
export const LLM_NAMESPACE = "llm-pi-ai";

/**
 * The `agent-default-model` settings namespace, owned by
 * `@deepseek-ai/dsh-agent-default-model`. The composition entry this bundle
 * patches is that plugin's own row; this namespace is where a user's saved
 * selection lives, and is read to tell "the user chose BitRouter" from "the
 * user chose something else" before this plugin offers to take over.
 */
export const AGENT_DEFAULT_MODEL_NAMESPACE = "agent-default-model";

/**
 * The model id that hands model choice back to BitRouter.
 *
 * `bitrouter/` is a namespace BitRouter reserves for itself
 * (`RESERVED_NAMESPACE` in `crates/bitrouter-sdk/src/config/presets.rs`), and
 * `bitrouter/auto` is the public slug for policy-driven automatic routing
 * (`AUTO_SLUG`). The vendor segment names the *router being addressed*, not the
 * token destination: the request is still fulfilled by whichever upstream
 * provider the bound policy selects.
 *
 * This is the id as it travels on the wire, so it is the id this plugin
 * advertises. The gateway never lists it in `GET /v1/models` — the namespace is
 * resolved before any provider lookup, and BitRouter's registry validator
 * refuses catalog models under `bitrouter/` so it can never be shadowed — which
 * is why this plugin has to supply the entry itself.
 *
 * It resolves only where a preset named `auto` is bound to a routing policy;
 * without one the gateway answers 400 naming `bitrouter optimize setup`.
 */
export const AUTO_MODEL_ID = "bitrouter/auto";

/** Wire protocol BitRouter speaks. */
export const PROTOCOL = "openai-completions";

export type BitrouterConstants = typeof bitrouter;
