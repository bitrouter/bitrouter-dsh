import { describe, it, expect } from "vitest";
import {
  decideRemoval,
  describeDecision,
  routeFromSection,
  type StoredRouteView,
} from "../src/ownership.js";

/** What this plugin wrote — the shape buildProfile produces. */
const WRITTEN = {
  displayName: "BitRouter",
  apiKeyEnv: "BITROUTER_API_KEY",
  api: "openai-completions",
  baseURL: "https://api.bitrouter.ai/v1",
  compat: { supportsStore: false },
  models: [{ id: "auto" }],
};

function view(route: unknown, revision = 7): StoredRouteView {
  return { route, revision };
}

describe("routeFromSection", () => {
  it("reads the route out of a well-formed section", () => {
    expect(routeFromSection({ providers: { bitrouter: WRITTEN } }, "bitrouter")).toEqual(
      WRITTEN,
    );
  });

  it("answers undefined for every shape a hand-edited document can be in", () => {
    for (const section of [
      undefined,
      null,
      "a string",
      42,
      [],
      {},
      { providers: null },
      { providers: [] },
      { providers: "nope" },
      { providers: {} },
      { providers: { other: WRITTEN } },
    ]) {
      expect(routeFromSection(section, "bitrouter")).toBeUndefined();
    }
  });
});

describe("decideRemoval", () => {
  it("removes a route that is still exactly what was written", () => {
    // Structurally equal but a different object — this is what a document
    // round-trip through YAML produces.
    const roundTripped = JSON.parse(JSON.stringify(WRITTEN)) as unknown;
    expect(decideRemoval(view(roundTripped), WRITTEN)).toEqual({
      remove: true,
      revision: 7,
    });
  });

  it("carries the revision the ownership check was made at", () => {
    // That revision is what fences the write; a stale one must not be sent.
    expect(decideRemoval(view(WRITTEN, 31), WRITTEN)).toEqual({
      remove: true,
      revision: 31,
    });
  });

  it("leaves a route someone has edited", () => {
    const edited = { ...WRITTEN, defaultContextWindow: 262144 };
    expect(decideRemoval(view(edited), WRITTEN)).toEqual({
      remove: false,
      reason: "modified",
    });
  });

  it("leaves a route someone has narrowed", () => {
    const narrowed = { ...WRITTEN };
    delete (narrowed as { apiKeyEnv?: string }).apiKeyEnv;
    expect(decideRemoval(view(narrowed), WRITTEN)).toEqual({
      remove: false,
      reason: "modified",
    });
  });

  it("leaves a route replaced wholesale by someone else", () => {
    expect(decideRemoval(view({ apiKeyEnv: "SOMEONE_ELSES_KEY" }), WRITTEN)).toEqual({
      remove: false,
      reason: "modified",
    });
  });

  it("does nothing when the route is already gone", () => {
    expect(decideRemoval(view(undefined), WRITTEN)).toEqual({
      remove: false,
      reason: "absent",
    });
  });

  it("removes nothing when this load never wrote a profile", () => {
    expect(decideRemoval(view(WRITTEN), undefined)).toEqual({
      remove: false,
      reason: "modified",
    });
  });

  it("removes nothing when the section could not be read", () => {
    expect(decideRemoval(undefined, WRITTEN)).toEqual({
      remove: false,
      reason: "unreadable",
    });
  });

  it("compares against the raw user layer, not a resolved value", () => {
    // A resolved value folds in schema defaults, so it differs from what was
    // written even when nobody has touched the document. Comparing against it
    // would make the plugin think it never owned its own route.
    const resolved = { ...WRITTEN, defaultContextWindow: 262144, defaultMaxTokens: 32768 };
    expect(decideRemoval(view(resolved), WRITTEN).remove).toBe(false);
  });
});

describe("describeDecision", () => {
  it("names the route in every outcome", () => {
    const lines = [
      describeDecision("bitrouter", { remove: true, revision: 1 }),
      describeDecision("bitrouter", { remove: false, reason: "absent" }),
      describeDecision("bitrouter", { remove: false, reason: "modified" }),
      describeDecision("bitrouter", { remove: false, reason: "unreadable" }),
    ];
    for (const line of lines) expect(line).toContain("bitrouter");
    expect(lines[2]).toContain("leaving it in place");
  });
});
