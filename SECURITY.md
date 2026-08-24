# Security policy

Please do not disclose vulnerabilities in public GitHub issues or pull
requests. Report them privately to
[support@breakoutscanner.com](mailto:support@breakoutscanner.com).

Include:

- the affected package and version;
- a concise description of the impact;
- reproduction steps or a minimal proof of concept; and
- a suggested mitigation, if one is known.

Do not include access tokens, customer data, or other secrets in a report. If a
secret has been exposed, revoke it first and describe the type of secret
without sending its value.

We will acknowledge a report as soon as practical and coordinate a fix and
disclosure timeline with the reporter.

## Client security boundaries

The SDK and CLI are transport clients. They do not contain market data,
customer data, or workspace state, and they do not grant access by themselves.
The Breakout Scanner service remains responsible for authentication, account
eligibility, capability grants, approval, validation, evidence, and execution.

For authenticated use:

- obtain an OAuth access token through the documented connection flow;
- keep it in a secret manager or environment variable, and use the CLI's
  standard-input option when a one-shot command needs it;
- never commit a token or put one in a URL, shell argument, issue, or log; and
- use HTTPS for remote endpoints.

The anonymous `/mcp/sandbox` endpoint is for protocol development only. It is
isolated from user workspaces and does not provide live data or production
write access.
