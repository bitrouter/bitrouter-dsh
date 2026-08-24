import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

/**
 * The wire contract, checked against the contract BitRouter publishes.
 *
 * `test/wire.test.ts` proves the mapper reads a captured body correctly. It
 * cannot prove the capture still resembles what the server sends — a fixture
 * is a snapshot, and a snapshot goes stale in silence. That is not a
 * hypothetical failure: this package once read `context_window`, a flat
 * `cost`, and a boolean `reasoning`, none of which BitRouter has ever sent, so
 * every model in the catalog was silently sized by the route's default. No
 * test failed. Somebody had to read the code.
 *
 * BitRouter Cloud generates an OpenAPI document from the Rust types that
 * serialize the response and serves it unauthenticated, so the contract is
 * *published* — `schema/models.schema.json` is a vendored copy, refreshed by
 * `npm run schema:refresh` and by a scheduled workflow that opens a pull
 * request when it moves.
 *
 * The load-bearing assertion is the first one. It is not "does the fixture
 * parse"; it is "has the set of fields BitRouter serves changed since somebody
 * last looked". A new field fails this suite once, and the fix is to decide —
 * in `ACKNOWLEDGED`, in one line — whether to map it or to ignore it on
 * purpose. That is the whole mechanism: drift cannot pass silently, and
 * acknowledging it is cheap.
 *
 * The local daemon has no equivalent. `GET /v1/models` in
 * `crates/bitrouter-sdk/src/server.rs` builds its body from an inline
 * `serde_json::json!` literal rather than a schema-derived type, so there is
 * nothing published to check `local-models.json` against. See
 * bitrouter/bitrouter — the fix is a typed struct with a `JsonSchema` derive,
 * at which point this file gains a second describe block.
 */

// `uint64`, `uint`, and `double` are Rust's numeric widths surviving into the
// document as format hints. They are not JSON Schema formats, ajv has no
// validator for them, and saying so keeps it from narrating that fact once per
// occurrence per compile.
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });

function load(path: string): any {
  return JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));
}

const schema = load("../schema/models.schema.json");
const modelResponse = schema.$defs.ModelResponse;

/**
 * Every property of BitRouter Cloud's `ModelResponse`, and what this package
 * does with it. Adding a key here is a decision, which is the point: the test
 * below fails until one has been made.
 *
 * `use` is what the fixture-coverage assertion reads, so it has to describe
 * this package honestly rather than aspirationally:
 *
 * - `profile` — reaches the llm-pi-ai route this plugin writes.
 * - `read`    — parsed and exported, but not carried into the route.
 * - `none`    — neither, and for a stated reason.
 */
const ACKNOWLEDGED: Record<string, { use: "profile" | "read" | "none"; why: string }> = {
  id: { use: "profile", why: "the model id — the only field both data planes share" },
  name: { use: "profile", why: "display name" },
  max_input_tokens: {
    use: "profile",
    why: "the context window. There is no `context_window` field, and reading one is the bug this suite exists to prevent",
  },
  max_output_tokens: { use: "profile", why: "the output cap" },
  input_modalities: { use: "profile", why: "drives the route's `input`, vision included" },
  capabilities: {
    use: "profile",
    why: "open list of tokens; `image_input` merges into `input` where the modality list is empty",
  },
  providers: {
    use: "read",
    why: "`providerCount` reads `{ total_online }` here and `string[]` from the local daemon; exported, but a route has nowhere to put it",
  },

  // Present on the wire, deliberately not carried. A hand-declared llm-pi-ai
  // model profile is `{ id, name, contextWindow, maxTokens, input }` and
  // nothing else, so there is no field these could land in. Inventing one
  // would be this plugin asserting something the harness cannot act on.
  description: { use: "none", why: "no corresponding field on a pi-ai model profile" },
  output_modalities: {
    use: "none",
    why: "no corresponding field; the synthesized auto route declares its own",
  },
  pricing: {
    use: "none",
    why: "no corresponding field. Note `context_tiers`: a model can be billed at a steeper rate above a context threshold, so any future mapping has to resolve the bracket rather than read the base one",
  },
  hosted: { use: "none", why: "provisioning fact, not a capability of the model" },
  open_weights: { use: "none", why: "licensing fact, not a capability of the model" },
  latency: { use: "none", why: "a rolling measurement, not part of a model's description" },
  throughput: { use: "none", why: "a rolling measurement, not part of a model's description" },
};

describe("BitRouter Cloud's published /v1/models contract", () => {
  it("serves exactly the fields this package has looked at", () => {
    const served = Object.keys(modelResponse.properties).sort();
    const acknowledged = Object.keys(ACKNOWLEDGED).sort();

    // Spelled as two directed differences rather than one equality, because
    // the two failures mean opposite things and want different fixes.
    const appeared = served.filter((f) => !(f in ACKNOWLEDGED));
    const vanished = acknowledged.filter((f) => !(f in modelResponse.properties));

    expect(
      appeared,
      "BitRouter now serves fields this package has never considered. Decide whether to map each one, then record the decision in ACKNOWLEDGED.",
    ).toEqual([]);
    expect(
      vanished,
      "BitRouter has stopped serving fields this package expects. Anything mapped is now silently falling back to a default — the failure mode this suite exists to catch.",
    ).toEqual([]);
  });

  it("still requires the id every other mapping hangs off", () => {
    expect(modelResponse.required).toContain("id");
    expect(modelResponse.properties.id.type).toBe("string");
  });

  it("still carries the context window as a nullable integer named max_input_tokens", () => {
    // The specific shape matters: `type: [integer, "null"]` is why the mapper
    // has to treat a null as "undisclosed" rather than as zero.
    expect(modelResponse.properties.max_input_tokens.type).toEqual(["integer", "null"]);
    expect(modelResponse.properties.max_output_tokens.type).toEqual(["integer", "null"]);
  });

  it("still nests pricing per million tokens rather than flattening it", () => {
    const pricing = schema.$defs.ModelPricing.properties;
    expect(Object.keys(pricing).sort()).toEqual([
      "context_tiers",
      "input_tokens",
      "output_tokens",
    ]);
    expect(Object.keys(schema.$defs.InputTokenPricing.properties).sort()).toEqual([
      "cache_read",
      "cache_write",
      "no_cache",
    ]);
    expect(Object.keys(schema.$defs.OutputTokenPricing.properties).sort()).toEqual([
      "audio",
      "image",
      "reasoning",
      "text",
    ]);
  });

  it("still counts providers as an object, which is what tells the planes apart", () => {
    // The local daemon sends `providers: string[]`. Cloud sends an object.
    // `providerCount()` branches on exactly this.
    expect(Object.keys(schema.$defs.ProvidersSummary.properties)).toEqual(["total_online"]);
  });

  it("declares no fixed vocabulary for capability tokens", () => {
    // Worth asserting rather than assuming: `capabilities` is an open list of
    // strings, so `hasCapability` matching an unknown token is a miss and not
    // an error, and a new token upstream cannot break this package. If an
    // `enum` ever appears here, that reasoning stops holding.
    expect(modelResponse.properties.capabilities.items).toEqual({ type: "string" });
    expect(modelResponse.properties.capabilities.items.enum).toBeUndefined();
  });
});

describe("the committed cloud fixture", () => {
  it("is a body BitRouter Cloud could actually serve", () => {
    // Catches the fixture being trimmed or hand-edited into a shape the
    // server would never send — which would make every assertion in
    // wire.test.ts a test of a fiction. It is also what fails when a field
    // becomes `required` upstream and the capture predates it.
    const validate = ajv.compile(schema);
    const ok = validate(load("./fixtures/cloud-models.json"));
    expect(ok, ajv.errorsText(validate.errors ?? [], { separator: "\n" })).toBe(true);
  });

  it("carries every field this package actually consumes", () => {
    // Conformance alone would accept a capture in which every optional field
    // is absent — valid, and useless as a regression test, since the mapping
    // would never run.
    const rows = load("./fixtures/cloud-models.json").data as Record<string, unknown>[];
    const present = new Set(rows.flatMap((r) => Object.keys(r)));
    const consumed = Object.entries(ACKNOWLEDGED)
      .filter(([, entry]) => entry.use !== "none")
      .map(([field]) => field);
    expect(consumed.filter((f) => !present.has(f))).toEqual([]);
  });
});
