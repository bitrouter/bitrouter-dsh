import { describe, it, expect, vi } from "vitest";
import { adoptCliLogin, describeOutcome, type CredentialSeam } from "../src/auth.js";
import { credentialsPath, extractCloudToken, loadCloudToken } from "../src/credentials.js";

const REF = "BITROUTER_API_KEY";
const NOW = new Date("2026-08-23T12:00:00Z");
const LIVE = { access_token: "acc_live", expires_at: "2026-08-23T13:00:00Z" };

function seam(
  info: { configured: boolean; source?: string; writable: boolean },
  set = vi.fn().mockResolvedValue(undefined),
): { seam: CredentialSeam; set: ReturnType<typeof vi.fn> } {
  return {
    seam: { describe: vi.fn().mockResolvedValue(info), set },
    set,
  };
}

function deps(
  info: { configured: boolean; source?: string; writable: boolean },
  raw: unknown = LIVE,
  set?: ReturnType<typeof vi.fn>,
) {
  const s = seam(info, set);
  return {
    ...s,
    all: {
      env: {},
      now: () => NOW,
      credentials: s.seam,
      log: { info: vi.fn(), warn: vi.fn() },
      loadToken: () =>
        extractCloudToken(raw as Record<string, unknown>, NOW),
    },
  };
}

describe("adoptCliLogin", () => {
  it("fills a reference that resolves to nothing", async () => {
    const d = deps({ configured: false, writable: true });
    const outcome = await adoptCliLogin(REF, d.all);
    expect(outcome).toEqual({ adopted: true });
    expect(d.set).toHaveBeenCalledWith(REF, "acc_live");
  });

  it("leaves a key the operator exported for this run alone", async () => {
    // The process-environment layer is read-only to the seam, so `set` would
    // reject anyway — skipping first turns a rejection into a decision.
    const d = deps({ configured: true, source: "env", writable: false });
    const outcome = await adoptCliLogin(REF, d.all);
    expect(outcome).toEqual({
      adopted: false,
      reason: "already-configured",
      source: "env",
    });
    expect(d.set).not.toHaveBeenCalled();
  });

  it("leaves a key the user stored by hand alone", async () => {
    // Overwriting a durable credential with a token that expires in an hour
    // would be a silent downgrade.
    const d = deps({ configured: true, source: "file", writable: true });
    const outcome = await adoptCliLogin(REF, d.all);
    expect(outcome.adopted).toBe(false);
    expect(d.set).not.toHaveBeenCalled();
  });

  it("does nothing when no login has been done", async () => {
    const d = deps({ configured: false, writable: true }, {});
    const outcome = await adoptCliLogin(REF, d.all);
    expect(outcome).toMatchObject({ adopted: false, reason: "no-cli-token" });
    expect(d.set).not.toHaveBeenCalled();
  });

  it("refuses an expired token rather than projecting it", async () => {
    // A stale token would make every request 401, which reads as a wrong key
    // rather than a stale login.
    const d = deps({ configured: false, writable: true }, {
      access_token: "acc_old",
      expires_at: "2026-08-23T11:00:00Z",
    });
    const outcome = await adoptCliLogin(REF, d.all);
    expect(outcome).toMatchObject({ adopted: false, reason: "no-cli-token" });
    expect((outcome as { detail: string }).detail).toContain("expired");
    expect(d.set).not.toHaveBeenCalled();
  });

  it("reports a read-only credential source rather than throwing", async () => {
    const d = deps({ configured: false, writable: false });
    expect(await adoptCliLogin(REF, d.all)).toEqual({
      adopted: false,
      reason: "not-writable",
    });
  });

  it("contains a write failure so the plugin still loads", async () => {
    const set = vi.fn().mockRejectedValue(new Error("disk full"));
    const d = deps({ configured: false, writable: true }, LIVE, set);
    const outcome = await adoptCliLogin(REF, d.all);
    expect(outcome).toMatchObject({ adopted: false, reason: "write-failed" });
    expect((outcome as { detail: string }).detail).toContain("disk full");
  });

  it("contains a describe failure the same way", async () => {
    const outcome = await adoptCliLogin(REF, {
      env: {},
      now: () => NOW,
      credentials: {
        describe: vi.fn().mockRejectedValue(new Error("seam down")),
        set: vi.fn(),
      },
      log: { info: vi.fn(), warn: vi.fn() },
      loadToken: () => extractCloudToken(LIVE, NOW),
    });
    expect(outcome).toMatchObject({ adopted: false, reason: "write-failed" });
  });
});

describe("describeOutcome", () => {
  it("names the reference in every outcome", () => {
    const lines = [
      describeOutcome(REF, { adopted: true }),
      describeOutcome(REF, { adopted: false, reason: "already-configured", source: "env" }),
      describeOutcome(REF, { adopted: false, reason: "no-cli-token", detail: "no creds" }),
      describeOutcome(REF, { adopted: false, reason: "not-writable" }),
      describeOutcome(REF, { adopted: false, reason: "write-failed", detail: "boom" }),
    ];
    for (const line of lines) expect(line).toContain(REF);
    expect(lines[1]).toContain("env");
  });

  it("never renders the token itself", () => {
    expect(describeOutcome(REF, { adopted: true })).not.toContain("acc_live");
  });
});

describe("credentialsPath", () => {
  it("prefers XDG_DATA_HOME", () => {
    expect(credentialsPath({ XDG_DATA_HOME: "/xdg" })).toBe(
      "/xdg/bitrouter/account-credentials.json",
    );
  });

  it("falls back to ~/.local/share", () => {
    expect(credentialsPath({ HOME: "/home/u" })).toBe(
      "/home/u/.local/share/bitrouter/account-credentials.json",
    );
  });
});

describe("loadCloudToken", () => {
  it("treats an absent file as 'nobody has logged in', not an error", () => {
    const r = loadCloudToken({ HOME: "/nope" }, NOW, () => {
      throw new Error("ENOENT");
    });
    expect(r).toEqual({
      ok: false,
      reason: "no BitRouter cloud credentials; run `bitrouter auth login`",
    });
  });

  it("reports unparseable JSON rather than throwing", () => {
    const r = loadCloudToken({ HOME: "/h" }, NOW, () => "not json");
    expect(r).toMatchObject({ ok: false });
  });

  it("reads a live token", () => {
    const r = loadCloudToken({ HOME: "/h" }, NOW, () => JSON.stringify(LIVE));
    expect(r).toEqual({ ok: true, token: "acc_live" });
  });
});
