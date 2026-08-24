import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Context, Service } from "@deepseek-ai/cordis";
import * as bitrouter from "../src/index.js";
import type { Config } from "../src/config.js";

/**
 * Does the plugin actually load?
 *
 * Every other test here calls this package's own functions directly, so none of
 * them exercises the one contract that decides whether any of it runs: cordis's
 * own. A malformed `inject` declaration once left this plugin PENDING — it
 * never reached `apply()` and took the whole harness boot down with it — while
 * the entire suite passed and CI was green.
 *
 * `inject` is a cordis contract rather than a harness one, so catching that
 * needs cordis and nothing else: no dsh, no harness install, no network. The
 * stub below is the whole of what this plugin requires to activate.
 */

/** The `settings` service, reduced to the surface `apply()` touches. */
class StubSettings extends Service {
  /** Every namespace patch the plugin wrote, for the assertions. */
  readonly writes: { ns: unknown; patch: unknown }[] = [];
  readonly ops: { ns: unknown; ops: unknown; revision?: number }[] = [];
  section: Record<string, unknown> = {};
  revision = 1;

  constructor(ctx: Context) {
    // The name given here is what cordis provides under; the static `provide`
    // field only supplies a default for it.
    super(ctx, "settings");
  }

  register(): object {
    return {};
  }

  describe(): { ns: unknown; user: unknown; revision: number }[] {
    return [{ ns: this.ns, user: this.section, revision: this.revision }];
  }

  async update(ns: unknown, patch: Record<string, unknown>): Promise<void> {
    this.ns = ns;
    this.writes.push({ ns, patch });
    const providers = patch.providers as Record<string, unknown> | undefined;
    this.section = {
      ...this.section,
      providers: { ...((this.section.providers ?? {}) as object), ...(providers ?? {}) },
    };
  }

  async mutate(ns: unknown, ops: unknown, revision?: number): Promise<void> {
    this.ops.push({ ns, ops, revision });
  }

  private ns: unknown = undefined;
}

const CONFIG: Config = {
  target: "cloud",
  apiKeyEnv: "BITROUTER_ACTIVATION_KEY",
  route: "bitrouter",
  displayName: "BitRouter",
  manageProfile: true,
  removeOnUnload: false,
  probeTimeoutMs: 50,
  adoptCliLogin: false,
};

/** Let `apply()` run its course without a gateway: discovery fails, the auto route is written. */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no gateway in this test");
    }),
  );
}

/** cordis activates plugins asynchronously; give the fiber a turn to settle. */
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("cordis activation", () => {
  beforeEach(stubFetch);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("activates against a context providing only `settings`", async () => {
    const ctx = new Context();
    ctx.plugin(StubSettings);
    ctx.plugin(bitrouter, CONFIG);
    await settle();

    // The write is the proof that `apply()` ran at all: a plugin left PENDING
    // by a bad `inject` never reaches it, and this list stays empty.
    const settings = ctx.get("settings") as unknown as StubSettings;
    expect(settings.writes.length).toBeGreaterThan(0);
  });

  it("writes the route it was configured to own", async () => {
    const ctx = new Context();
    ctx.plugin(StubSettings);
    ctx.plugin(bitrouter, { ...CONFIG, route: "br-staging" });
    await settle();

    const settings = ctx.get("settings") as unknown as StubSettings;
    const patch = settings.writes.at(-1)!.patch as {
      providers: Record<string, { models: { id: string }[] }>;
    };
    expect(Object.keys(patch.providers)).toEqual(["br-staging"]);
    // Discovery failed, so this is the auto route standing alone — which is the
    // shape that keeps an unreachable gateway serviceable.
    expect(patch.providers["br-staging"].models.map((m) => m.id)).toEqual([
      "bitrouter/auto",
    ]);
  });

  it("declares an inject cordis can satisfy", () => {
    // The direct statement of the bug: `inject` must be a list of service names
    // (or a name → intercept-config map). An object like
    // `{ required: [...], optional: [...] }` reads as two services nobody
    // provides, and the plugin waits for them forever.
    expect(Array.isArray(bitrouter.inject)).toBe(true);
    expect(bitrouter.inject).toContain("settings");
    for (const name of bitrouter.inject) {
      expect(typeof name).toBe("string");
      expect(["required", "optional"]).not.toContain(name);
    }
  });

  it("still activates when no credentials service is mounted", async () => {
    // `credentials` is deliberately not injected — there is no optional form,
    // and an entry would leave the plugin PENDING in exactly this composition.
    const ctx = new Context();
    ctx.plugin(StubSettings);
    ctx.plugin(bitrouter, { ...CONFIG, adoptCliLogin: true });
    await settle();

    const settings = ctx.get("settings") as unknown as StubSettings;
    expect(settings.writes.length).toBeGreaterThan(0);
  });
});
