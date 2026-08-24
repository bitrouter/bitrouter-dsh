import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { discoverModels } from "../src/discovery.js";
import { buildProfile } from "../src/profile.js";

/**
 * Regression tests against bodies captured verbatim from both BitRouter data
 * planes, so a future change to the field mapping is caught by the wire and
 * not by a hand-written guess at it.
 *
 * The fixtures are verbatim rows, not trimmed ones: `test/schema.test.ts`
 * checks them against BitRouter Cloud's published schema, and a capture with
 * the uninteresting fields cut out would conform to nothing.
 */
function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

function stubFetch(body: unknown): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const BASE = "https://api.bitrouter.ai/v1";

async function profileFor(name: string) {
  const models = await discoverModels(BASE, undefined, stubFetch(fixture(name)));
  return buildProfile({ displayName: "BitRouter", baseUrl: BASE, models });
}

describe("BitRouter Cloud wire shape", () => {
  it("reads the context window off max_input_tokens", async () => {
    const p = await profileFor("cloud-models");
    const byId = Object.fromEntries(p.models!.map((m) => [m.id, m]));
    // Before this mapping existed the plugin read `context_window`, which
    // neither plane sends, so every one of these fell back to the route's
    // defaultContextWindow.
    expect(byId["anthropic/claude-fable-5"].contextWindow).toBe(1_000_000);
    expect(byId["anthropic/claude-haiku-4.5"].contextWindow).toBe(200_000);
    expect(byId["anthropic/claude-opus-4.6"].contextWindow).toBe(200_000);
  });

  it("reads the output cap off max_output_tokens", async () => {
    const p = await profileFor("cloud-models");
    const byId = Object.fromEntries(p.models!.map((m) => [m.id, m]));
    expect(byId["anthropic/claude-fable-5"].maxTokens).toBe(128_000);
    expect(byId["anthropic/claude-haiku-4.5"].maxTokens).toBe(8192);
  });

  it("carries vision through from the declared modalities", async () => {
    const p = await profileFor("cloud-models");
    const byId = Object.fromEntries(p.models!.map((m) => [m.id, m]));
    expect(byId["anthropic/claude-opus-4.6"].input).toEqual(["text", "image"]);
  });

  it("leads with the auto route", async () => {
    const p = await profileFor("cloud-models");
    expect(p.models![0].id).toBe("bitrouter/auto");
    expect(p.models).toHaveLength(5); // four served + auto
  });
});

describe("local daemon wire shape", () => {
  it("describes nothing beyond the id, so the route's defaults apply", async () => {
    const p = await profileFor("local-models");
    // `{ id, object, providers }` is the whole of what `bitrouter start`
    // serves, so every capability field is deliberately left off the profile
    // and llm-pi-ai answers with defaultContextWindow / defaultMaxTokens.
    const served = p.models!.filter((m) => m.id !== "bitrouter/auto");
    expect(served).toEqual([
      { id: "anthropic/claude-fable-5" },
      { id: "anthropic/claude-haiku-4.5" },
    ]);
  });

  it("still leads with the auto route", async () => {
    const p = await profileFor("local-models");
    expect(p.models![0].id).toBe("bitrouter/auto");
  });
});
