#!/usr/bin/env node

import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const registry = "https://registry.npmjs.org";
const packageNames = {
  sdk: "@breakoutscanner/mcp-sdk",
  cli: "@breakoutscanner/mcp-cli",
};
const requested = process.argv[2] ?? "both";
if (!(requested in { sdk: true, cli: true, both: true })) {
  console.error("Usage: node scripts/smoke-registry.mjs [sdk|cli|both]");
  process.exit(2);
}

const root = process.cwd();
const sdk = JSON.parse(await readFile(join(root, "packages/sdk/package.json"), "utf8"));
const cli = JSON.parse(await readFile(join(root, "packages/cli/package.json"), "utf8"));
const version = sdk.version;
if (cli.version !== version) throw new Error("SDK and CLI versions do not match");

const smokeRoot = await mkdtemp(join(tmpdir(), "breakoutscanner-mcp-registry-"));
const cache = await mkdtemp(join(smokeRoot, "npm-cache-"));
const app = join(smokeRoot, "app");
const npmEnv = {
  ...process.env,
  npm_config_cache: cache,
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_update_notifier: "false",
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: app,
    encoding: "utf8",
    env: npmEnv,
    stdio: options.stdio ?? "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed${result.stderr ? `:\n${result.stderr}` : ""}`);
  }
  return result;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPackage(specifier) {
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    const result = spawnSync("npm", ["view", specifier, "version", `--registry=${registry}`], {
      cwd: app,
      encoding: "utf8",
      env: npmEnv,
    });
    if (result.status === 0 && result.stdout.trim() === version) return;
    if (attempt === 18) {
      throw new Error(`Timed out waiting for ${specifier} in the public registry`);
    }
    await sleep(5000);
  }
}

try {
  await mkdir(app, { recursive: true });
  const packages = requested === "both" ? ["sdk", "cli"] : [requested];
  for (const key of packages) {
    const packageName = packageNames[key];
    const specifier = `${packageName}@${version}`;
    await waitForPackage(specifier);
    run("npm", ["install", "--prefix", app, "--no-package-lock", "--ignore-scripts", `--registry=${registry}`, specifier]);
    const packageDirectory = join(app, "node_modules", ...packageName.split("/"));
    const packageStat = await lstat(packageDirectory);
    if (!packageStat.isDirectory()) throw new Error(`${specifier} did not install as a directory`);
    const installed = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
    if (installed.version !== version) throw new Error(`${specifier} installed an unexpected version`);
    if (key === "sdk") {
      run("node", [
        "--input-type=module",
        "-e",
        "const sdk = await import('@breakoutscanner/mcp-sdk'); for (const name of ['McpClient', 'fetchCapabilityContract']) if (!(name in sdk)) throw new Error(`Missing SDK export: ${name}`);",
      ]);
    } else {
      const executable = join(app, "node_modules/.bin/breakout-scanner");
      run(executable, ["--help"]);
      run(executable, ["discover"]);
      run(executable, ["list", "--sandbox"]);
      run(executable, ["call", "market.snapshot", "--sandbox", "--input", '{"symbols":["ACME"]}']);
    }
  }
  console.log(`Clean registry smoke test passed for ${packages.map((key) => `${packageNames[key]}@${version}`).join(", ")}.`);
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}
