import { describe, it, expect } from "vitest";
import { Config } from "../src/config.js";

/** Cordis validates the `cordis.yml` entry config against this schema before
 * `apply` runs, so these pin what an omitted block resolves to. A YAML entry
 * arrives untyped, which is what `parse` models. */
const parse = (raw: unknown): Config => Config(raw as Config);

describe("Config", () => {
  it("resolves an empty entry config to a working default", () => {
    expect(parse({})).toEqual({
      target: "auto",
      apiKeyEnv: "BITROUTER_API_KEY",
      route: "bitrouter",
      displayName: "BitRouter",
      manageProfile: true,
      removeOnUnload: true,
      probeTimeoutMs: 1500,
    });
  });

  it("keeps what the entry sets", () => {
    const c = parse({ target: "cloud", route: "br-prod", manageProfile: false });
    expect(c.target).toBe("cloud");
    expect(c.route).toBe("br-prod");
    expect(c.manageProfile).toBe(false);
    expect(c.displayName).toBe("BitRouter");
  });

  it("rejects a target it cannot serve", () => {
    expect(() => parse({ target: "somewhere-else" })).toThrow();
  });

  it("rejects a non-numeric probe timeout", () => {
    expect(() => parse({ probeTimeoutMs: "soon" })).toThrow();
  });
});
