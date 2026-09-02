import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const packageDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const executable = path.join(packageDirectory, "dist", "cli.js");

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: packageDirectory,
      env: { ...process.env, BREAKOUT_SCANNER_TOKEN: "" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("the packaged CLI bin is executable and exposes safe setup help", async () => {
  await access(executable, constants.X_OK);
  const result = await runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /breakout-scanner discover/u);
  assert.match(result.stdout, /--token-stdin/u);
  assert.match(result.stdout, /Tokens are never accepted as command-line arguments/u);
  assert.equal(result.stderr, "");
});

test("the packaged CLI rejects unsupported options without echoing input", async () => {
  const result = await runCli(["list", "--token", "do-not-print-this"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid_arguments/u);
  assert.doesNotMatch(result.stderr, /do-not-print-this/u);

  const equalsResult = await runCli(["list", "--token=equals-secret-must-not-print"]);
  assert.equal(equalsResult.status, 2);
  assert.match(equalsResult.stderr, /invalid_arguments/u);
  assert.doesNotMatch(equalsResult.stderr, /equals-secret-must-not-print/u);
});

test("package metadata exposes the CLI bin and SDK dependency", async () => {
  const metadata = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
  const license = await readFile(path.join(packageDirectory, "LICENSE"), "utf8");
  assert.equal(metadata.name, "@breakoutscanner/mcp-cli");
  assert.equal(metadata.version, "0.1.0-preview.2");
  assert.equal(metadata.license, "Apache-2.0");
  assert.equal(metadata.author.email, "support@breakoutscanner.com");
  assert.equal(metadata.publishConfig.access, "public");
  assert.equal(metadata.publishConfig.tag, "preview");
  assert.equal(metadata.bin["breakout-scanner"], "dist/cli.js");
  assert.equal(metadata.dependencies["@breakoutscanner/mcp-sdk"], "0.1.0-preview.2");
  assert.equal(metadata.exports["."].import, "./dist/cli.js");
  assert.match(license, /Apache License\s+Version 2\.0/u);
});
