#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  McpClient,
  McpClientError,
  fetchCapabilityContract,
  type JsonObject,
} from "@breakoutscanner/mcp-sdk";

interface ParsedArgs {
  readonly command: "discover" | "list" | "call" | "help";
  readonly positional: readonly string[];
  readonly options: Readonly<Record<string, string | boolean>>;
}

function usage(): string {
  return `Breakout Scanner MCP CLI (pilot, dual-era MCP)

Usage:
  breakout-scanner discover [--contract-url URL]
  breakout-scanner list --url MCP_URL [--sandbox]
  breakout-scanner call CAPABILITY [--input JSON|@FILE] --url MCP_URL [--sandbox]

Authentication:
  Set BREAKOUT_SCANNER_TOKEN in the environment, or pass --token-stdin.
  Tokens are never accepted as command-line arguments or printed by this CLI.

Options:
  --url URL              Authenticated Streamable HTTP MCP endpoint
  --sandbox              Use the anonymous simulated /mcp/sandbox endpoint (no token)
  --contract-url URL     Public capability contract endpoint for discover
  --input JSON|@FILE     JSON arguments for call (default: {})
  --idempotency-key UUID Explicit write/read idempotency key
  --token-stdin          Read the bearer token from stdin without echoing it
  --insecure-local       Allow HTTP only for localhost development
  --help                 Show this help

The SDK probes MCP 2026-07-28 with server/discover and falls back to the
2025-11-25/2025-06-18 initialize flow when the endpoint is legacy-only.
Authenticated tool calls remain synchronous; Tasks/background polling is not
advertised by this release.
`;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [rawCommand, ...rest] = argv;
  const command = rawCommand === "discover" || rawCommand === "list" || rawCommand === "call"
    ? rawCommand
    : rawCommand === "help" || rawCommand === "--help" || rawCommand === "-h" || rawCommand == null
      ? "help"
      : null;
  if (!command) throw new McpClientError({ code: "invalid_arguments", message: "Unknown command" });
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    if (!["url", "contract-url", "input", "idempotency-key"].includes(key)
      && !["token-stdin", "insecure-local", "sandbox", "help"].includes(key)) {
      throw new McpClientError({ code: "invalid_arguments", message: "Unknown option" });
    }
    if (["url", "contract-url", "input", "idempotency-key"].includes(key)) {
      const next = rest[index + 1];
      if (!next || next.startsWith("--")) throw new McpClientError({ code: "invalid_arguments", message: `Option '--${key}' requires a value` });
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { command, positional, options };
}

function option(args: ParsedArgs, name: string): string | undefined {
  const value = args.options[name];
  return typeof value === "string" ? value : undefined;
}

async function tokenFromStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new McpClientError({ code: "missing_token", message: "--token-stdin requires a piped token" });
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 16 * 1024) throw new McpClientError({ code: "invalid_arguments", message: "The token supplied on stdin is too large" });
    chunks.push(buffer);
  }
  const token = Buffer.concat(chunks).toString("utf8").trim();
  if (!token) throw new McpClientError({ code: "missing_token", message: "No token was provided on stdin" });
  return token;
}

async function tokenFor(args: ParsedArgs): Promise<string> {
  if (args.options.sandbox === true) {
    if (args.options["token-stdin"] === true) {
      throw new McpClientError({ code: "invalid_arguments", message: "--sandbox does not accept --token-stdin; the sandbox is anonymous" });
    }
    return "";
  }
  if (args.options["token-stdin"] === true) return tokenFromStdin();
  const token = process.env.BREAKOUT_SCANNER_TOKEN?.trim();
  if (!token) throw new McpClientError({ code: "missing_token", message: "Set BREAKOUT_SCANNER_TOKEN or use --token-stdin" });
  return token;
}

async function inputFor(args: ParsedArgs): Promise<JsonObject> {
  const raw = option(args, "input");
  if (!raw) return {};
  const text = raw.startsWith("@") ? await readFile(raw.slice(1), "utf8") : raw;
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new McpClientError({ code: "invalid_arguments", message: "--input must be valid JSON or @FILE" });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new McpClientError({ code: "invalid_arguments", message: "--input must contain a JSON object" });
  }
  return value as JsonObject;
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function run(args: ParsedArgs): Promise<void> {
  if (args.command === "help" || args.options.help === true) {
    process.stdout.write(usage());
    return;
  }
  const allowInsecureHttp = args.options["insecure-local"] === true;
  if (args.command === "discover") {
    const contract = await fetchCapabilityContract({
      url: option(args, "contract-url"),
      allowInsecureHttp,
    });
    output(contract);
    return;
  }
  const sandbox = args.options.sandbox === true;
  const endpoint = option(args, "url") || (sandbox
    ? "https://breakoutscanner.com/mcp/sandbox"
    : process.env.BREAKOUT_SCANNER_MCP_URL || "https://breakoutscanner.com/mcp");
  const client = new McpClient({
    endpoint,
    token: await tokenFor(args),
    allowAnonymousSandbox: sandbox,
    allowInsecureHttp,
  });
  if (args.command === "list") {
    output(await client.listTools());
    return;
  }
  const capability = args.positional[0];
  if (!capability) throw new McpClientError({ code: "invalid_arguments", message: "call requires a capability name" });
  output(await client.callTool(capability, await inputFor(args), {
    idempotencyKey: option(args, "idempotency-key"),
  }));
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    await run(parseArgs(argv));
  } catch (error) {
    const failure = error instanceof McpClientError
      ? error.toJSON()
      : { code: "transport_error", message: "The MCP CLI request failed", retryable: false };
    process.stderr.write(`${JSON.stringify({ error: failure })}\n`);
    process.exitCode = 2;
  }
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    // npm installs the bin as a symlink. Compare canonical paths so the
    // installed `breakout-scanner` command invokes main just like the source
    // preview entrypoint, while importing this module remains side-effect free.
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) void main();
