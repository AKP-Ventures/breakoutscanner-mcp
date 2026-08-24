#!/usr/bin/env node

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryUrl = "git+https://github.com/AKP-Ventures/breakoutscanner-mcp.git";
const packageSpecs = [
  {
    directory: "packages/sdk",
    name: "@breakoutscanner/mcp-sdk",
    entry: "index",
  },
  {
    directory: "packages/cli",
    name: "@breakoutscanner/mcp-cli",
    entry: "cli",
  },
];
const exactFiles = new Set(["package.json", "README.md", "LICENSE"]);

function fail(message) {
  console.error(`Release verification failed: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertObject(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const child of await listFiles(entryPath)) files.push(join(entry.name, child));
    } else if (entry.isFile()) {
      files.push(entry.name);
    } else {
      fail(`unexpected non-file entry in ${relative(root, directory)}: ${entry.name}`);
    }
  }
  return files;
}

async function verifyMetadata() {
  const rootPackage = await readJson(join(root, "package.json"));
  assertEqual(rootPackage.private, true, "root package must remain private");
  assertEqual(rootPackage.repository?.type, "git", "root repository type");
  assertEqual(rootPackage.repository?.url, repositoryUrl, "root repository URL");
  assertObject(rootPackage.workspaces, ["packages/sdk", "packages/cli"], "root workspace paths");
  assertEqual(rootPackage.packageManager, "npm@11.5.1", "root package manager");

  const packages = [];
  for (const spec of packageSpecs) {
    const directory = join(root, spec.directory);
    const metadata = await readJson(join(directory, "package.json"));
    packages.push({ ...spec, directory, metadata });

    assertEqual(metadata.name, spec.name, `${spec.name} package name`);
    assertEqual(metadata.license, "Apache-2.0", `${spec.name} license`);
    assertEqual(metadata.author?.email, "support@breakoutscanner.com", `${spec.name} support email`);
    assertEqual(metadata.repository?.type, "git", `${spec.name} repository type`);
    assertEqual(metadata.repository?.url, repositoryUrl, `${spec.name} repository URL`);
    assertEqual(metadata.repository?.directory, spec.directory, `${spec.name} repository directory`);
    assertEqual(metadata.engines?.node, ">=20", `${spec.name} Node engine`);
    assertEqual(metadata.publishConfig?.access, "public", `${spec.name} npm access`);
    assertEqual(metadata.publishConfig?.tag, "preview", `${spec.name} npm tag`);
    assertEqual(metadata.type, "module", `${spec.name} module type`);
    if (!/^[0-9]+\.[0-9]+\.[0-9]+-preview\.[0-9]+$/u.test(metadata.version)) {
      fail(`${spec.name} version must be an explicit preview semver, got ${metadata.version}`);
    }
    assertObject(sorted(metadata.files ?? []), sorted(["LICENSE", "README.md", "dist"]), `${spec.name} npm files allowlist`);
    assertEqual(metadata.main, `./dist/${spec.entry}.js`, `${spec.name} main entry`);
    assertEqual(metadata.types, `./dist/${spec.entry}.d.ts`, `${spec.name} type entry`);
  }

  assertEqual(packages[0].metadata.version, packages[1].metadata.version, "SDK and CLI versions");
  assertEqual(
    packages[1].metadata.dependencies?.["@breakoutscanner/mcp-sdk"],
    packages[0].metadata.version,
    "CLI SDK dependency must match the SDK version exactly",
  );

  const sdkSource = await readFile(join(root, "packages/sdk/src/index.ts"), "utf8");
  const sdkVersion = sdkSource.match(/SDK_VERSION\s*=\s*"([^"]+)"/u)?.[1];
  assertEqual(sdkVersion, packages[0].metadata.version, "SDK_VERSION source constant");

  return packages;
}

function parsePackJson(stdout, packageName) {
  const start = stdout.indexOf("[");
  if (start < 0) fail(`${packageName} npm pack did not return JSON`);
  try {
    const result = JSON.parse(stdout.slice(start));
    if (!Array.isArray(result) || result.length !== 1 || !Array.isArray(result[0]?.files)) {
      fail(`${packageName} npm pack JSON had an unexpected shape`);
    }
    return result[0];
  } catch (error) {
    fail(`${packageName} npm pack JSON could not be parsed: ${error.message}`);
  }
}

async function verifyPack(packages, cache) {
  for (const spec of packages) {
    const distFiles = await listFiles(join(spec.directory, "dist"));
    if (distFiles.length === 0) fail(`${spec.name} dist directory is empty; build before packing`);

    const result = spawnSync(
      "npm",
      ["pack", "--workspace", spec.name, "--dry-run", "--json", "--ignore-scripts"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          npm_config_audit: "false",
          npm_config_cache: cache,
          npm_config_fund: "false",
          npm_config_update_notifier: "false",
        },
      },
    );
    if (result.status !== 0) {
      fail(`${spec.name} npm pack failed:\n${result.stderr || result.stdout}`);
    }
    const packed = parsePackJson(result.stdout, spec.name);
    const actual = sorted(packed.files.map(({ path }) => path.replace(/^package\//u, "")));
    const expected = sorted([
      ...exactFiles,
      ...distFiles.map((path) => join("dist", path)),
    ]);
    assertObject(actual, expected, `${spec.name} npm pack allowlist`);
  }
}

const packages = await verifyMetadata();
if (process.argv.includes("--pack")) {
  const cache = await mkdtemp(join(tmpdir(), "breakoutscanner-mcp-pack-cache-"));
  try {
    await verifyPack(packages, cache);
  } finally {
    await rm(cache, { force: true, recursive: true });
  }
}
console.log(`Release metadata verified for ${packages.map(({ name, metadata }) => `${name}@${metadata.version}`).join(" and ")}${process.argv.includes("--pack") ? "; npm pack allowlists verified" : ""}.`);
