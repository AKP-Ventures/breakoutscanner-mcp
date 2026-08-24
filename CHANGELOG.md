# Changelog

Notable changes to the Breakout Scanner MCP SDK and CLI are recorded here.
The packages remain preview software until a stable release is announced.

## 0.1.0-preview.1 — 2026-08-24

- Moved the public client source into the package-only
  `AKP-Ventures/breakoutscanner-mcp` repository.
- Added bounded streaming response reads and response-body timeouts.
- Added redaction and size limits for untrusted remote error details.
- Added clean package allowlists, Node.js 20/22 CI, npm OIDC publishing, and
  clean-install registry smoke tests.

## 0.1.0-preview.0 — 2026-08-24

- Published the initial TypeScript MCP transport SDK and command-line client.
- Added capability discovery, MCP initialization, tool listing and calls,
  authenticated token handling, and an isolated anonymous protocol sandbox.
