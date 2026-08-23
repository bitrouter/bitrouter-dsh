/**
 * Filling the route's credential reference from a login the BitRouter CLI
 * already did.
 *
 * The route names a credential *reference* — an environment-variable name —
 * and `llm-pi-ai` resolves it per request through `ctx.credentials`. That
 * reference resolves over four layers (process environment, the managed
 * `$DSH_HOME/.credentials.yaml` document, then two `.env` files), and this
 * module writes into exactly one of them, in exactly one situation: when the
 * reference resolves to nothing at all and the BitRouter CLI is holding a live
 * access token.
 *
 * The "nothing at all" guard is the whole safety argument, and it is checked
 * rather than assumed:
 *
 * - A key the operator exported for this run wins, and is *read-only* to the
 *   seam — `set` would reject it anyway. Skipping first turns a rejection into
 *   a decision.
 * - A key the user stored by hand in `.credentials.yaml`, or wrote into a
 *   `.env`, is theirs. Overwriting it with a token that expires in an hour
 *   would silently replace a durable credential with a perishable one.
 *
 * So this never rotates, replaces, or removes a credential. It only fills a
 * gap, which is why it needs no configuration beyond an off switch.
 */

import { loadCloudToken, type TokenResult } from "./credentials.js";

/** The credential-seam surface this module needs, so tests need no kernel. */
export interface CredentialSeam {
  /** Source and writability facts for one reference — never the value. */
  describe: (ref: string) => Promise<{
    configured: boolean;
    source?: string;
    writable: boolean;
  }>;
  /** Durably store one value in the provider-managed writable source. */
  set: (ref: string, value: string) => Promise<void>;
}

export interface AdoptDeps {
  env: Record<string, string | undefined>;
  now: () => Date;
  credentials: CredentialSeam;
  log: { info: (message: string) => void; warn: (message: string) => void };
  /** Injected for tests; defaults to the real credential file reader. */
  loadToken?: (env: Record<string, string | undefined>, now: Date) => TokenResult;
}

export type AdoptOutcome =
  /** The reference already resolves; nothing was written. */
  | { adopted: false; reason: "already-configured"; source?: string }
  /** No live CLI token to adopt. */
  | { adopted: false; reason: "no-cli-token"; detail: string }
  /** The reference is unconfigured and no layer here can be written. */
  | { adopted: false; reason: "not-writable" }
  /** The write failed; the route is left as it was. */
  | { adopted: false; reason: "write-failed"; detail: string }
  /** A live CLI access token now backs the reference. */
  | { adopted: true };

/**
 * Fill `ref` from the BitRouter CLI's stored access token, if and only if the
 * reference is currently unconfigured.
 *
 * Never throws: every failure is an outcome the caller logs and continues
 * past. A route with no credential is a route that fails its requests with a
 * nameable error, which is strictly better than a plugin that refuses to load.
 */
export async function adoptCliLogin(
  ref: string,
  deps: AdoptDeps,
): Promise<AdoptOutcome> {
  let info: { configured: boolean; source?: string; writable: boolean };
  try {
    info = await deps.credentials.describe(ref);
  } catch (err) {
    return { adopted: false, reason: "write-failed", detail: String(err) };
  }

  // The gap-filling rule: anything already behind the reference stays.
  if (info.configured) {
    return { adopted: false, reason: "already-configured", source: info.source };
  }

  const load = deps.loadToken ?? loadCloudToken;
  const token = load(deps.env, deps.now());
  if (!token.ok) {
    return { adopted: false, reason: "no-cli-token", detail: token.reason };
  }

  if (!info.writable) return { adopted: false, reason: "not-writable" };

  try {
    await deps.credentials.set(ref, token.token);
  } catch (err) {
    return { adopted: false, reason: "write-failed", detail: String(err) };
  }
  return { adopted: true };
}

/** Render an outcome as the one line a deployment needs to see. */
export function describeOutcome(ref: string, outcome: AdoptOutcome): string {
  if (outcome.adopted) {
    return `bitrouter: filled ${ref} from the BitRouter CLI's stored access token`;
  }
  switch (outcome.reason) {
    case "already-configured":
      return `bitrouter: ${ref} is already configured${
        outcome.source ? ` from ${outcome.source}` : ""
      }; leaving it alone`;
    case "no-cli-token":
      return `bitrouter: ${ref} is unconfigured and ${outcome.detail}`;
    case "not-writable":
      return `bitrouter: ${ref} is unconfigured and no writable credential source is mounted`;
    case "write-failed":
      return `bitrouter: could not fill ${ref} from the BitRouter CLI login: ${outcome.detail}`;
  }
}
