# Breakout Scanner MCP SDK

[`@breakoutscanner/mcp-sdk`](https://www.npmjs.com/package/@breakoutscanner/mcp-sdk)
is a small TypeScript client for Breakout Scanner's Streamable HTTP MCP
workspace. Version `0.1.0-preview.1` is the current source preview for npm's
`preview` tag and may change before the stable 0.1.0 release.

The SDK handles public capability discovery, MCP initialization, tool listing,
JSON-RPC tool calls, session headers, bounded timeouts, and typed errors. It is
a transport client: it does not implement market or workspace business logic,
store credentials, or grant access. The remote service remains authoritative
for authentication, account eligibility, capability grants, approval,
validation, evidence, and execution.

The package supports Node.js 20 or newer and uses the runtime's standard
`fetch`. It is licensed under Apache-2.0. For support, email
[support@breakoutscanner.com](mailto:support@breakoutscanner.com).

## Install

```bash
npm install @breakoutscanner/mcp-sdk@0.1.0-preview.1
```

Use `@preview` when you explicitly want the current preview tag. Pin the exact
version in applications that need reproducible installs.

## Authenticated calls

Follow the [OAuth Authorization Code + PKCE connection flow](https://breakoutscanner.com/docs)
to obtain an access token. The token is supplied to the SDK at runtime; never
commit it, log it, or place it in a URL.

```ts
import { McpClient, fetchCapabilityContract } from "@breakoutscanner/mcp-sdk";

const contract = await fetchCapabilityContract(); // public discovery
const client = new McpClient({
  endpoint: "https://breakoutscanner.com/mcp",
  token: process.env.BREAKOUT_SCANNER_TOKEN,
  clientName: "my-agent",
  clientVersion: "1.0.0",
});

console.log(contract.capabilities.map(({ name }) => name));
console.log(await client.listTools());
console.log(await client.callTool("market.snapshot", { symbols: ["NVDA"] }));
```

`fetchCapabilityContract` performs a public GET request and does not send a
bearer token. It exposes canonical capability names, schemas, permissions,
evidence requirements, limits, and transport metadata. Callers still need an
eligible account, an active connection, and the grants required by the chosen
capability.

Capability names use dot-separated identifiers such as `market.snapshot`; the
SDK maps them to the MCP tool names advertised by the service.

## Anonymous protocol sandbox

For protocol wiring without credentials, explicitly opt into the public
`/mcp/sandbox` endpoint:

```ts
const sandbox = new McpClient({
  endpoint: "https://breakoutscanner.com/mcp/sandbox",
  allowAnonymousSandbox: true,
});

console.log(await sandbox.listTools());
console.log(await sandbox.callTool("market.snapshot", { symbols: ["ACME"] }));
```

The sandbox is path-checked by the SDK, uses fixed development fixtures, and
is isolated from user workspaces. It does not provide live data, production
writes, or approvals. The opt-in cannot disable authentication for the
production `/mcp` endpoint.

## Errors and write calls

Transport and protocol failures are surfaced as `McpClientError` with a stable
`code`, optional HTTP `status`, a `retryable` hint, and structured details. The
SDK never retries implicitly. For a write-capable tool, pass an explicit
idempotency key when the capability contract requires one; the service still
decides whether the operation is allowed and whether approval is needed.

## Development

From the [package repository](https://github.com/AKP-Ventures/breakoutscanner-mcp):

```bash
npm run build --workspace @breakoutscanner/mcp-sdk
npm run typecheck --workspace @breakoutscanner/mcp-sdk
npm test --workspace @breakoutscanner/mcp-sdk
npm pack --workspace @breakoutscanner/mcp-sdk --dry-run
```

See the repository's [`RELEASING.md`](../../RELEASING.md) for the publication
checklist and [`SECURITY.md`](../../SECURITY.md) for private vulnerability
reports.
