/**
 * Boot a real DeepSeek Harness with this plugin mounted, and check it works.
 *
 * Why this exists as its own thing, outside the vitest suite: every unit test
 * here calls this package's own functions directly, so none of them ever loads
 * the plugin the way cordis does. A malformed `inject` declaration once left
 * the plugin PENDING — it never ran `apply()` at all, and took the whole boot
 * down with it — while all 77 unit tests passed and CI was green. Nothing short
 * of a real boot catches that class of mistake, so this does a real boot.
 *
 * It is hermetic: a stub gateway stands in for BitRouter, and DSH_HOME is a
 * throwaway directory. No credentials, no network, no routing policy.
 *
 * Run with `npm run smoke`, after installing the harness packages the profile
 * names (see the smoke job in .github/workflows/ci.yml).
 */

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startGateway } from "./gateway.mjs";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROFILE = "smoke";
const TASK = "Reply with exactly: SMOKE-OK";

/** `dsh` from this package's own node_modules, or wherever DSH_BIN points. */
function dshBin() {
  if (process.env.DSH_BIN) return process.env.DSH_BIN;
  const local = join(PKG_ROOT, "node_modules", ".bin", "dsh");
  if (existsSync(local)) return local;
  throw new Error(
    "smoke: no dsh binary. Install the harness first:\n" +
      "  npm i --no-save @deepseek-ai/dsh@next @deepseek-ai/dsh-base@next @deepseek-ai/dsh-headless@next\n" +
      "or point DSH_BIN at one.",
  );
}

/**
 * A throwaway DSH_HOME holding one profile that mounts the base and headless
 * bundles plus this package, linked from the working tree so the smoke test
 * exercises the build under review rather than a published one.
 */
async function makeHome(baseUrl) {
  const home = await mkdtemp(join(tmpdir(), "bitrouter-dsh-smoke-"));
  const profile = join(home, "profiles", PROFILE);
  await mkdir(join(profile, "node_modules", "@bitrouter"), { recursive: true });
  await symlink(PKG_ROOT, join(profile, "node_modules", "@bitrouter", "dsh"), "dir");

  await writeFile(
    join(profile, "package.json"),
    JSON.stringify(
      {
        name: "dsh-profile-smoke",
        private: true,
        dsh: {
          profile: {
            bundles: [
              "@deepseek-ai/dsh-base",
              "@deepseek-ai/dsh-headless",
              "@bitrouter/dsh",
            ],
          },
        },
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(join(profile, "cordis.patch.yml"), "[]\n");

  // Point the route at the stub and keep the written route around for the
  // assertions: removal at process exit cannot land anyway (the settings
  // service is disposed first), but saying so here keeps the test independent
  // of that.
  const patch = join(home, "smoke-patch.yml");
  await writeFile(
    patch,
    [
      "- id: bitrouter",
      "  config:",
      "    target: local",
      `    baseURL: ${baseUrl}`,
      "    apiKeyEnv: BITROUTER_SMOKE_KEY",
      "    adoptCliLogin: false",
      "    removeOnUnload: false",
      "",
    ].join("\n"),
  );
  return { home, profile, patch };
}

function runDsh({ home, patch }, args) {
  return new Promise((resolve) => {
    const child = spawn(dshBin(), ["--profile", PROFILE, "--patch", patch, ...args], {
      env: {
        ...process.env,
        DSH_HOME: home,
        // The stub admits anything; the route just has to name a reference
        // that resolves, or llm-pi-ai refuses the request before it goes out.
        BITROUTER_SMOKE_KEY: "smoke-key",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
}

async function main() {
  // The harness declares no `engines`, but needs Node 22: it imports
  // `createZstdDecompress` from `node:zlib` and calls `Promise.withResolvers`.
  // On an older runtime the boot dies inside the cordis loader with an
  // AggregateError that names neither, so say so here instead.
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) {
    console.error(
      `smoke: needs Node >= 22 to boot the harness (running ${process.versions.node}).`,
    );
    process.exit(1);
  }

  const gateway = await startGateway();
  const home = await makeHome(gateway.baseUrl);
  console.log(`smoke: DSH_HOME=${home.home}`);
  console.log(`smoke: stub gateway at ${gateway.baseUrl}\n`);

  try {
    // 1. The composed tree: the bundle patch has to reach agent-default-model.
    const dump = await runDsh(home, ["--dump-config"]);
    const dumped = dump.stdout;
    check(
      "bundle patch makes bitrouter the default provider",
      /id: agent-default-model[\s\S]*?provider: bitrouter[\s\S]*?model: bitrouter\/auto/.test(dumped),
      "agent-default-model was not patched in --dump-config",
    );
    check(
      "the plugin row is inserted",
      /name: '@bitrouter\/dsh'/.test(dumped),
      "no @bitrouter/dsh row in --dump-config",
    );

    // 2. The real boot. This is the part --dump-config cannot tell you about:
    //    composing a tree is not loading one.
    const run = await runDsh(home, [TASK]);
    const output = `${run.stdout}\n${run.stderr}`;
    check(
      "the plugin activates in a real kernel",
      !/did not activate|pending \(waiting for services/.test(output),
      output.split("\n").filter((l) => /activate|pending/.test(l)).join("\n") || "(no detail)",
    );
    // The whole stderr, not a slice of it: a boot failure is an AggregateError
    // whose real causes nest several levels down, and truncating it leaves a
    // message that names nothing actionable.
    check("the harness boots", !/plugin tree failed to load/.test(output), output);

    // 3. The route it wrote, read back off the settings document.
    const settingsPath = join(home.home, "settings.yaml");
    const settings = existsSync(settingsPath) ? await readFile(settingsPath, "utf8") : "";
    check("a route is written into the llm-pi-ai namespace",
      /llm-pi-ai:[\s\S]*providers:[\s\S]*bitrouter:/.test(settings), settings.slice(0, 400));
    check("the auto route leads the written catalog",
      /models:\s*\n\s*- id: bitrouter\/auto/.test(settings),
      settings.slice(0, 800));
    check("the discovered model is written too",
      /id: anthropic\/claude-haiku-4\.5/.test(settings), settings.slice(0, 800));
    check("the context window came off max_input_tokens",
      /contextWindow: 200000/.test(settings), settings.slice(0, 800));

    // 4. The request actually went out, naming the reserved slug.
    check("a request reached the gateway", gateway.requested.length > 0,
      "the stub gateway saw no chat completion");
    check("the request named bitrouter/auto",
      gateway.requested.includes("bitrouter/auto"),
      `models requested: ${JSON.stringify(gateway.requested)}`);
    check("the task completed through the route",
      run.stdout.includes(gateway.reply), run.stdout.slice(0, 400));
  } finally {
    await gateway.close();
    if (!process.env.SMOKE_KEEP) await rm(home.home, { recursive: true, force: true });
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\nsmoke: ${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`smoke: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
