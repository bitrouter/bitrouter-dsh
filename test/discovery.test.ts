import { describe, it, expect, vi } from "vitest";
import { discoverModels } from "../src/discovery.js";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("discoverModels", () => {
  it("returns the listed models", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "m1" }] }));
    await expect(
      discoverModels("http://x/v1", undefined, f as unknown as typeof fetch),
    ).resolves.toEqual([{ id: "m1" }]);
    expect(f).toHaveBeenCalledWith("http://x/v1/models", {
      headers: {},
      signal: undefined,
    });
  });

  it("sends a bearer token when one is supplied", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    await discoverModels("http://x/v1", "brvk_abc", f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith("http://x/v1/models", {
      headers: { Authorization: "Bearer brvk_abc" },
      signal: undefined,
    });
  });

  it("treats a missing or non-array data key as an empty catalog", async () => {
    for (const body of [{}, { data: "nope" }]) {
      const f = vi.fn().mockResolvedValue(jsonResponse(body));
      await expect(
        discoverModels("http://x/v1", undefined, f as unknown as typeof fetch),
      ).resolves.toEqual([]);
    }
  });

  it("drops unusable entries instead of failing the whole listing", async () => {
    const f = vi.fn().mockResolvedValue(
      jsonResponse({ data: [{ id: "ok" }, { id: "" }, { name: "no id" }, null, "x"] }),
    );
    await expect(
      discoverModels("http://x/v1", undefined, f as unknown as typeof fetch),
    ).resolves.toEqual([{ id: "ok" }]);
  });

  it("throws on a non-OK response", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    await expect(
      discoverModels("http://x/v1", undefined, f as unknown as typeof fetch),
    ).rejects.toThrow("HTTP 401");
  });
});
