import { describe, it, expect } from "vitest";
import {
  autoModel,
  buildProfile,
  toModelProfile,
  withAutoModel,
  BITROUTER_COMPAT,
} from "../src/profile.js";
import type { DiscoveredModel } from "../src/discovery.js";

describe("toModelProfile", () => {
  it("carries through what BitRouter discloses", () => {
    // `max_input_tokens` is the context window on the wire — neither data
    // plane sends a `context_window` field.
    expect(
      toModelProfile({
        id: "anthropic/claude-opus-4.6",
        name: "Anthropic: Claude Opus 4.6",
        max_input_tokens: 200000,
        max_output_tokens: 16384,
        input_modalities: ["text", "image"],
      }),
    ).toEqual({
      id: "anthropic/claude-opus-4.6",
      name: "Anthropic: Claude Opus 4.6",
      contextWindow: 200000,
      maxTokens: 16384,
      input: ["text", "image"],
    });
  });

  it("infers image input from a capability token", () => {
    // A plane may advertise the capability while leaving the list empty.
    expect(toModelProfile({ id: "x", capabilities: ["image_input"] })).toEqual({
      id: "x",
      input: ["text", "image"],
    });
  });

  it("omits what it does not know rather than guessing", () => {
    // llm-pi-ai then applies the route's defaultContextWindow/defaultMaxTokens,
    // which a deployment corrects in one place instead of per model. This is
    // every local-daemon entry: it lists ids and provider names, nothing else.
    expect(toModelProfile({ id: "mystery" })).toEqual({ id: "mystery" });
    expect(
      toModelProfile({ id: "mystery", object: "model", providers: ["claude-code"] }),
    ).toEqual({ id: "mystery" });
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
    // The auto route leads the list; the discovered model follows it.
    expect(p.models).toEqual([toModelProfile(autoModel()), { id: "kimi-k2.5" }]);
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

  it("writes the auto route alone rather than an unserviceable empty route", () => {
    // llm-pi-ai refuses a hand-declared route with no models, so an
    // undiscoverable gateway still leaves a serviceable `bitrouter/auto`.
    const p = buildProfile({ ...base, models: [] });
    expect(p.models).toHaveLength(1);
    expect(p.models?.[0].id).toBe("bitrouter/auto");
    expect(p.models?.[0].contextWindow).toBe(128000);
  });

  it("omits apiKeyEnv entirely when none is configured", () => {
    // Naming no credential is how a skip_auth loopback daemon stays usable;
    // an empty string would be a reference that resolves to nothing.
    const p = buildProfile({ ...base, apiKeyEnv: undefined, models: [{ id: "m" }] });
    expect("apiKeyEnv" in p).toBe(false);
  });
});

describe("withAutoModel", () => {
  const cloud: DiscoveredModel = {
    id: "anthropic/claude-opus-4.6",
    max_input_tokens: 200000,
  };

  it("puts a synthesized auto route at the head of the catalog", () => {
    const out = withAutoModel([cloud]);
    expect(out.map((m) => m.id)).toEqual(["bitrouter/auto", "anthropic/claude-opus-4.6"]);
    expect(out[0]).toEqual(autoModel());
  });

  it("offers the auto route even when nothing was discovered", () => {
    expect(withAutoModel([]).map((m) => m.id)).toEqual(["bitrouter/auto"]);
  });

  it("prefers the served entry once BitRouter lists auto itself", () => {
    const served: DiscoveredModel = { id: "bitrouter/auto", max_input_tokens: 1000000 };
    const out = withAutoModel([cloud, served]);
    expect(out[0]).toBe(served);
    expect(out).toHaveLength(2);
    // The served metadata wins over the placeholder's conservative floor.
    expect(toModelProfile(out[0]).contextWindow).toBe(1000000);
  });

  it("never lists the auto route twice", () => {
    const out = withAutoModel([{ id: "bitrouter/auto" }, cloud, { id: "bitrouter/auto" }]);
    expect(out.filter((m) => m.id === "bitrouter/auto")).toHaveLength(1);
  });
});
