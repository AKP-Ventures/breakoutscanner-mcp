# Breakout Scanner MCP CLI

[`@breakoutscanner/mcp-cli`](https://www.npmjs.com/package/@breakoutscanner/mcp-cli)
is a command-line client for discovering and calling Breakout Scanner's
Streamable HTTP MCP workspace. Version `0.1.0-preview.1` is the current source
preview for npm's `preview` tag and may change before the stable 0.1.0 release.

The `breakout-scanner` command delegates protocol handling and typed errors to
`@breakoutscanner/mcp-sdk`; it does not duplicate market or workspace business
logic, store credentials, or grant access. The remote service remains
authoritative for authentication, account eligibility, capability grants,
approval, validation, evidence, and execution.

The CLI supports Node.js 20 or newer and is licensed under Apache-2.0. For
support, email [support@breakoutscanner.com](mailto:support@breakoutscanner.com).

## Install

```bash
npm install --global @breakoutscanner/mcp-cli@0.1.0-preview.1
```

Use `@preview` when you explicitly want the current preview tag. Pin an exact
version in scripts that need reproducible installs.

## Discover the public contract

Discovery returns canonical capability names, schemas, permissions, evidence
requirements, limits, and transport metadata. It does not require a token:

```bash
breakout-scanner discover
```

Use `--contract-url URL` to query a compatible contract endpoint during local
development.

## Connect to the authenticated workspace

Follow the [OAuth connection flow](https://breakoutscanner.com/docs). Supply an
access token through `BREAKOUT_SCANNER_TOKEN`, or pipe it through standard input
for a one-shot command. Tokens are never accepted as command-line arguments or
printed by this CLI.

```bash
export BREAKOUT_SCANNER_TOKEN='token-from-your-secret-store'
breakout-scanner list --url https://breakoutscanner.com/mcp
breakout-scanner call market.snapshot \
  --url https://breakoutscanner.com/mcp \
  --input '{"symbols":["NVDA"]}'
```

For a one-shot invocation without putting the token in shell history:

```bash
printf '%s\n' "$TOKEN_FROM_SECRET_STORE" | \
  breakout-scanner list --url https://breakoutscanner.com/mcp --token-stdin
```

`--url` defaults to `BREAKOUT_SCANNER_MCP_URL` when set, otherwise
`https://breakoutscanner.com/mcp`. Tool arguments may be inline JSON or read
from a file with `--input @path/to/input.json`.

For a write-capable capability, provide an idempotency key when its public
contract requires one:

```bash
breakout-scanner call watchlist.change \
  --url https://breakoutscanner.com/mcp \
  --idempotency-key 12345678-1234-5123-8123-123456789012 \
  --input @watchlist-change.json
```

The service independently decides whether the account, connection, grants,
approval, evidence, and input satisfy the capability's requirements.

## Anonymous protocol sandbox

Use `--sandbox` only for MCP protocol wiring without credentials:

```bash
breakout-scanner list --sandbox
breakout-scanner call market.snapshot --sandbox --input '{"symbols":["ACME"]}'
```

The sandbox is isolated from user workspaces and uses fixed development
fixtures. It does not provide live data, production writes, or approvals. For
a local HTTP server, use the explicit local-development opt-in:

```bash
breakout-scanner list \
  --url http://localhost:3000/mcp/sandbox \
  --sandbox \
  --insecure-local
```

Remote endpoints must use HTTPS. CLI failures are written as structured JSON to
stderr and exit with status 2.

## Development

From the [package repository](https://github.com/AKP-Ventures/breakoutscanner-mcp):

```bash
npm run build --workspace @breakoutscanner/mcp-sdk
npm run build --workspace @breakoutscanner/mcp-cli
npm run typecheck --workspace @breakoutscanner/mcp-cli
npm test --workspace @breakoutscanner/mcp-cli
npm pack --workspace @breakoutscanner/mcp-cli --dry-run
```

See [`RELEASING.md`](../../RELEASING.md) for publication and
[`SECURITY.md`](../../SECURITY.md) for private vulnerability reports.
