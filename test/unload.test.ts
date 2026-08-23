import { describe, it, expect, vi } from "vitest";
import { settingsNamespace, SettingsConflictError } from "@deepseek-ai/dsh-settings";
import { apply } from "../src/index.js";
import type { Config } from "../src/config.js";

/**
 * The unload path end to end: `apply()` writes the route, and the disposer it
 * registers removes that route only while it is still the one this plugin
 * wrote, fencing the delete against the revision the check was made at.
 */

const NS = settingsNamespace("llm-pi-ai");

const CONFIG: Config = {
  target: "cloud",
  apiKeyEnv: "BITROUTER_API_KEY",
  route: "bitrouter",
  displayName: "BitRouter",
  manageProfile: true,
  removeOnUnload: true,
  probeTimeoutMs: 1500,
  adoptCliLogin: false,
};

const CATALOG = { data: [{ id: "kimi-k2.5", name: "Kimi K2.5" }] };

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/**
 * A context holding a single raw user section, so the ownership read sees
 * exactly what the write produced — the point of the test is the round trip.
 */
function makeCtx(opts: { mutate?: ReturnType<typeof vi.fn>; revision?: number } = {}) {
  let user: Record<string, unknown> = {};
  let disposer: (() => void) | undefined;
  const logs: string[] = [];

  const mutate =
    opts.mutate ??
    vi.fn(async (_ns: unknown, ops: readonly { path: readonly string[] }[]) => {
      const providers = (user.providers ?? {}) as Record<string, unknown>;
      for (const op of ops) delete providers[op.path[1]];
    });

  const ctx = {
    logger: {
      info: (m: string) => logs.push(`info: ${m}`),
      warn: (m: string) => logs.push(`warn: ${m}`),
    },
    settings: {
      update: vi.fn(async (_ns: unknown, patch: Record<string, unknown>) => {
        // Deep-merge one level, which is all this plugin's patch needs. The
        // JSON round trip is the point: a real document is written to YAML and
        // read back, so ownership can never rest on object identity.
        const incoming = JSON.parse(JSON.stringify(patch.providers)) as Record<string, unknown>;
        user = {
          ...user,
          providers: { ...((user.providers ?? {}) as object), ...incoming },
        };
      }),
      describe: vi.fn(() => [
        { ns: NS, user, revision: opts.revision ?? 7 },
      ]),
      mutate,
    },
    effect: vi.fn((fn: () => () => void) => {
      disposer = fn();
    }),
  };

  return {
    ctx,
    mutate,
    logs,
    storedRoute: () => (user.providers as Record<string, unknown> | undefined)?.bitrouter,
    editRoute: (next: unknown) => {
      user = { ...user, providers: { ...(user.providers as object), bitrouter: next } };
    },
    unload: async () => {
      disposer?.();
      // The disposer starts an async task it cannot await; let it settle.
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

async function load(t: ReturnType<typeof makeCtx>, config: Config = CONFIG) {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(CATALOG)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await apply(t.ctx as any, config);
}

describe("removeOnUnload", () => {
  it("removes the route it wrote, fencing the delete on the revision it checked", async () => {
    const t = makeCtx({ revision: 31 });
    await load(t);
    expect(t.storedRoute()).toBeDefined();

    await t.unload();

    expect(t.mutate).toHaveBeenCalledTimes(1);
    const [, ops, revision] = t.mutate.mock.calls[0];
    expect(ops).toEqual([{ op: "unset", path: ["providers", "bitrouter"] }]);
    expect(revision).toBe(31);
    expect(t.storedRoute()).toBeUndefined();
  });

  it("leaves a route someone edited after it was written", async () => {
    const t = makeCtx();
    await load(t);
    // A deployment corrects the route by hand between load and unload.
    t.editRoute({ ...(t.storedRoute() as object), defaultContextWindow: 262144 });

    await t.unload();

    expect(t.mutate).not.toHaveBeenCalled();
    expect(t.storedRoute()).toMatchObject({ defaultContextWindow: 262144 });
    expect(t.logs.join("\n")).toContain("leaving it in place");
  });

  it("does nothing when the route is already gone", async () => {
    const t = makeCtx();
    await load(t);
    t.editRoute(undefined);

    await t.unload();
    expect(t.mutate).not.toHaveBeenCalled();
  });

  it("leaves the route in place when the fenced delete is refused", async () => {
    // Something landed between the ownership read and the write. A refusal is
    // the outcome we want, so it is reported and never retried.
    const mutate = vi.fn().mockRejectedValue(new SettingsConflictError(NS, 7, 9));
    const t = makeCtx({ mutate });
    await load(t);

    await t.unload();

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(t.logs.join("\n")).toContain("leaving it in place");
    // Reported as ordinary news, not as a failure — nothing went wrong.
    expect(t.logs.some((l) => l.startsWith("warn:"))).toBe(false);
  });

  it("registers no disposer at all when removeOnUnload is off", async () => {
    const t = makeCtx();
    await load(t, { ...CONFIG, removeOnUnload: false });
    expect(t.ctx.effect).not.toHaveBeenCalled();
    await t.unload();
    expect(t.mutate).not.toHaveBeenCalled();
  });
});
