# Contributing

Thank you for helping improve the public Breakout Scanner MCP clients. This
repository contains only the SDK, CLI, their tests, and public documentation.

## Scope

Keep changes focused on the package clients and their public contract. Do not
add credentials, customer data, private service implementation, internal
operations material, or copied application code. Changes to authentication,
capability names, write handling, or error behavior must make the security and
compatibility impact explicit.

## Development requirements

Use Node.js 20 or newer and npm 10 or newer. From the repository root:

```bash
npm ci
npm run typecheck
npm test
npm run pack:dry-run
```

The dry-run packages should contain only the files intended for npm: the
package manifest, README, license, and compiled `dist` output.

## Pull requests

Open a pull request in
[`AKP-Ventures/breakoutscanner-mcp`](https://github.com/AKP-Ventures/breakoutscanner-mcp).
Describe:

- the user-facing behavior or documentation change;
- tests and checks run locally;
- security or privacy implications; and
- compatibility considerations, including any package-version changes.

Behavior changes require tests. Keep the SDK and CLI preview versions aligned,
and keep the CLI's exact SDK dependency synchronized with the SDK version.
Maintainers may request changes to preserve the authentication, sandbox, and
server-enforced approval boundaries documented by the packages.

Please read [SECURITY.md](./SECURITY.md) before reporting a vulnerability and
[RELEASING.md](./RELEASING.md) before proposing a publication change.
