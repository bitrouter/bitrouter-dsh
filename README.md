# @bitrouter/dsh

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that
keeps a [BitRouter](https://github.com/bitrouter/bitrouter) route's model list
live.

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
3. Write the resulting route into the `llm-pi-ai` settings section.
4. Take the route back out when the plugin unloads.

That is the same thing the harness's own web Models page does interactively;
this does it on load, from the live catalog. Streaming, retry, replay, and token
metering stay in the adapter that already does them — this plugin never
registers on `ctx.llm`.

## Install

```bash
dsh plugin --profile default add @bitrouter/dsh
```

The package declares `dsh.bundle`, so `dsh` appends it to the profile's bundle
list and its [`cordis.patch.yml`](cordis.patch.yml) inserts the plugin row. No
`cordis.yml` editing, and no other entry to add: the `llm-pi-ai` adapter, the
`settings` document provider, and `credentials` all ship in
`@deepseek-ai/dsh-base`.

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
leaves your settings document too.

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
| `removeOnUnload` | `true` | Remove the route from settings when the plugin unloads. |
| `probeTimeoutMs` | `1500` | Local-daemon probe timeout for `target: auto`. |

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

Fields BitRouter does not disclose are left off the written profile rather than
guessed, so `llm-pi-ai` applies the route's `defaultContextWindow` and
`defaultMaxTokens` — one place to correct instead of one per model.

Discovery failure is not fatal. `llm-pi-ai` refuses a hand-declared route with
no models at all, so writing nothing would leave you with no BitRouter route;
the plugin writes a one-model placeholder instead, logs a warning, and the next
load replaces it with the real catalog.

## Troubleshooting

**The route only lists `kimi-k2.5`**

That is the placeholder — discovery did not reach BitRouter. Check the warning
in the harness log, then `bitrouter status` for a local target, or that
`BITROUTER_API_KEY` is exported for cloud.

**The plugin logs nothing at all**

It is PENDING on a service. `inject: ['settings']` needs a settings provider
mounted — `@deepseek-ai/dsh-base` ships one as row `settings`, so this normally
means a profile that does not include the base bundle.

**`settings-rejected` naming the bitrouter route**

`llm-pi-ai` refused the written profile — usually a version whose profile schema
moved. Open an issue with the message; `manageProfile: false` plus
[`examples/settings.static.yaml`](examples/settings.static.yaml) is the
workaround meanwhile.

## Versions

The harness's npm `latest` tag is currently pinned to an old `0.0.1-rc.1` line;
the maintained line is published under `next` (`0.1.0-rc.8` at the time of
writing), which is what this plugin's peer ranges target. `npm install
@deepseek-ai/dsh-llm-pi-ai` without a tag resolves to `latest` and fails on an
unpublished peer — use `@next`.

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
`inject`, `Config`, `apply`). BitRouter's endpoints are in
[`src/constants.ts`](src/constants.ts). The written route is typed by
`llm-pi-ai`'s own `PiAiProviderProfile`, so a schema change upstream is a
compile error here rather than a runtime rejection.

## License

Apache-2.0
