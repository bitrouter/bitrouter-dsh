import { describe, it, expect, vi } from "vitest";
import { syncProfile } from "../src/sync.js";
import type { Config } from "../src/config.js";
import type { SyncDeps } from "../src/sync.js";

/**
 * The plugin's whole job: resolve a data plane, read the live catalog, and
 * write one `llm-pi-ai` route. These drive it through the injected seam so no
 * cordis kernel or settings provider is needed.
 */

const CONFIG: Config = {
  target: "auto",
  apiKeyEnv: "BITROUTER_API_KEY",
  route: "bitrouter",
  displayName: "BitRouter",
  manageProfile: true,
  removeOnUnload: true,
  probeTimeoutMs: 1500,
};

const CATALOG = {
  data: [
    { id: "kimi-k2.5", name: "Kimi K2.5", context_window: 256000 },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function deps(overrides: Partial<SyncDeps> = {}): SyncDeps & {
  updateSettings: ReturnType<typeof vi.fn>;
  log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
} {
  const updateSettings = vi.fn().mockResolvedValue(undefined);
  const log = { info: vi.fn(), warn: vi.fn() };
  return {
    env: {},
    fetch: vi.fn().mockResolvedValue(jsonResponse(CATALOG)) as unknown as typeof fetch,
    log,
    updateSettings,
    ...overrides,
  } as SyncDeps & {
    updateSettings: ReturnType<typeof vi.fn>;
    log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  };
}

describe("syncProfile", () => {
  it("writes the discovered catalog as one route under providers", async () => {
    const d = deps();
    const result = await syncProfile(CONFIG, d);

    expect(result.placeholder).toBe(false);
    expect(result.target.mode).toBe("local");
    expect(d.updateSettings).toHaveBeenCalledTimes(1);
    const patch = d.updateSettings.mock.calls[0][0] as {
      providers: Record<string, { baseURL: string; models: { id: string }[] }>;
    };
    // Only this route is named, so the patch cannot disturb another adapter's.
    expect(Object.keys(patch.providers)).toEqual(["bitrouter"]);
    expect(patch.providers.bitrouter.baseURL).toBe("http://127.0.0.1:4356/v1");
    expect(patch.providers.bitrouter.models.map((m) => m.id)).toEqual([
      "kimi-k2.5",
      "claude-opus-4-8",
    ]);
  });

  it("honors the configured route key", async () => {
    const d = deps();
    await syncProfile({ ...CONFIG, route: "br-staging" }, d);
    const patch = d.updateSettings.mock.calls[0][0] as { providers: Record<string, unknown> };
    expect(Object.keys(patch.providers)).toEqual(["br-staging"]);
  });

  it("authenticates discovery with the referenced environment variable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CATALOG));
    const d = deps({
      env: { BITROUTER_API_KEY: "brvk_secret" },
      fetch: fetchMock as unknown as typeof fetch,
    });
    await syncProfile({ ...CONFIG, target: "cloud" }, d);
    expect(fetchMock).toHaveBeenCalledWith("https://api.bitrouter.ai/v1/models", {
      headers: { Authorization: "Bearer brvk_secret" },
      signal: undefined,
    });
    // The key itself is a reference in the written profile, never a value.
    const patch = d.updateSettings.mock.calls[0][0] as {
      providers: Record<string, Record<string, unknown>>;
    };
    expect(patch.providers.bitrouter.apiKeyEnv).toBe("BITROUTER_API_KEY");
    expect(JSON.stringify(patch)).not.toContain("brvk_secret");
  });

  it("still writes a serviceable route when discovery fails", async () => {
    const d = deps({
      fetch: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch,
    });
    const result = await syncProfile({ ...CONFIG, target: "cloud" }, d);

    expect(result.placeholder).toBe(true);
    expect(result.profile.models).toHaveLength(1);
    expect(d.updateSettings).toHaveBeenCalledTimes(1);
    expect(d.log.warn).toHaveBeenCalled();
  });

  it("still writes a serviceable route when the catalog is empty", async () => {
    const d = deps({
      fetch: vi.fn().mockResolvedValue(jsonResponse({ data: [] })) as unknown as typeof fetch,
    });
    const result = await syncProfile({ ...CONFIG, target: "cloud" }, d);
    expect(result.placeholder).toBe(true);
    expect(result.profile.models?.[0].id).toBe("kimi-k2.5");
  });

  it("selects cloud when no local daemon answers the auto probe", async () => {
    const fetchMock = vi
      .fn()
      // the probe
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      // the cloud catalog read
      .mockResolvedValueOnce(jsonResponse(CATALOG));
    const d = deps({ fetch: fetchMock as unknown as typeof fetch });
    const result = await syncProfile(CONFIG, d);
    expect(result.target).toEqual({
      mode: "cloud",
      baseUrl: "https://api.bitrouter.ai/v1",
    });
  });

  it("reports the route and endpoint it registered", async () => {
    const d = deps();
    await syncProfile(CONFIG, d);
    expect(d.log.info.mock.calls[0][0]).toContain("bitrouter");
    expect(d.log.info.mock.calls[0][0]).toContain("http://127.0.0.1:4356/v1");
  });
});
