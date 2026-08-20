import Schema from "@deepseek-ai/schemastery";

export interface Config {
  /** Which BitRouter data plane to route through. */
  target: "auto" | "local" | "cloud";
  /** Explicit base URL; overrides the target's default. */
  baseURL?: string;
  /** Credential reference (environment-variable name) llm-pi-ai resolves per request. */
  apiKeyEnv: string;
  /** llm-pi-ai route key this plugin owns. */
  route: string;
  /** Name configuration surfaces show for the route. */
  displayName: string;
  /** Write the route into the `llm-pi-ai` settings namespace. */
  manageProfile: boolean;
  /** Remove the route again when this plugin unloads. */
  removeOnUnload: boolean;
  /** Milliseconds to wait for the local daemon probe when `target: auto`. */
  probeTimeoutMs: number;
}

export const Config: Schema<Config> = Schema.object({
  target: Schema.union(["auto", "local", "cloud"] as const)
    .default("auto")
    .description(
      "auto: use the local daemon when it serves models, else BitRouter Cloud.",
    ),
  baseURL: Schema.string().description(
    "Explicit BitRouter endpoint; overrides the target default.",
  ),
  apiKeyEnv: Schema.string()
    .default("BITROUTER_API_KEY")
    .description(
      "Environment variable holding the brvk_ key, resolved per request by llm-pi-ai.",
    ),
  route: Schema.string()
    .default("bitrouter")
    .description("llm-pi-ai provider route key this plugin owns."),
  displayName: Schema.string()
    .default("BitRouter")
    .description("Label shown by model selectors."),
  manageProfile: Schema.boolean()
    .default(true)
    .description(
      "Write the discovered route into the llm-pi-ai settings namespace. Turn off to hand-maintain the profile.",
    ),
  removeOnUnload: Schema.boolean()
    .default(true)
    .description(
      "Remove the route from settings when this plugin unloads, so uninstalling leaves no orphan.",
    ),
  probeTimeoutMs: Schema.natural()
    .default(1500)
    .description("Local-daemon probe timeout for target: auto."),
});
