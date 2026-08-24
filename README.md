# @bitrouter/dsh

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that
makes [BitRouter](https://github.com/bitrouter/bitrouter) the harness's default
provider and keeps its route's model list live.

## Why a plugin at all

The harness can already reach BitRouter without one. `@deepseek-ai/dsh-base`
mounts the `llm-pi-ai` adapter **dormant**, and a `llm-pi-ai:` section in
`$DSH_HOME/settings.yaml` naming an `api`, a `baseURL`, and a list of models
brings the route live with no restart — see
[`examples/settings.static.yaml`](examples/settings.static.yaml), and use it if
it is all you need.

What settings alone cannot do is keep that model list current. A hand-written
`models:` block goes stale the moment BitRouter's catalog changes, and routing
across a catalog that moves is BitRouter's whole point.

So this plugin owns exactly that gap, and nothing else:

1. Pick the data plane — a reachable local daemon, else BitRouter Cloud.
2. Read `GET ${baseUrl}/models`.
3. Write the resulting route into the `llm-pi-ai` settings section, led by the
   `auto` route.
4. Take the route back out when the plugin unloads.

That is the same thing the harness's own web Models page does interactively;
this does it on load, from the live catalog. Streaming, retry, replay, and token
metering stay in the adapter that already does them — this plugin never
registers on `ctx.llm`.

Its [`cordis.patch.yml`](cordis.patch.yml) does one more thing, and does it at
install rather than at runtime: it re-addresses dsh-base's own
`agent-default-model` row so a fresh install lands on `bitrouter/auto`. That is
composition, not a settings write — see
[Becoming the default](#becoming-the-default).

## Install

```bash
dsh plugin --profile default add @bitrouter/dsh
```

The package declares `dsh.bundle`, so `dsh` appends it to the profile's bundle
list and its [`cordis.patch.yml`](cordis.patch.yml) inserts the plugin row. No
`cordis.yml` editing, and no other entry to add: the `llm-pi-ai` adapter, the
`settings` document provider, and `credentials` all ship in
`@deepseek-ai/dsh-base`.

The bundle patch also points `agent-default-model` at `bitrouter` / `bitrouter/auto`, so
there is no second step to make BitRouter the default.

Then give it a key and boot:

```bash
export BITROUTER_API_KEY=brvk_...
```

```bash
dsh --profile default
```

To check the layer landed before booting:

```bash
dsh --profile default --dump-config
```

Remove it with `dsh plugin --profile default remove @bitrouter/dsh`, which drops
both the dependency and the layer. The plugin unmounts as it goes, so its route
leaves your settings document too — unless you have edited that route, in which
case it stays; see
[Removal is conditional on ownership](#removal-is-conditional-on-ownership).

## The auto route

`bitrouter/auto` hands model choice back to BitRouter: the request carries
`bitrouter/auto` as its model and the gateway's routing policy picks the model
per request. `bitrouter/` is a namespace BitRouter reserves for itself, so the
vendor segment names the router being addressed rather than the token
destination. It leads every catalog this plugin writes, and it is what the
`agent-default-model` row selects.

The rest of the catalog is written behind it. `auto` is the default, not the
only option — every model BitRouter serves stays selectable, so a session can
pin one specific model and switch back.

It is also what makes an undiscoverable gateway survivable. `llm-pi-ai` refuses
a hand-declared route with no models, so a failed discovery used to be written
as a one-model placeholder; now it is written as the auto route alone, which is
serviceable rather than a guess, because routing is the gateway's job.

Until BitRouter's own catalog lists `bitrouter/auto`, the plugin synthesizes the entry
with deliberately conservative capacities (128K context, 16K output). They are
the floor rather than the ceiling on purpose — `auto` may land on any model in
the ladder, and the two wrong answers do not cost the same: under-claiming
compacts a session earlier than it needed to, while over-claiming sends a
request the chosen model rejects outright, mid-turn, after the message is
durable. A gateway that ever serves an entry under
this id supersedes the placeholder, though none does today: the namespace is
resolved before any provider lookup and BitRouter's registry validator
refuses catalog models under `bitrouter/`, so the entry has to come from
here.

## Becoming the default

`@deepseek-ai/dsh-base` ships an `agent-default-model` row, and bundle patches
compose in `dsh.profile.bundles` order with the last write winning per row. So
this bundle re-addresses that row by id:

```yaml
- id: agent-default-model
  config:
    provider: bitrouter
    model: auto
```

That is the whole of "installing the plugin points the harness at BitRouter".
No runtime write, no settings mutation, and nothing to undo beyond removing the
bundle — which is why it lives in the patch rather than in `apply()`.

Two layers still sit above it and are left alone:

- the profile's own `cordis.patch.yml`, for a deployment that wants a different
  default; and
- a selection the user saved through `agentDefaultModel`, which lives in the
  settings user layer and wins over every composition entry including this one.

## Authenticating

The route names a credential **reference** — an environment-variable name —
which `llm-pi-ai` resolves per request through `ctx.credentials`. No secret is
ever written into your settings document. There are two ways to put a value
behind that reference.

**An API key.** Mint one and export it, or store it in
`$DSH_HOME/.credentials.yaml`:

```bash
export BITROUTER_API_KEY=brvk_...
```

**An OAuth login.** `llm-pi-ai` cannot serve an OAuth-only route — it builds
its `Models` collection with no credential store and runs no login flow, so
such a route fails every request before it goes out. So the bridge runs the
other way: log in with the BitRouter CLI, which owns the grant, and this plugin
projects the access token it already holds into the reference the route names.

```bash
bitrouter auth login
```

That is all. On the next load the plugin finds the token and fills
`BITROUTER_API_KEY` for you.

It fills a **gap** and never more than that. Before writing anything it asks
the credential seam whether the reference already resolves, and stops if it
does — so a key you exported for this run, one you stored by hand, and one in a
`.env` are all left exactly as they are. Overwriting the second with a token
that expires in an hour would be a silent downgrade from a durable credential
to a perishable one. Set `adoptCliLogin: false` to switch the behavior off
entirely.

The read is one-directional by design. Copying the CLI's grant and refreshing
it from here would make two processes owners of one refresh token, and an
authorization server that rotates them invalidates whichever copy refreshes
second — so refresh stays with `bitrouter auth login`, the process that
obtained it. An expired token is therefore reported rather than projected:
authenticating every request with something the gateway already refuses would
surface as a wrong key rather than a stale login.

## Configuration

Set these in the profile's own `cordis.patch.yml` if you need to override a row
this bundle inserted (a patch replaces a row's whole `config`, so restate every
key you want):

| Field | Default | Description |
|---|---|---|
| `target` | `auto` | `auto` uses the local daemon when it serves models, else BitRouter Cloud. `local` and `cloud` force one. |
| `baseURL` | _(from target)_ | Explicit BitRouter endpoint; overrides the target default. |
| `apiKeyEnv` | `BITROUTER_API_KEY` | Environment variable holding the `brvk_` key. A **reference**, resolved per request by `llm-pi-ai` through the credentials seam — no secret is written into settings. |
| `route` | `bitrouter` | The `llm-pi-ai` route key this plugin owns. |
| `displayName` | `BitRouter` | Label shown by model selectors. |
| `manageProfile` | `true` | Set to `false` to stop writing the route and hand-maintain it. |
| `removeOnUnload` | `true` | Remove the route from settings when the plugin unloads — while it is still the route this plugin wrote, and while the settings service is still up (see below). |
| `probeTimeoutMs` | `1500` | Local-daemon probe timeout for `target: auto`. |
| `adoptCliLogin` | `true` | Fill `apiKeyEnv` from a `bitrouter auth login` on this machine, only when that reference resolves to nothing. |

### On writing to another plugin's namespace

This plugin writes one key — `providers.<route>` — into the `llm-pi-ai` user
settings section, and removes that same key on unload with a path op rather than
by rewriting the section. That is deliberate: the rest of the namespace belongs
to routes this plugin never saw, and a wholesale replace would delete them.

It is still a persistent edit to your settings document, so it is worth knowing
about rather than discovering. Two switches control it: `manageProfile: false`
stops the write entirely, and `removeOnUnload: false` leaves the route behind
when the plugin goes away.

`llm-pi-ai` validates the section it owns, so a profile this plugin got wrong is
refused where it is written — you get a `settings-rejected` naming the offending
route and field, not a quietly broken route.

#### Removal is conditional on ownership

`removeOnUnload` exists so uninstalling leaves no orphan. Taken literally it is
also a way to lose work: between the write and the unload you can open the web
Models page, hand-edit `settings.yaml`, or run a second `dsh`, and an
unconditional `unset` would delete what you did along with what this plugin put
there.

So the route is removed only when what is stored is still **exactly** what this
plugin last wrote — compared against the raw user layer, not the resolved value,
since the resolved value folds in the composition base and schema defaults and
would never match. An edited route, a route replaced wholesale, and a route
already gone are all left alone, and the log says which.

The asymmetry is deliberate. A leftover route is a line in a settings file that
the next load overwrites anyway; a deleted one is your configuration gone.

#### It does not fire at process exit

Removal happens when the *plugin* unloads while the harness keeps running —
`dsh plugin remove`, or a hot reload. It does **not** happen when the process
exits: the settings service is disposed before a dependent plugin's queued
write runs, and the write is refused with `settings service was disposed
before the queued "llm-pi-ai" mutate ran`.

So an ordinary `dsh` run leaves the route in your settings document. That is
harmless — the next load rewrites it — and it is logged as news rather than a
warning. If you want the document clean, remove the bundle; that is the
unload this switch is really for.

The delete carries the `revision` the ownership check was read at, so a writer
landing between the check and the write is refused rather than overwritten —
without that fence the check would be advisory. A refusal is reported and never
retried: the section moved, which is exactly the case in which this plugin
should not be deleting anything.

The load-time write takes no such fence, deliberately. It is a blind deep-merge
of one key rather than a read-modify-write, so there is no stale snapshot to
guard — and a revision counts the whole raw section, so fencing it would refuse
the write whenever anyone had touched an unrelated route. The settings service
already serializes writes per namespace.

### Wire compatibility

BitRouter is an OpenAI-compatible gateway, not an OpenAI backend, and pi-ai
shapes a request whose URL it cannot recognize as though it were OpenAI itself.
The plugin sets four compat switches to correct that:

| Switch | Value | Why |
|---|---|---|
| `supportsStore` | `false` | Suppresses `store: false`, which the gateway rejects with a strict "Extra inputs are not permitted". |
| `supportsUsageInStreaming` | `false` | Suppresses `stream_options`, rejected the same way. |
| `supportsDeveloperRole` | `false` | A reasoning model's system prompt would otherwise go out under the `developer` role. |
| `maxTokensField` | `max_tokens` | The output cap travels as `max_tokens`, not `max_completion_tokens`. |

## Model discovery

The two data planes answer `GET /v1/models` with genuinely different bodies,
and the plugin reads each on its own terms:

| | Local daemon | BitRouter Cloud |
|---|---|---|
| Body | `{ id, object, providers: [...] }` | the full catalog |
| Context window | not sent | `max_input_tokens` |
| Output cap | not sent | `max_output_tokens` |
| Modalities | not sent | `input_modalities`, plus `image_input` |
| Capabilities | not sent | `capabilities` tokens (`reasoning`, `tools`, …) |

Neither plane sends a `context_window` field, a flat `cost` object, or boolean
`reasoning` / `tool_call` fields. Releases before this one read those names, so
every cloud model was written with no `contextWindow` at all and sized by the
route's `defaultContextWindow` — a 1M-context model included.
[`test/wire.test.ts`](test/wire.test.ts) pins the mapping against bodies
captured verbatim from both planes.

Fields BitRouter does not disclose are still left off the written profile
rather than guessed, so `llm-pi-ai` applies the route's `defaultContextWindow`
and `defaultMaxTokens` — one place to correct instead of one per model. That is
every local-daemon entry.

Discovery failure is not fatal. `llm-pi-ai` refuses a hand-declared route with
no models at all, so writing nothing would leave you with no BitRouter route;
the plugin writes the auto route alone instead, logs a warning, and the next
load fills in the rest of the catalog.

## Troubleshooting

**The route only lists `bitrouter/auto`**

Discovery did not reach BitRouter, or the gateway listed nothing. Check the
warning in the harness log, then `bitrouter status` for a local target, or that
`BITROUTER_API_KEY` is exported for cloud. `bitrouter/auto` itself still routes
meanwhile — choosing the model is the gateway's job, not this plugin's.

**The plugin logs nothing at all**

It is PENDING on a service. `inject: ['settings']` needs a settings provider
mounted — `@deepseek-ai/dsh-base` ships one as row `settings`, so this normally
means a profile that does not include the base bundle.

**`BITROUTER_API_KEY` is unconfigured and no BitRouter cloud credentials**

Nothing is behind the route's credential reference and the BitRouter CLI has no
stored token to lend it. Either export a key or run `bitrouter auth login`.

**`cloud access token has expired; run \`bitrouter auth login\``**

The CLI's stored token is past its expiry. This plugin deliberately does not
refresh it — the CLI owns that grant — so re-run the login.

**`settings-rejected` naming the bitrouter route**

`llm-pi-ai` refused the written profile — usually a version whose profile schema
moved. Open an issue with the message; `manageProfile: false` plus
[`examples/settings.static.yaml`](examples/settings.static.yaml) is the
workaround meanwhile.

## Versions

The harness's npm `latest` tag is currently pinned to an old `0.0.1-rc.1` line;
the maintained line is published under `next` (`0.1.1-rc.2` at the time of
writing), which is what this plugin's peer ranges target. `npm install
@deepseek-ai/dsh-llm-pi-ai` without a tag resolves to `latest` and fails on an
unpublished peer — use `@next`.

`@deepseek-ai/dsh-credentials` joins the peer set at that version: the route's
credential reference is described before it is written, which is what keeps
[Authenticating](#authenticating) a gap-fill rather than an overwrite. It is
injected **optionally**, so a composition without a credentials provider still
loads — it just resolves the reference straight off the process environment,
which is the behavior every earlier release had.

## Development

```bash
npm install
```

```bash
npm run build
```

```bash
npm test
```

Logic lives in [`src/`](src) as pure, dependency-injected modules — target
resolution, catalog discovery, profile construction — with
[`src/sync.ts`](src/sync.ts) composing them behind a small injected seam and
[`src/index.ts`](src/index.ts) as the thin cordis-facing layer (`name`,
`inject`, `Config`, `apply`). BitRouter's endpoints, the `auto` model id, and
the settings namespaces are in [`src/constants.ts`](src/constants.ts). The
written route is typed by `llm-pi-ai`'s own `PiAiProviderProfile`, so a schema
change upstream is a compile error here rather than a runtime rejection.

[`src/discovery.ts`](src/discovery.ts) documents both wire shapes and is the
one place that knows either; [`test/wire.test.ts`](test/wire.test.ts) pins the
mapping against bodies captured verbatim from both planes, so a field rename
upstream fails a test rather than silently defaulting a model.

[`src/ownership.ts`](src/ownership.ts) holds the removal decision as a pure
function over the stored route, so the rule that keeps `removeOnUnload` from
deleting someone else's edit is testable without a kernel;
[`test/unload.test.ts`](test/unload.test.ts) drives `apply()` through a fake
context to check the wiring around it.

Everything above runs without a harness, which is also its limit: none of it
loads the plugin the way cordis does. A malformed `inject` declaration once
left the plugin PENDING — it never reached `apply()`, and took the whole boot
down with it — while the entire unit suite passed.

Two tests answer that at two different prices.
[`test/activation.test.ts`](test/activation.test.ts) mounts the plugin in a
real cordis context with a stub `settings` service and checks that it actually
activates. `inject` is a cordis contract rather than a harness one, so catching
that specific class needs no dsh, no install, and no network — it runs in
milliseconds on every pull request, and reintroducing the original bug fails
all four of its cases. [`test/patch.test.ts`](test/patch.test.ts) is the same
bargain for `cordis.patch.yml`: the row that makes BitRouter the default is
data nothing in `src/` reads, so it is checked against the file.

[`test/smoke/`](test/smoke) is the expensive one. It boots a real harness with
this plugin mounted,
against a stub gateway standing in for BitRouter, and checks the things only a
boot can show: that the plugin activates, that the bundle patch reaches
`agent-default-model`, that a route is written, and that a request naming
`bitrouter/auto` reaches the gateway.

The harness it boots is not a dependency of this package, so install it
somewhere of its own and point `DSH_BIN` at it — installing it *into* this
package makes npm resolve ~200 harness packages against the plugin's own
lockfile and peer set, which takes many minutes:

```bash
mkdir -p /tmp/dsh-harness && (cd /tmp/dsh-harness && npm init -y >/dev/null && npm i @deepseek-ai/dsh@next @deepseek-ai/dsh-base@next @deepseek-ai/dsh-headless@next)
```

```bash
DSH_BIN=/tmp/dsh-harness/node_modules/.bin/dsh npm run smoke
```

It does not run on every pull request. Installing the harness is ~200 packages
and around fifteen minutes, against seventeen seconds for everything else, and
what it uniquely proves — that `llm-pi-ai` still accepts the profile this
plugin writes, and that the model id survives to the wire — changes when the
*upstream* moves, not when this package does. So it runs on merges to `main`,
nightly, on demand, and on a pull request that asks for it by carrying the
`harness-smoke` label.

A `dsh` already in this package's `node_modules/.bin` is used when `DSH_BIN`
is unset. It needs **Node 22**: the harness declares no `engines` but imports
`createZstdDecompress` from `node:zlib` and calls `Promise.withResolvers`, so
an older runtime dies inside the cordis loader. The plugin itself is fine on
Node 20, which is what the main CI job covers. The test is hermetic either way — no credentials, no network, a
throwaway `DSH_HOME` — and runs as its own CI job. `SMOKE_KEEP=1` leaves the
temporary home behind to inspect.

## License

Apache-2.0
