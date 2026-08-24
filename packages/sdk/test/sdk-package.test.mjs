import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import {
  McpClient,
  McpClientError,
  fetchCapabilityContract,
  mcpToolName,
} from "../dist/index.js";

const packageDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("the packaged SDK performs an MCP handshake and tool call", async () => {
  const calls = [];
  const fetchMock = async (_input, init) => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body));
    calls.push({ body, headers, redirect: init?.redirect });
    const result = body.method === "initialize"
      ? { protocolVersion: "2025-06-18", serverInfo: { name: "package-test" } }
      : body.method === "tools/list"
        ? { tools: [{ name: "breakout_scanner_market_snapshot" }] }
        : { content: [{ type: "text", text: "ok" }], isError: false };
    return jsonResponse({ jsonrpc: "2.0", id: body.id, result }, { "Mcp-Session-Id": "package-test-session" });
  };

  const client = new McpClient({
    endpoint: "https://breakoutscanner.com/mcp",
    token: "package-test-token",
    fetch: fetchMock,
  });
  const listed = await client.listTools();
  const called = await client.callTool("market.snapshot", { symbols: ["ACME"] }, {
    idempotencyKey: "12345678-1234-5123-8123-123456789012",
  });

  assert.deepEqual(listed.tools.map(({ name }) => name), ["breakout_scanner_market_snapshot"]);
  assert.equal(called.content[0].text, "ok");
  assert.deepEqual(calls.map(({ body }) => body.method), ["initialize", "tools/list", "tools/call"]);
  assert.equal(calls[0].headers.get("authorization"), "Bearer package-test-token");
  assert.equal(calls[0].redirect, "error");
  assert.equal(calls[2].headers.get("mcp-session-id"), "package-test-session");
  assert.equal(calls[2].headers.get("idempotency-key"), "12345678-1234-5123-8123-123456789012");
  assert.equal(calls[2].body.params.name, "breakout_scanner_market_snapshot");
});

test("capability discovery rejects an oversized Content-Length before reading the body", async () => {
  let readerRequested = false;
  const fetchMock = async () => ({
    body: {
      getReader() {
        readerRequested = true;
        throw new Error("the body reader must not be requested");
      },
    },
    headers: new Headers({ "Content-Type": "application/json", "Content-Length": "17" }),
    ok: true,
    status: 200,
  });

  await assert.rejects(
    fetchCapabilityContract({
      url: "https://breakoutscanner.com/api/v1/capabilities",
      maxResponseBytes: 16,
      fetch: fetchMock,
    }),
    (error) => error instanceof McpClientError
      && error.code === "invalid_response"
      && /configured 16-byte limit/u.test(error.message),
  );
  assert.equal(readerRequested, false);
});

test("MCP responses are bounded while streaming without a Content-Length", async () => {
  const fetchMock = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { value: "x".repeat(256) },
      })));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const client = new McpClient({
    endpoint: "https://breakoutscanner.com/mcp",
    token: "package-test-token",
    maxResponseBytes: 64,
    fetch: fetchMock,
  });

  await assert.rejects(
    client.initialize(),
    (error) => error instanceof McpClientError
      && error.code === "invalid_response"
      && /configured 64-byte limit/u.test(error.message),
  );
});

test("the MCP body timeout remains active until streaming response consumption finishes", async () => {
  const fetchMock = async () => new Response(new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const client = new McpClient({
    endpoint: "https://breakoutscanner.com/mcp",
    token: "package-test-token",
    timeoutMs: 1_000,
    fetch: fetchMock,
  });

  await assert.rejects(
    client.initialize(),
    (error) => error instanceof McpClientError && error.code === "request_timeout",
  );
});

test("remote error messages and details are truncated and redact credentials", async () => {
  const secret = "super-secret-token-value";
  const fetchMock = async () => jsonResponse({
    jsonrpc: "2.0",
    id: 1,
    error: {
      code: -32_000,
      message: `authorization: Bearer ${secret} api_key=${secret} ${"untrusted ".repeat(200)}`,
      data: {
        apiKey: secret,
        nested: { password: secret, safe: "kept" },
      },
    },
  });
  const client = new McpClient({
    endpoint: "https://breakoutscanner.com/mcp",
    token: "package-test-token",
    fetch: fetchMock,
  });

  await assert.rejects(client.initialize(), (error) => {
    assert.ok(error instanceof McpClientError);
    assert.equal(error.code, "protocol_error");
    assert.ok(error.message.length <= 512);
    assert.match(error.message, /\[REDACTED\]/u);
    assert.doesNotMatch(error.message, new RegExp(secret, "u"));
    assert.equal(error.details.data.apiKey, "[REDACTED]");
    assert.equal(error.details.data.nested.password, "[REDACTED]");
    assert.equal(error.details.data.nested.safe, "kept");
    return true;
  });
});

test("SSE parsing bounds event accumulation and maxResponseBytes is validated", async () => {
  const event = `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })}\n\n`;
  const fetchMock = async () => new Response(event.repeat(1_025), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
  const client = new McpClient({
    endpoint: "https://breakoutscanner.com/mcp",
    token: "package-test-token",
    fetch: fetchMock,
  });

  await assert.rejects(
    client.initialize(),
    (error) => error instanceof McpClientError
      && error.code === "invalid_response"
      && /too many events/u.test(error.message),
  );
  assert.throws(
    () => new McpClient({ endpoint: "https://breakoutscanner.com/mcp", token: "token", maxResponseBytes: 0 }),
    (error) => error instanceof McpClientError && error.code === "invalid_arguments",
  );
});

test("package metadata is ready for the public preview channel", async () => {
  const metadata = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
  const license = await readFile(path.join(packageDirectory, "LICENSE"), "utf8");
  assert.equal(metadata.name, "@breakoutscanner/mcp-sdk");
  assert.equal(metadata.version, "0.1.0-preview.1");
  assert.equal(metadata.license, "Apache-2.0");
  assert.equal(metadata.author.email, "support@breakoutscanner.com");
  assert.equal(metadata.publishConfig.access, "public");
  assert.equal(metadata.publishConfig.tag, "preview");
  assert.equal(metadata.exports["."].import, "./dist/index.js");
  assert.equal(metadata.exports["."].types, "./dist/index.d.ts");
  assert.match(license, /Apache License\s+Version 2\.0/u);
});

test("the packaged SDK keeps production authentication and tool naming boundaries", async () => {
  assert.equal(mcpToolName("market.snapshot"), "breakout_scanner_market_snapshot");
  assert.throws(
    () => new McpClient({ endpoint: "https://breakoutscanner.com/mcp" }),
    (error) => error instanceof McpClientError && error.code === "missing_token",
  );
  assert.throws(
    () => new McpClient({ endpoint: "http://example.com/mcp", token: "token" }),
    (error) => error instanceof McpClientError && error.code === "insecure_endpoint",
  );
  assert.throws(
    () => new McpClient({ endpoint: "http://example.com/mcp", token: "token", allowInsecureHttp: true }),
    (error) => error instanceof McpClientError && error.code === "insecure_endpoint",
  );
  assert.throws(
    () => new McpClient({ endpoint: "http://localhost:3000/mcp", token: "token" }),
    (error) => error instanceof McpClientError && error.code === "insecure_endpoint",
  );
  assert.doesNotThrow(
    () => new McpClient({ endpoint: "http://127.0.0.1:3000/mcp", token: "token", allowInsecureHttp: true }),
  );
  assert.doesNotThrow(
    () => new McpClient({ endpoint: "http://localhost:3000/mcp", token: "token", allowInsecureHttp: true }),
  );
  assert.throws(
    () => new McpClient({ endpoint: "https://user:password@breakoutscanner.com/mcp", token: "token" }),
    (error) => error instanceof McpClientError && error.code === "invalid_url",
  );
  assert.throws(
    () => new McpClient({ endpoint: "https://breakoutscanner.com/mcp?access_token=secret", token: "token" }),
    (error) => error instanceof McpClientError && error.code === "invalid_url",
  );
  await assert.rejects(
    fetchCapabilityContract({
      url: "http://example.com/api/v1/capabilities",
      allowInsecureHttp: true,
      fetch: async () => { throw new Error("must not execute"); },
    }),
    (error) => error instanceof McpClientError && error.code === "insecure_endpoint",
  );
  assert.throws(
    () => mcpToolName("market snapshot"),
    (error) => error instanceof McpClientError && error.code === "invalid_arguments",
  );
});
