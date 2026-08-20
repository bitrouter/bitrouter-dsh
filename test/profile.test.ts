import { describe, it, expect } from "vitest";
import { buildProfile, toModelProfile, BITROUTER_COMPAT } from "../src/profile.js";

describe("toModelProfile", () => {
  it("carries through what BitRouter discloses", () => {
    expect(
      toModelProfile({
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        context_window: 200000,
        max_output_tokens: 64000,
        input_modalities: ["text", "image"],
      }),
    ).toEqual({
      id: "claude-opus-4-8",
      name: "Claude Opus 4.8",
      contextWindow: 200000,
      maxTokens: 64000,
      input: ["text", "image"],
    });
  });

  it("omits what it does not know rather than guessing", () => {
    // llm-pi-ai then applies the route's defaultContextWindow/defaultMaxTokens,
    // which a deployment corrects in one place instead of per model.
    expect(toModelProfile({ id: "mystery" })).toEqual({ id: "mystery" });
  });

  it("drops modalities pi-ai does not take, and omits an empty list", () => {
    expect(toModelProfile({ id: "x", input_modalities: ["text", "hologram"] })).toEqual({
      id: "x",
      input: ["text"],
    });
    // An empty list reads as "no answer here" to llm-pi-ai, so it is not written.
    expect(toModelProfile({ id: "y", input_modalities: ["hologram"] })).toEqual({ id: "y" });
  });
});

describe("buildProfile", () => {
  const base = {
    displayName: "BitRouter",
    apiKeyEnv: "BITROUTER_API_KEY",
    baseUrl: "https://api.bitrouter.ai/v1",
  };

  it("declares everything a hand-declared llm-pi-ai route needs", () => {
    const p = buildProfile({ ...base, models: [{ id: "kimi-k2.5" }] });
    // api + baseURL + a non-empty models list are all required of a route the
    // pi-ai catalog does not ship.
    expect(p.api).toBe("openai-completions");
    expect(p.baseURL).toBe("https://api.bitrouter.ai/v1");
    expect(p.models).toEqual([{ id: "kimi-k2.5" }]);
    expect(p.displayName).toBe("BitRouter");
    expect(p.apiKeyEnv).toBe("BITROUTER_API_KEY");
  });

  it("applies BitRouter's wire-compat switches", () => {
    const p = buildProfile({ ...base, models: [{ id: "m" }] });
    expect(p.compat).toEqual(BITROUTER_COMPAT);
    // The gateway rejects both OpenAI-only request fields outright.
    expect(p.compat?.supportsStore).toBe(false);
    expect(p.compat?.supportsUsageInStreaming).toBe(false);
    expect(p.compat?.maxTokensField).toBe("max_tokens");
  });

  it("lets a caller override one compat switch without losing the rest", () => {
    const p = buildProfile({
      ...base,
      models: [{ id: "m" }],
      compat: { supportsDeveloperRole: true },
    });
    expect(p.compat).toEqual({ ...BITROUTER_COMPAT, supportsDeveloperRole: true });
  });

  it("falls back to a placeholder rather than an unserviceable empty route", () => {
    const p = buildProfile({ ...base, models: [] });
    expect(p.models).toHaveLength(1);
    expect(p.models?.[0].id).toBe("kimi-k2.5");
  });

  it("omits apiKeyEnv entirely when none is configured", () => {
    // Naming no credential is how a skip_auth loopback daemon stays usable;
    // an empty string would be a reference that resolves to nothing.
    const p = buildProfile({ ...base, apiKeyEnv: undefined, models: [{ id: "m" }] });
    expect("apiKeyEnv" in p).toBe(false);
  });
});
