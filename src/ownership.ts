/**
 * Deciding whether this plugin may still remove the route it wrote.
 *
 * `removeOnUnload` exists so uninstalling leaves no orphan. Taken literally it
 * is also a way to lose work: between the write and the unload a deployment can
 * open the web Models page, hand-edit `$DSH_HOME/settings.yaml`, or run a second
 * dsh, and an unconditional `unset` on `providers.<route>` would delete whatever
 * they did along with what this plugin put there.
 *
 * So removal is conditional on *ownership*, and ownership is checked rather than
 * assumed: the route is removed only when what is stored is still exactly what
 * this plugin last wrote. Anything else — an edited route, a route someone
 * replaced wholesale, a route already gone — is left alone. The asymmetry is
 * deliberate: a leftover route is a line in a settings file that the next load
 * overwrites anyway, while a deleted one is a deployment's configuration gone.
 *
 * Note the comparison is against the **raw user layer**, not the resolved value.
 * The resolved value folds in the composition base and schema defaults, so it
 * differs from what was written even when nobody has touched the document.
 */

import { deepEqualJson } from "@deepseek-ai/dsh-settings";

/** The raw user-layer route and the revision it was read at. */
export interface StoredRouteView {
  /**
   * Raw user-section value at `providers.<route>`, or `undefined` when the
   * section, its `providers` dict, or this route is absent.
   */
  route: unknown;
  /** Monotonic revision of the raw user section this view was read at. */
  revision: number;
}

export type RemovalDecision =
  /** Still ours: remove it, fencing the write against this revision. */
  | { remove: true; revision: number }
  /** Already gone; nothing to do. */
  | { remove: false; reason: "absent" }
  /** Someone else's now — an edit, or a wholesale replacement. Leave it. */
  | { remove: false; reason: "modified" }
  /** The section could not be read, so ownership cannot be established. */
  | { remove: false; reason: "unreadable" };

/**
 * Pull `providers.<route>` out of a raw user section, tolerating every shape a
 * hand-edited document can be in.
 * @param section - the raw user-layer section, whatever it holds.
 * @param route - the route key this plugin owns.
 */
export function routeFromSection(section: unknown, route: string): unknown {
  if (typeof section !== "object" || section === null || Array.isArray(section)) {
    return undefined;
  }
  const providers = (section as { providers?: unknown }).providers;
  if (typeof providers !== "object" || providers === null || Array.isArray(providers)) {
    return undefined;
  }
  return (providers as Record<string, unknown>)[route];
}

/**
 * Decide whether the stored route is still the one this plugin wrote.
 *
 * @param view - the raw user-layer route and its revision, or `undefined` when
 *   the namespace could not be read at all.
 * @param written - the profile this plugin last wrote, or `undefined` when it
 *   never got as far as writing one.
 */
export function decideRemoval(
  view: StoredRouteView | undefined,
  written: unknown,
): RemovalDecision {
  if (view === undefined) return { remove: false, reason: "unreadable" };
  if (view.route === undefined) return { remove: false, reason: "absent" };
  // Nothing was written this load, so nothing here is ours to take back.
  if (written === undefined) return { remove: false, reason: "modified" };
  return deepEqualJson(view.route, written)
    ? { remove: true, revision: view.revision }
    : { remove: false, reason: "modified" };
}

/** Render a decision as the one line a deployment needs to see. */
export function describeDecision(route: string, decision: RemovalDecision): string {
  if (decision.remove) return `bitrouter: removed the "${route}" route on unload`;
  switch (decision.reason) {
    case "absent":
      return `bitrouter: the "${route}" route is already gone; nothing to remove on unload`;
    case "modified":
      return `bitrouter: the "${route}" route has been changed since this plugin wrote it; leaving it in place rather than deleting someone else's edit`;
    case "unreadable":
      return `bitrouter: could not read the settings section to check ownership of the "${route}" route; leaving it in place`;
  }
}
