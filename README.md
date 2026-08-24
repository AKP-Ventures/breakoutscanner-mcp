# Breakout Scanner MCP clients

Public TypeScript clients for connecting an MCP-capable agent or application to
the Breakout Scanner workspace over Streamable HTTP.

| Package | Use it for |
| --- | --- |
| [`@breakoutscanner/mcp-sdk`](./packages/sdk) | TypeScript integrations, capability discovery, MCP initialization, tool listing, and tool calls |
| [`@breakoutscanner/mcp-cli`](./packages/cli) | Shell scripts, local development, discovery, and authenticated tool calls |

Useful links: [developer documentation](https://breakoutscanner.com/docs),
[repository](https://github.com/AKP-Ventures/breakoutscanner-mcp),
[SDK on npm](https://www.npmjs.com/package/@breakoutscanner/mcp-sdk), and
[CLI on npm](https://www.npmjs.com/package/@breakoutscanner/mcp-cli).

## Status

Both packages are preview releases. Their public API and the Breakout Scanner
capability contract may change before the stable 0.1.0 release. Pin an exact
preview version in applications that need reproducible installs.

The clients provide transport and protocol handling only. Breakout Scanner
remains authoritative for authentication, account eligibility, capability
grants, approval, validation, evidence, and execution. A client cannot bypass
those controls, and the packages do not contain market data, customer data,
credentials, workspace state, or private application code.

## Install the preview

```bash
npm install @breakoutscanner/mcp-sdk@preview
npm install --global @breakoutscanner/mcp-cli@preview
```

For the OAuth connection flow and the capability contract, see the
[developer documentation](https://breakoutscanner.com/docs).

## Choose a client

Use the SDK when an agent or application is written in TypeScript and needs a
small, typed transport layer:

```ts
import { McpClient, fetchCapabilityContract } from "@breakoutscanner/mcp-sdk";

const contract = await fetchCapabilityContract();
const client = new McpClient({
  endpoint: "https://breakoutscanner.com/mcp",
  token: process.env.BREAKOUT_SCANNER_TOKEN,
  clientName: "my-agent",
  clientVersion: "1.0.0",
});

console.log(contract.capabilities.map(({ name }) => name));
console.log(await client.listTools());
```

Use the CLI when the integration belongs in a shell script or you want to
inspect the public contract before writing code:

```bash
breakout-scanner discover
breakout-scanner list --url https://breakoutscanner.com/mcp
```

The authenticated endpoint requires an OAuth access token. The CLI reads it
from `BREAKOUT_SCANNER_TOKEN` or from standard input; it never accepts a token
as a command-line argument. See the [SDK guide](./packages/sdk/README.md) and
[CLI guide](./packages/cli/README.md) for complete examples.

## Anonymous protocol sandbox

Both clients can opt into the public `/mcp/sandbox` endpoint for protocol
wiring without credentials. The sandbox is isolated from user workspaces and
does not perform live reads, writes, or approvals. It is a development aid, not
a substitute for an authenticated integration or live market data.

## Development

Requires Node.js 20 or newer and npm 10 or newer.

```bash
npm ci
npm run typecheck
npm test
npm run pack:dry-run
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request and
[RELEASING.md](./RELEASING.md) before publishing a package. User-visible
changes are recorded in [CHANGELOG.md](./CHANGELOG.md).

## Security and support

Please read [SECURITY.md](./SECURITY.md) before reporting a vulnerability.
For package support, email [support@breakoutscanner.com](mailto:support@breakoutscanner.com).

## License

Apache-2.0. See [LICENSE](./LICENSE).
