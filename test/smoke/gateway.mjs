/**
 * A stand-in for BitRouter, just complete enough to boot a harness against.
 *
 * The smoke test needs a gateway that answers `/v1/models` in BitRouter's own
 * wire shape and completes one request. Using the real one would make the test
 * need credentials, a network, and a routing policy — none of which are what
 * the test is checking. What it checks is that the plugin activates inside a
 * real cordis kernel and drives a real request, and a stub is enough for that.
 *
 * The catalog is the cloud shape (`max_input_tokens`, nested `pricing`,
 * `capabilities` tokens) so the smoke test also exercises the field mapping
 * that `test/wire.test.ts` pins in isolation.
 */

import { createServer } from "node:http";

/** Cloud-shaped catalog. `bitrouter/auto` is deliberately absent: the gateway never lists it. */
const MODELS = {
  object: "list",
  data: [
    {
      id: "anthropic/claude-haiku-4.5",
      name: "Anthropic: Claude Haiku 4.5",
      max_input_tokens: 200000,
      max_output_tokens: 8192,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      pricing: { input_tokens: { no_cache: 1 }, output_tokens: { text: 5 } },
      capabilities: ["tools"],
      providers: { total_online: 1 },
    },
  ],
};

const REPLY = "SMOKE-OK";

function chatCompletion(model) {
  return {
    id: "chatcmpl-smoke",
    object: "chat.completion",
    created: 0,
    model,
    choices: [
      { index: 0, message: { role: "assistant", content: REPLY }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

/** The SSE form, for a client that asks for a stream. */
function streamChunks(model) {
  const base = { id: "chatcmpl-smoke", object: "chat.completion.chunk", created: 0, model };
  return [
    { ...base, choices: [{ index: 0, delta: { role: "assistant", content: REPLY }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ];
}

export function startGateway() {
  /** Every model id the harness asked us to serve, for the caller to assert on. */
  const requested = [];

  const server = createServer((req, res) => {
    if (req.url?.startsWith("/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(MODELS));
      return;
    }
    if (req.url?.startsWith("/v1/chat/completions")) {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        let body = {};
        try {
          body = JSON.parse(raw);
        } catch {
          /* a malformed body is the harness's problem, not ours */
        }
        requested.push(body.model);
        if (body.stream) {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          for (const chunk of streamChunks(body.model)) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(chatCompletion(body.model)));
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `no stub route for ${req.url}` } }));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        requested,
        reply: REPLY,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
