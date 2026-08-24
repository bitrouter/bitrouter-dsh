import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { AUTO_MODEL_ID } from "../src/constants.js";

/**
 * The bundle patch is the whole of "installing this plugin points the harness
 * at BitRouter" — it re-addresses dsh-base's `agent-default-model` row rather
 * than writing settings at run time. Nothing in `src/` can be wrong about it,
 * because nothing in `src/` reads it: it is data that `dsh` composes at boot.
 *
 * So it is checked here, against the file itself. A boot proves the same thing
 * and more, but it costs a harness install; this costs a YAML parse, and it is
 * what catches the ordinary mistake — a stale model id left behind when the id
 * changes.
 */

type PatchRow = {
  id?: string;
  name?: string;
  config?: Record<string, unknown>;
  insert?: { id?: string; name?: string }[];
};

const patch = load(
  readFileSync(fileURLToPath(new URL("../cordis.patch.yml", import.meta.url)), "utf8"),
) as PatchRow[];

describe("cordis.patch.yml", () => {
  it("is a list of patch rows", () => {
    expect(Array.isArray(patch)).toBe(true);
    expect(patch.length).toBeGreaterThan(0);
  });

  it("re-addresses agent-default-model at bitrouter", () => {
    const row = patch.find((r) => r.id === "agent-default-model");
    expect(row, "no agent-default-model row").toBeDefined();
    // A patch replaces the row's whole `config`, so both keys have to be here:
    // restating only one would drop the other back to dsh-base's default.
    expect(row!.config).toEqual({ provider: "bitrouter", model: AUTO_MODEL_ID });
  });

  it("names the model id the plugin actually advertises", () => {
    // The failure this exists for: the id moves in `constants.ts` and the patch
    // keeps pointing at the old one, so a fresh install defaults to a model the
    // gateway will not resolve.
    const row = patch.find((r) => r.id === "agent-default-model");
    expect(row!.config!.model).toBe(AUTO_MODEL_ID);
    expect(row!.config!.model).toBe("bitrouter/auto");
  });

  it("inserts this plugin exactly once", () => {
    const inserted = patch.flatMap((r) => r.insert ?? []);
    const mine = inserted.filter((e) => e.name === "@bitrouter/dsh");
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe("bitrouter");
  });

  it("inserts nothing else", () => {
    // Everything this plugin needs already ships in dsh-base; an extra row here
    // would be a second copy of something the base bundle already mounts.
    const inserted = patch.flatMap((r) => r.insert ?? []);
    expect(inserted.map((e) => e.name)).toEqual(["@bitrouter/dsh"]);
  });
});
