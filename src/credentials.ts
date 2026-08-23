/**
 * The BitRouter CLI's own account credentials, read so a `bitrouter auth login`
 * already done on this machine authenticates the harness route too.
 *
 * Why read a file rather than run a login flow here: `llm-pi-ai` cannot serve
 * an OAuth-only route at all — it builds its `Models` collection with no
 * credential store and runs no login flow, so a route that authenticates by
 * OAuth alone fails every request before it goes out. What it *can* do is
 * resolve an `apiKeyEnv` reference per request through `ctx.credentials`. So
 * the bridge is one-directional: the BitRouter CLI owns the grant, and this
 * plugin projects the access token it already holds into the reference the
 * route names.
 *
 * Deliberately **read-only**. Copying the grant and refreshing it from here
 * would make two processes owners of one refresh token, and a rotating
 * authorization server invalidates whichever copy refreshes second. Refresh
 * stays with `bitrouter auth login`, which is the process that obtained it.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type TokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: string };

interface RawCredentials {
  access_token?: unknown;
  expires_at?: unknown;
}

/** Compute the on-disk credentials path the BitRouter daemon writes. */
export function credentialsPath(env: Record<string, string | undefined>): string {
  const file = "account-credentials.json";
  if (env.XDG_DATA_HOME) return join(env.XDG_DATA_HOME, "bitrouter", file);
  if (process.platform === "win32" && env.LOCALAPPDATA) {
    return join(env.LOCALAPPDATA, "bitrouter", "data", file);
  }
  return join(env.HOME ?? homedir(), ".local", "share", "bitrouter", file);
}

/**
 * Validate a parsed credential object and extract a usable bearer token. An
 * expired token is a failure rather than a value: projecting it would
 * authenticate every request with something the gateway already refuses, and
 * the resulting 401 would look like a wrong key rather than a stale login.
 */
export function extractCloudToken(raw: RawCredentials, now: Date): TokenResult {
  if (typeof raw.access_token !== "string" || raw.access_token.length === 0) {
    return { ok: false, reason: "credentials file missing access_token" };
  }
  if (typeof raw.expires_at !== "string") {
    return { ok: false, reason: "credentials file missing expires_at" };
  }
  const expires = Date.parse(raw.expires_at);
  if (Number.isNaN(expires)) {
    return { ok: false, reason: "credentials file has unparseable expires_at" };
  }
  if (expires <= now.getTime()) {
    return {
      ok: false,
      reason: "cloud access token has expired; run `bitrouter auth login`",
    };
  }
  return { ok: true, token: raw.access_token };
}

/**
 * Read + validate the CLI credential file. Returns a failure result on any
 * IO/parse error — an absent file is the ordinary case (nobody has logged in)
 * and never an exception.
 */
export function loadCloudToken(
  env: Record<string, string | undefined>,
  now: Date,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): TokenResult {
  let text: string;
  try {
    text = readFile(credentialsPath(env));
  } catch {
    return {
      ok: false,
      reason: "no BitRouter cloud credentials; run `bitrouter auth login`",
    };
  }
  let parsed: RawCredentials;
  try {
    parsed = JSON.parse(text) as RawCredentials;
  } catch {
    return { ok: false, reason: "credentials file is not valid JSON" };
  }
  return extractCloudToken(parsed, now);
}
