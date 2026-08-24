# Releasing the MCP clients

This repository is the package-only source repository for two public npm
packages:

- `@breakoutscanner/mcp-sdk`
- `@breakoutscanner/mcp-cli`, which depends on the matching SDK version

The source is maintained at
[`AKP-Ventures/breakoutscanner-mcp`](https://github.com/AKP-Ventures/breakoutscanner-mcp).
The packages use Apache-2.0, publish preview builds under the `preview` npm
dist-tag, and use `support@breakoutscanner.com` for package support.

Keep preview versions explicit in examples until a separately reviewed stable
release is available.

## Before publishing

1. Update the SDK and CLI versions together in their package manifests.
2. Update the CLI's exact `@breakoutscanner/mcp-sdk` dependency to the same
   version.
3. Update and review `CHANGELOG.md` in the pull request, including public
   API, compatibility, and security changes.
4. Run the complete local release gate from the repository root:

   ```bash
   npm ci
   npm run typecheck
   npm test
   npm run pack:dry-run
   ```

Inspect both dry-run archives. Each archive should contain only the package
manifest, README, license, and compiled `dist` output. It must not contain
credentials, environment files, customer data, or unrelated application code.

## Publish through GitHub Actions

The [`publish-preview-packages.yml`](./.github/workflows/publish-preview-packages.yml)
workflow is manually dispatched and uses npm trusted publishing through OIDC.
Choose `sdk`, `cli`, or `both` as the package input, then enter the exact
confirmation string `publish-preview`. A combined release publishes the SDK
first, verifies it is available, publishes the CLI, and runs clean-install
smoke tests against the public registry.

Configure an npm trusted publisher for each package with:

- owner: `AKP-Ventures`
- repository: `breakoutscanner-mcp`
- workflow: `publish-preview-packages.yml`
- environment: none

The workflow requests only `contents: read` and `id-token: write`; no npm token
is stored in GitHub Actions. Do not publish from a developer machine or add an
npm token to this repository.

After publication, verify both packages from a clean temporary project and
confirm the intended version and `preview` dist-tag on npm. If a registry
propagation delay occurs, wait for the workflow's smoke test rather than
re-running publication blindly.

## Versioning and tags

Preview releases use versions such as `0.1.0-preview.1` and the `preview` tag.
Consumers should install `@preview` or pin an exact preview version. Promote
`latest` only as part of a separately approved stable release after its API,
security, compatibility, and clean-install checks have passed.
