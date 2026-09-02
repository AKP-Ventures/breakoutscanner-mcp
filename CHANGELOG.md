# Changelog

Notable changes to the Breakout Scanner MCP SDK and CLI are recorded here.
The packages remain preview software until a stable release is announced.

## 0.1.0-preview.2 — 2026-09-02

- Added MCP `2026-07-28` discovery and request metadata, while retaining a
  safe fallback for servers that only support the `2025-11-25` or
  `2025-06-18` initialize flow.
- Made the selected protocol era and version visible through the SDK instead
  of hiding compatibility decisions from callers.
- Increased the default request timeout to 300 seconds for complete agent
  results, with the existing per-call override retained.
- Increased the configurable response safety ceiling to 64 MiB. Responses are
  rejected when they exceed the configured ceiling; complete logical results
  are never silently shortened.
- Updated the CLI and public documentation for dual-era negotiation. This
  release keeps authenticated calls synchronous and does not claim support for
  the optional MCP Tasks/background extension.

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
