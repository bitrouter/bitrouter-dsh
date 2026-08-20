# @bitrouter/dsh

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that
keeps a [BitRouter](https://github.com/bitrouter/bitrouter) route's model list
live.

## Why a plugin at all

The harness can already talk to BitRouter without one.
[`@deepseek-ai/dsh-llm-pi-ai`](https://www.npmjs.com/package/@deepseek-ai/dsh-llm-pi-ai)
serves any hand-declared OpenAI-compatible route given an `api`, a `baseURL`,
and a list of models — see [`examples/cordis.static.yml`](examples/cordis.static.yml)
for exactly that, and use it if it is all you need.

What configuration cannot do is keep the model list current. A static `models:`
block goes stale the moment BitRouter's catalog changes, and BitRouter's whole
job is routing across a catalog that moves.

So this plugin owns exactly that gap, and nothing else:

1. Pick the data plane — a reachable local daemon, else BitRouter Cloud.
2. Read `GET ${baseUrl}/models`.
3. Write the resulting route into the `llm-pi-ai` settings namespace.
4. Take the route back out when the plugin unloads.

Streaming, retry, replay, and token metering stay in the adapter that already
does them. This plugin never registers on `ctx.llm`.

## Install

```bash
npm install @bitrouter/dsh
```

Add both entries to your `cordis.yml`:

```yaml
- id: llm
  name: '@deepseek-ai/dsh-llm-pi-ai'

- name: '@bitrouter/dsh'
  config:
    target: auto
```

Both are required: this plugin writes into the `llm-pi-ai` settings namespace,
which exists only because the adapter registered it. It declares
`inject: ['settings']`, so without a settings provider mounted the plugin stays
PENDING and does nothing — declare the route statically in that case.

Then export your key:

```bash
export BITROUTER_API_KEY=brvk_...
```

## Configuration

| Field | Default | Description |
|---|---|---|
| `target` | `auto` | `auto` uses the local daemon when it serves models, else BitRouter Cloud. `local` and `cloud` force one. |
| `baseURL` | _(from target)_ | Explicit BitRouter endpoint; overrides the target default. |
| `apiKeyEnv` | `BITROUTER_API_KEY` | Environment variable holding the `brvk_` key. A **reference**, resolved per request by `llm-pi-ai` — no secret is written into settings. |
| `route` | `bitrouter` | The `llm-pi-ai` route key this plugin owns. |
| `displayName` | `BitRouter` | Label shown by model selectors. |
| `manageProfile` | `true` | Set to `false` to stop writing the route and hand-maintain it. |
| `removeOnUnload` | `true` | Remove the route from settings when the plugin unloads. |
| `probeTimeoutMs` | `1500` | Local-daemon probe timeout for `target: auto`. |

### On writing to another plugin's namespace

This plugin writes one key — `providers.<route>` — into the `llm-pi-ai` user
settings section, and removes that same key on unload with a path op rather
than by rewriting the section. That is deliberate: the rest of the namespace
belongs to routes this plugin never saw, and a wholesale replace would delete
them.

It is still a persistent edit to your settings document, so it is worth knowing
about rather than discovering. Two switches control it: `manageProfile: false`
stops the write entirely, and `removeOnUnload: false` leaves the route behind
when the plugin goes away.

`llm-pi-ai` validates the section it owns, so a profile this plugin got wrong is
refused where it is written — you get a `settings-rejected` naming the offending
route and field, not a quietly broken route.

### Wire compatibility

BitRouter is an OpenAI-compatible gateway, not an OpenAI backend, and pi-ai
shapes a request it cannot recognize as though it were OpenAI itself. The
plugin sets four compat switches to correct that:

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
mounted; the log line naming a missing service says which.

**`settings-rejected` naming the bitrouter route**

`llm-pi-ai` refused the written profile — usually a version whose profile schema
moved. Open an issue with the message; `manageProfile: false` plus
[`examples/cordis.static.yml`](examples/cordis.static.yml) is the workaround
meanwhile.

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
[`src/constants.ts`](src/constants.ts).

The profile shape this plugin writes is **mirrored** from `llm-pi-ai`'s schema
in [`src/profile.ts`](src/profile.ts) rather than imported:
`@deepseek-ai/dsh-llm-pi-ai@0.0.1-rc.1` declares a peer dependency on
`@deepseek-ai/dsh-environment`, which is not published to npm, so the package
cannot be installed standalone. When it can be, import the real
`PiAiProviderProfile` and delete the mirror.

## License

Apache-2.0
