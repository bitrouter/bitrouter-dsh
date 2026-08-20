import { describe, it, expect, vi } from "vitest";
import { resolveTarget, resolveSmartTarget, localDaemonServesModels } from "../src/target.js";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("resolveTarget", () => {
  it("maps each mode to its default endpoint", () => {
    expect(resolveTarget("local")).toEqual({
      mode: "local",
      baseUrl: "http://127.0.0.1:4356/v1",
    });
    expect(resolveTarget("cloud")).toEqual({
      mode: "cloud",
      baseUrl: "https://api.bitrouter.ai/v1",
    });
  });

  it("honors an explicit base URL for either mode", () => {
    expect(resolveTarget("cloud", "https://proxy.internal/v1").baseUrl).toBe(
      "https://proxy.internal/v1",
    );
  });
});

describe("localDaemonServesModels", () => {
  it("is true only for a non-empty catalog", async () => {
    const yes = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "a" }] }));
    const empty = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const bad = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    const down = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(localDaemonServesModels("u", yes as unknown as typeof fetch)).resolves.toBe(true);
    await expect(localDaemonServesModels("u", empty as unknown as typeof fetch)).resolves.toBe(false);
    await expect(localDaemonServesModels("u", bad as unknown as typeof fetch)).resolves.toBe(false);
    await expect(localDaemonServesModels("u", down as unknown as typeof fetch)).resolves.toBe(false);
  });
});

describe("resolveSmartTarget", () => {
  it("prefers local when the daemon serves a catalog", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "a" }] }));
    await expect(resolveSmartTarget("auto", undefined, f as unknown as typeof fetch)).resolves.toEqual(
      { mode: "local", baseUrl: "http://127.0.0.1:4356/v1" },
    );
  });

  it("falls back to cloud when nothing answers", async () => {
    const f = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(resolveSmartTarget("auto", undefined, f as unknown as typeof fetch)).resolves.toEqual(
      { mode: "cloud", baseUrl: "https://api.bitrouter.ai/v1" },
    );
  });

  it("does not probe when the target is explicit", async () => {
    const f = vi.fn();
    await expect(resolveSmartTarget("cloud", undefined, f as unknown as typeof fetch)).resolves.toEqual(
      { mode: "cloud", baseUrl: "https://api.bitrouter.ai/v1" },
    );
    expect(f).not.toHaveBeenCalled();
  });

  it("probes the overridden URL rather than the loopback default", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "a" }] }));
    const t = await resolveSmartTarget("auto", "http://10.0.0.5:4356/v1", f as unknown as typeof fetch);
    expect(t.baseUrl).toBe("http://10.0.0.5:4356/v1");
    expect(f).toHaveBeenCalledWith("http://10.0.0.5:4356/v1/models", expect.anything());
  });
});
