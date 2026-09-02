export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const SDK_VERSION = "0.1.0-preview.2" as const;
export const CURRENT_PROTOCOL_VERSION = "2026-07-28" as const;
export const LEGACY_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18"] as const;
/** The modern protocol is preferred; legacy is selected after a failed probe. */
export const DEFAULT_PROTOCOL_VERSION = CURRENT_PROTOCOL_VERSION;
export const MCP_TOOL_PREFIX = "breakout_scanner_" as const;
/** Maximum response size used when no per-client limit is supplied. */
// A capability payload may be 8 MiB. Authenticated tools also include that
// envelope in both structuredContent and serialized TextContent for legacy
// clients, so the wire response can be materially larger than the logical
// payload. Keep the safety ceiling explicit and configurable; never truncate.
export const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 300 * 1000;

const MAX_ALLOWED_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_ERROR_MESSAGE_CHARS = 512;
const MAX_ERROR_DETAIL_CHARS = 1_024;
const MAX_ERROR_DETAIL_DEPTH = 4;
const MAX_ERROR_DETAIL_ENTRIES = 32;
const MAX_SSE_EVENTS = 1_024;
const MAX_SSE_EVENT_LINES = 4_096;

export interface CapabilityContract {
  readonly kind: "breakoutscanner.capabilities";
  readonly contractVersion: string;
  readonly schemaDialect: string;
  readonly server: {
    readonly name: string;
    readonly version: string;
    readonly protocol: string;
    readonly protocolVersions: readonly string[];
    readonly mcpEndpoint: string;
  };
  readonly contractUrl: string;
  readonly source: string;
  readonly capabilities: readonly CapabilityContractEntry[];
  readonly integrity: {
    readonly algorithm: "sha-256";
    readonly canonicalJson: string;
    readonly value: string;
  };
}

export interface CapabilityContractEntry {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly access: "read" | "write";
  readonly approvalRequired: boolean;
  readonly permissions: readonly string[];
  readonly requiredEntitlement: string | null;
  readonly requiredFeature: string | null;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly evidence: {
    readonly required: boolean;
    readonly asOf: "required" | "optional" | "not_applicable";
    readonly limitations: "required" | "optional";
    readonly sourceKinds: readonly string[];
  };
  readonly redaction: string;
  readonly idempotency: "immutable_artifact" | "approval_hash";
  readonly inputSchema: JsonValue;
  readonly outputSchema: JsonValue;
  readonly transport: {
    readonly protocol: string;
    readonly operation: "tools/call";
    readonly toolName: string;
  };
}

export type McpProtocolEra = "modern" | "legacy";
export type McpVersionNegotiation = "auto" | "modern" | "legacy";

export interface McpServerDiscovery {
  readonly resultType: "complete";
  readonly supportedVersions: readonly string[];
  readonly capabilities: Record<string, unknown>;
  readonly instructions?: string;
  readonly ttlMs?: number;
  readonly cacheScope?: "public" | "private" | string;
  readonly [key: string]: unknown;
}

export interface McpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: JsonValue;
  readonly [key: string]: unknown;
}

export interface McpToolsListResult {
  readonly tools: readonly McpTool[];
  readonly [key: string]: unknown;
}

export interface McpToolCallResult {
  readonly content?: readonly Record<string, unknown>[];
  readonly isError?: boolean;
  readonly [key: string]: unknown;
}

export type McpErrorCode =
  | "invalid_url"
  | "missing_token"
  | "insecure_endpoint"
  | "request_timeout"
  | "transport_error"
  | "http_error"
  | "protocol_error"
  | "invalid_response"
  | "invalid_arguments";

export interface McpClientErrorOptions {
  readonly code: McpErrorCode;
  readonly message: string;
  readonly status?: number;
  readonly retryable?: boolean;
  readonly details?: unknown;
}

export class McpClientError extends Error {
  readonly code: McpErrorCode;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly details: unknown;

  constructor(options: McpClientErrorOptions) {
    super(sanitizeText(options.message, MAX_ERROR_MESSAGE_CHARS));
    this.name = "McpClientError";
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.details = options.details === undefined ? undefined : sanitizeErrorDetails(options.details);
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      ...(this.status == null ? {} : { status: this.status }),
      retryable: this.retryable,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export interface FetchCapabilityContractOptions {
  readonly url?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly allowInsecureHttp?: boolean;
  /** Maximum response body size in bytes. Defaults to 64 MiB. */
  readonly maxResponseBytes?: number;
}

export interface McpClientOptions {
  readonly endpoint: string;
  /** OAuth access token for the authenticated workspace. */
  readonly token?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly clientName?: string;
  readonly clientVersion?: string;
  /**
   * Protocol version to pin. Omitting it enables automatic modern probe with
   * a safe fallback to the legacy initialize/session flow.
   */
  readonly protocolVersion?: string;
  /**
   * Select automatic dual-era negotiation, modern-only, or legacy-only mode.
   * A supplied protocolVersion takes precedence when it identifies an era.
   */
  readonly versionNegotiation?: McpVersionNegotiation;
  readonly timeoutMs?: number;
  readonly allowInsecureHttp?: boolean;
  /** Maximum MCP response body size in bytes. Defaults to 64 MiB. */
  readonly maxResponseBytes?: number;
  /**
   * Explicitly opt into the anonymous simulated sandbox. This is only
   * accepted for an endpoint whose path is exactly `/mcp/sandbox`; production
   * workspace endpoints still require a token.
   */
  readonly allowAnonymousSandbox?: boolean;
}

export interface CallToolOptions {
  readonly idempotencyKey?: string;
  readonly timeoutMs?: number;
}

interface JsonRpcResponse {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function endpointUrl(value: string, allowInsecureHttp: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new McpClientError({ code: "invalid_url", message: "The MCP endpoint URL is invalid" });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new McpClientError({ code: "invalid_url", message: "The MCP endpoint must use HTTPS" });
  }
  if (parsed.username || parsed.password) {
    throw new McpClientError({ code: "invalid_url", message: "The MCP endpoint must not contain URL credentials" });
  }
  for (const key of parsed.searchParams.keys()) {
    if (/^(?:access[_-]?token|api[_-]?key|authorization|bearer|token)$/iu.test(key)) {
      throw new McpClientError({ code: "invalid_url", message: "The MCP endpoint must not contain credentials in its query" });
    }
  }
  const local = parsed.hostname === "localhost"
    || parsed.hostname === "127.0.0.1"
    || parsed.hostname === "[::1]"
    || parsed.hostname === "::1";
  if (parsed.protocol === "http:" && (!allowInsecureHttp || !local)) {
    throw new McpClientError({
      code: "insecure_endpoint",
      message: "HTTP is allowed only for localhost with the explicit local-development option",
    });
  }
  parsed.hash = "";
  return parsed;
}

function timeoutSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function validatedMaxResponseBytes(value: number | undefined): number {
  const maxResponseBytes = value ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > MAX_ALLOWED_RESPONSE_BYTES) {
    throw new McpClientError({
      code: "invalid_arguments",
      message: `maxResponseBytes must be a safe integer between 1 and ${MAX_ALLOWED_RESPONSE_BYTES}`,
    });
  }
  return maxResponseBytes;
}

function validatedTimeoutMs(value: number | undefined, fallback: number): number {
  const timeoutMs = value ?? fallback;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 15 * 60_000) {
    throw new McpClientError({ code: "invalid_arguments", message: "timeoutMs must be between 1000 and 900000" });
  }
  return timeoutMs;
}

const SENSITIVE_KEY = /(?:access[_-]?token|api[_-]?key|apikey|authorization|bearer|client[_-]?secret|password|passwd|private[_-]?key|refresh[_-]?token|secret|token)/iu;

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const marker = "...[truncated]";
  if (maxChars <= marker.length) return marker.slice(0, maxChars);
  return `${value.slice(0, maxChars - marker.length)}${marker}`;
}

function redactSecrets(value: string): string {
  return value
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/gu, "[REDACTED]")
    .replace(/(\bauthorization\s*[:=]\s*)(?:Bearer\s+)?[^\s,;&]+/giu, "$1[REDACTED]")
    .replace(/(\b(?:access[_-]?token|api[_-]?key|apikey|client[_-]?secret|password|passwd|private[_-]?key|refresh[_-]?token|secret|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/giu, "$1[REDACTED]")
    .replace(/\bBearer\s+[^\s,;&]+/giu, "Bearer [REDACTED]");
}

function sanitizeText(value: unknown, maxChars: number): string {
  const text = typeof value === "string" ? value : String(value);
  return truncateText(redactSecrets(text), maxChars);
}

function sanitizeErrorDetails(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return sanitizeText(value, MAX_ERROR_DETAIL_CHARS);
  if (typeof value === "bigint") return sanitizeText(value.toString(), MAX_ERROR_DETAIL_CHARS);
  if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
  if (value instanceof Error) return sanitizeText(`${value.name}: ${value.message}`, MAX_ERROR_DETAIL_CHARS);
  if (typeof value !== "object") return sanitizeText(value, MAX_ERROR_DETAIL_CHARS);
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_ERROR_DETAIL_DEPTH) return "[truncated]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.slice(0, MAX_ERROR_DETAIL_ENTRIES).map((entry) => sanitizeErrorDetails(entry, depth + 1, seen));
    if (value.length > MAX_ERROR_DETAIL_ENTRIES) result.push("[truncated]");
    return result;
  }
  const result: Record<string, unknown> = {};
  const entries = Object.entries(value);
  for (const [key, entry] of entries.slice(0, MAX_ERROR_DETAIL_ENTRIES)) {
    result[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeErrorDetails(entry, depth + 1, seen);
  }
  if (entries.length > MAX_ERROR_DETAIL_ENTRIES) result._truncated = true;
  return result;
}

function responseTooLarge(maxResponseBytes: number): McpClientError {
  return new McpClientError({
    code: "invalid_response",
    message: `The response exceeded the configured ${maxResponseBytes}-byte limit`,
  });
}

function contentLengthBytes(response: Response): number | null {
  const value = response.headers.get("content-length")?.trim();
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

async function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("Response read aborted");
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Response read aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }, (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
  });
}

async function readResponseBody(response: Response, maxResponseBytes: number, signal: AbortSignal): Promise<string> {
  const contentLength = contentLengthBytes(response);
  if (contentLength !== null && contentLength > maxResponseBytes) throw responseTooLarge(maxResponseBytes);
  if (!response.body) {
    const raw = await awaitWithAbort(response.text(), signal);
    if (new TextEncoder().encode(raw).byteLength > maxResponseBytes) throw responseTooLarge(maxResponseBytes);
    return raw;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await awaitWithAbort(reader.read(), signal);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw responseTooLarge(maxResponseBytes);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    if (signal.aborted) await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A hostile stream may leave a read pending even after cancellation.
    }
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new McpClientError({ code: "invalid_response", message: "The MCP response was not valid JSON" });
  }
}

function parseSse(raw: string): unknown {
  const data: string[] = [];
  let eventCount = 0;
  let lastEvent: unknown;
  const flush = (): void => {
    if (data.length === 0) return;
    const value = data.join("\n");
    data.length = 0;
    if (value === "[DONE]") return;
    eventCount += 1;
    if (eventCount > MAX_SSE_EVENTS) {
      throw new McpClientError({ code: "invalid_response", message: "The MCP event stream contained too many events" });
    }
    lastEvent = parseJson(value);
  };
  let lineStart = 0;
  while (lineStart <= raw.length) {
    const newline = raw.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? raw.length : newline;
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/u, "");
    if (line === "") {
      flush();
    } else if (line.startsWith("data:")) {
      if (data.length >= MAX_SSE_EVENT_LINES) {
        throw new McpClientError({ code: "invalid_response", message: "The MCP event stream event was too large" });
      }
      data.push(line.slice(5).trimStart());
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  flush();
  if (eventCount === 0) {
    throw new McpClientError({ code: "invalid_response", message: "The MCP event stream contained no JSON-RPC response" });
  }
  return lastEvent;
}

function parseResponse(raw: string, contentType: string | null): JsonRpcResponse {
  const parsed = contentType?.toLowerCase().includes("text/event-stream") ? parseSse(raw) : parseJson(raw);
  if (!isRecord(parsed)) {
    throw new McpClientError({ code: "invalid_response", message: "The MCP response was not a JSON-RPC object" });
  }
  return parsed as JsonRpcResponse;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function errorMessage(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.message === "string" && value.message.trim()) return sanitizeText(value.message, MAX_ERROR_MESSAGE_CHARS);
  if (isRecord(value) && typeof value.detail === "string" && value.detail.trim()) return sanitizeText(value.detail, MAX_ERROR_MESSAGE_CHARS);
  if (typeof value === "string" && value.trim()) return sanitizeText(value, MAX_ERROR_MESSAGE_CHARS);
  return sanitizeText(fallback, MAX_ERROR_MESSAGE_CHARS);
}

function responseErrorMessage(body: unknown, fallback: string): string {
  if (isRecord(body)) {
    if (body.error !== undefined) return errorMessage(body.error, fallback);
    if (typeof body.detail === "string" && body.detail.trim()) return sanitizeText(body.detail, MAX_ERROR_MESSAGE_CHARS);
  }
  return errorMessage(body, fallback);
}

function protocolErrorCode(error: McpClientError): number | null {
  const details = isRecord(error.details) && isRecord(error.details.error)
    ? error.details.error
    : error.details;
  return isRecord(details) && typeof details.code === "number" ? details.code : null;
}

/**
 * A 2026 probe may reach a server that only implements the initialize-era
 * transport. Only protocol/route incompatibility is eligible for fallback;
 * auth failures, rate limits, timeouts, and upstream failures must surface to
 * the caller instead of being hidden behind a second request.
 */
function canFallbackFromModernProbe(error: unknown): boolean {
  if (!(error instanceof McpClientError)) return false;
  const code = protocolErrorCode(error);
  if (code === -32601 || code === -32022) return true;
  return error.status === 400 || error.status === 404 || error.status === 405 || error.status === 415;
}

function modernRequestMeta(clientName: string, clientVersion: string): JsonObject {
  return {
    "io.modelcontextprotocol/protocolVersion": CURRENT_PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientInfo": {
      name: clientName,
      version: clientVersion,
    },
    // Tasks are intentionally not declared until the server has a reviewed
    // implementation of SEP-2663. A modern request with `{}` remains valid
    // and does not imply support for optional extensions.
    "io.modelcontextprotocol/clientCapabilities": {},
  };
}

function modernResult(result: Record<string, unknown>, method: string): Record<string, unknown> {
  if (result.resultType !== "complete") {
    throw new McpClientError({
      code: "protocol_error",
      message: `MCP ${method} returned unsupported modern result type`,
      details: { resultType: result.resultType },
    });
  }
  return result;
}

function modernSupported(result: Record<string, unknown>): string[] {
  if (!Array.isArray(result.supportedVersions)
    || !result.supportedVersions.every((value) => typeof value === "string")) {
    throw new McpClientError({
      code: "invalid_response",
      message: "MCP server/discover returned an invalid supportedVersions list",
    });
  }
  return result.supportedVersions as string[];
}

export function mcpToolName(capabilityOrTool: string): string {
  const value = capabilityOrTool.trim();
  if (value.startsWith(MCP_TOOL_PREFIX)) return value;
  if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/u.test(value)) {
    throw new McpClientError({ code: "invalid_arguments", message: "Capability name must use dot-separated lowercase identifiers" });
  }
  return `${MCP_TOOL_PREFIX}${value.replaceAll(".", "_")}`;
}

export function capabilityContractUrl(endpoint: string): string {
  const parsed = endpointUrl(endpoint, true);
  parsed.pathname = "/api/v1/capabilities";
  parsed.search = "";
  return parsed.toString();
}

export async function fetchCapabilityContract(
  options: FetchCapabilityContractOptions = {},
): Promise<CapabilityContract> {
  const url = options.url ?? "https://breakoutscanner.com/api/v1/capabilities";
  const parsed = endpointUrl(url, options.allowInsecureHttp ?? false);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new McpClientError({ code: "transport_error", message: "This runtime does not provide fetch" });
  }
  const timeout = timeoutSignal(validatedTimeoutMs(options.timeoutMs, 30_000));
  const maxResponseBytes = validatedMaxResponseBytes(options.maxResponseBytes);
  let response: Response;
  try {
    response = await fetchImpl(parsed, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: timeout.signal,
    });
    const raw = await readResponseBody(response, maxResponseBytes, timeout.signal);
    let body: unknown;
    try {
      body = parseJson(raw);
    } catch (error) {
      if (error instanceof McpClientError) throw error;
      throw new McpClientError({ code: "invalid_response", message: "Capability contract response was invalid" });
    }
    if (!response.ok) {
      throw new McpClientError({
        code: "http_error",
        message: responseErrorMessage(body, `Capability contract request failed (${response.status})`),
        status: response.status,
        retryable: retryableStatus(response.status),
        details: body,
      });
    }
    if (!isRecord(body) || body.kind !== "breakoutscanner.capabilities" || !Array.isArray(body.capabilities)) {
      throw new McpClientError({ code: "invalid_response", message: "The capability contract shape is invalid" });
    }
    return body as unknown as CapabilityContract;
  } catch (error) {
    if (error instanceof McpClientError) throw error;
    if (timeout.signal.aborted) {
      throw new McpClientError({ code: "request_timeout", message: "Capability contract request timed out", retryable: true });
    }
    throw new McpClientError({
      code: "transport_error",
      message: "Capability contract request failed",
      retryable: true,
      details: error instanceof Error ? error.message : undefined,
    });
  } finally {
    timeout.cancel();
  }
}

export class McpClient {
  readonly endpoint: string;
  private readonly token: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly clientName: string;
  private readonly clientVersion: string;
  private readonly requestedProtocolVersion: string | undefined;
  private readonly versionNegotiation: McpVersionNegotiation;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private nextRequestId = 1;
  private sessionId: string | null = null;
  private initialized = false;
  private initializePromise: Promise<Record<string, unknown>> | null = null;
  private era: McpProtocolEra | null = null;
  private negotiatedProtocolVersion: string | null = null;
  private serverDiscovery: McpServerDiscovery | null = null;

  constructor(options: McpClientOptions) {
    const parsed = endpointUrl(options.endpoint, options.allowInsecureHttp ?? false);
    const token = options.token?.trim() ?? "";
    const sandboxPath = parsed.pathname.replace(/\/+$/u, "") === "/mcp/sandbox";
    const anonymousSandbox = options.allowAnonymousSandbox === true && sandboxPath;
    if (!token && !anonymousSandbox) {
      throw new McpClientError({ code: "missing_token", message: "An OAuth access token is required and must not contain whitespace" });
    }
    if (/\s/u.test(token)) {
      throw new McpClientError({ code: "missing_token", message: "An OAuth access token is required and must not contain whitespace" });
    }
    if (typeof options.fetch !== "function" && typeof globalThis.fetch !== "function") {
      throw new McpClientError({ code: "transport_error", message: "This runtime does not provide fetch" });
    }
    this.endpoint = parsed.toString();
    this.token = token;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.clientName = options.clientName?.trim() || "breakout-scanner-sdk";
    this.clientVersion = options.clientVersion?.trim() || SDK_VERSION;
    this.requestedProtocolVersion = options.protocolVersion?.trim() || undefined;
    const inferredMode: McpVersionNegotiation = this.requestedProtocolVersion === CURRENT_PROTOCOL_VERSION
      ? "modern"
      : this.requestedProtocolVersion
        ? "legacy"
        : "auto";
    this.versionNegotiation = options.versionNegotiation ?? inferredMode;
    if (this.versionNegotiation === "modern" && this.requestedProtocolVersion != null
      && this.requestedProtocolVersion !== CURRENT_PROTOCOL_VERSION) {
      throw new McpClientError({
        code: "invalid_arguments",
        message: "modern versionNegotiation requires protocolVersion 2026-07-28 or no protocolVersion",
      });
    }
    if (this.versionNegotiation === "legacy" && this.requestedProtocolVersion === CURRENT_PROTOCOL_VERSION) {
      throw new McpClientError({
        code: "invalid_arguments",
        message: "legacy versionNegotiation cannot use protocolVersion 2026-07-28",
      });
    }
    this.timeoutMs = validatedTimeoutMs(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.maxResponseBytes = validatedMaxResponseBytes(options.maxResponseBytes);
  }

  async discover(options: Omit<FetchCapabilityContractOptions, "url"> = {}): Promise<CapabilityContract> {
    return fetchCapabilityContract({
      ...options,
      url: capabilityContractUrl(this.endpoint),
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      maxResponseBytes: options.maxResponseBytes ?? this.maxResponseBytes,
    });
  }

  async initialize(): Promise<Record<string, unknown>> {
    if (this.initialized) return { initialized: true };
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = this.negotiate().finally(() => {
      this.initializePromise = null;
    });
    return this.initializePromise;
  }

  /**
   * Return the modern discovery result when the endpoint supports it. A
   * legacy-only endpoint returns `null` after its initialize handshake; this
   * makes the downgrade visible without fabricating modern capabilities.
   */
  async discoverServer(): Promise<McpServerDiscovery | null> {
    await this.initialize();
    return this.serverDiscovery;
  }

  /** The selected wire era after initialize/automatic negotiation. */
  get protocolEra(): McpProtocolEra | null {
    return this.era;
  }

  /** The negotiated date-based protocol revision, when initialized. */
  get protocolVersion(): string | null {
    return this.negotiatedProtocolVersion;
  }

  async listTools(): Promise<McpToolsListResult> {
    await this.initialize();
    const result = await this.request("tools/list", {}, {}, this.requiredEra());
    if (!isRecord(result) || !Array.isArray(result.tools)) {
      throw new McpClientError({ code: "invalid_response", message: "MCP tools/list returned an invalid result" });
    }
    return result as McpToolsListResult;
  }

  async callTool(
    capabilityOrTool: string,
    argumentsValue: JsonObject = {},
    options: CallToolOptions = {},
  ): Promise<McpToolCallResult> {
    await this.initialize();
    const name = mcpToolName(capabilityOrTool);
    const result = await this.request("tools/call", {
      name,
      arguments: argumentsValue,
    }, options, this.requiredEra(), name);
    if (!isRecord(result)) {
      throw new McpClientError({ code: "invalid_response", message: "MCP tools/call returned an invalid result" });
    }
    return result as McpToolCallResult;
  }

  private requiredEra(): McpProtocolEra {
    if (this.era) return this.era;
    // `initialize()` sets this before any public operation continues. Keep a
    // defensive failure here in case a future method bypasses that boundary.
    throw new McpClientError({ code: "protocol_error", message: "MCP client has not negotiated a protocol era" });
  }

  private async negotiate(): Promise<Record<string, unknown>> {
    if (this.versionNegotiation !== "legacy") {
      try {
        const result = await this.request("server/discover", {}, {}, "modern");
        const discovery = modernResult(result, "server/discover");
        const supportedVersions = modernSupported(discovery);
        if (!supportedVersions.includes(CURRENT_PROTOCOL_VERSION)) {
          if (this.versionNegotiation === "modern") {
            throw new McpClientError({
              code: "protocol_error",
              message: "The MCP server did not advertise protocol version 2026-07-28",
              details: { supportedVersions },
            });
          }
          // A successful modern RPC can still advertise a legacy-only server
          // (for example, through a compatibility gateway). Downgrade only if
          // it explicitly offers an initialize-era revision.
          if (!supportedVersions.some((value) => LEGACY_PROTOCOL_VERSIONS.includes(value as (typeof LEGACY_PROTOCOL_VERSIONS)[number]))) {
            throw new McpClientError({
              code: "protocol_error",
              message: "The MCP server advertises no mutually supported protocol version",
              details: { supportedVersions },
            });
          }
          return this.initializeLegacy(supportedVersions);
        }
        this.era = "modern";
        this.negotiatedProtocolVersion = CURRENT_PROTOCOL_VERSION;
        this.serverDiscovery = discovery as McpServerDiscovery;
        this.initialized = true;
        return discovery;
      } catch (error) {
        if (this.versionNegotiation === "modern" || !canFallbackFromModernProbe(error)) throw error;
        return this.initializeLegacy();
      }
    }
    return this.initializeLegacy();
  }

  private async initializeLegacy(advertisedVersions?: readonly string[]): Promise<Record<string, unknown>> {
    const configured = this.requestedProtocolVersion;
    const advertisedLegacy = advertisedVersions?.filter((value): value is string =>
      LEGACY_PROTOCOL_VERSIONS.includes(value as (typeof LEGACY_PROTOCOL_VERSIONS)[number]),
    );
    const protocolVersion = configured && configured !== CURRENT_PROTOCOL_VERSION
      ? configured
      : advertisedLegacy?.[0] ?? LEGACY_PROTOCOL_VERSIONS[0];
    this.era = "legacy";
    this.negotiatedProtocolVersion = protocolVersion;
    this.serverDiscovery = null;
    this.sessionId = null;
    const result = await this.request("initialize", {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: this.clientName, version: this.clientVersion },
    }, {}, "legacy");
    const responseProtocol = typeof result.protocolVersion === "string" && result.protocolVersion !== CURRENT_PROTOCOL_VERSION
      ? result.protocolVersion
      : protocolVersion;
    this.negotiatedProtocolVersion = responseProtocol;
    this.initialized = true;
    return result;
  }

  private async request(
    method: string,
    params: JsonObject,
    options: CallToolOptions = {},
    era: McpProtocolEra = this.requiredEra(),
    name?: string,
  ): Promise<Record<string, unknown>> {
    const id = this.nextRequestId++;
    const timeout = timeoutSignal(validatedTimeoutMs(options.timeoutMs, this.timeoutMs));
    const headers: Record<string, string> = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    };
    const requestParams: JsonObject = era === "modern"
      ? { ...params, _meta: modernRequestMeta(this.clientName, this.clientVersion) }
      : params;
    if (era === "modern") {
      headers["MCP-Protocol-Version"] = CURRENT_PROTOCOL_VERSION;
      headers["Mcp-Method"] = method;
      if (name) headers["Mcp-Name"] = name;
    } else {
      headers["MCP-Protocol-Version"] = this.negotiatedProtocolVersion
        ?? this.requestedProtocolVersion
        ?? LEGACY_PROTOCOL_VERSIONS[0];
    }
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (era === "legacy" && this.sessionId) headers["MCP-Session-Id"] = this.sessionId;
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params: requestParams }),
        redirect: "error",
        signal: timeout.signal,
      });
      const responseSession = response.headers.get("Mcp-Session-Id") || response.headers.get("MCP-Session-Id");
      if (era === "legacy" && responseSession) this.sessionId = responseSession;
      const raw = await readResponseBody(response, this.maxResponseBytes, timeout.signal);
      let body: JsonRpcResponse;
      try {
        body = parseResponse(raw, response.headers.get("content-type"));
      } catch (error) {
        // Some legacy gateways reject the modern protocol header with a plain
        // HTTP 400/405 response instead of a JSON-RPC error. Preserve the
        // status so automatic negotiation can downgrade safely.
        if (!response.ok && error instanceof McpClientError) {
          throw new McpClientError({
            code: "http_error",
            message: `MCP ${method} request failed (${response.status})`,
            status: response.status,
            retryable: retryableStatus(response.status),
            details: error.toJSON(),
          });
        }
        throw error;
      }
      if (!response.ok) {
        throw new McpClientError({
          code: "http_error",
          message: responseErrorMessage(body, `MCP request failed (${response.status})`),
          status: response.status,
          retryable: retryableStatus(response.status),
          details: body,
        });
      }
      if (body.error !== undefined) {
        throw new McpClientError({
          code: "protocol_error",
          message: errorMessage(body.error, `MCP ${method} returned a JSON-RPC error`),
          details: body.error,
        });
      }
      if (!isRecord(body.result)) {
        throw new McpClientError({ code: "invalid_response", message: `MCP ${method} returned no result` });
      }
      return era === "modern" ? modernResult(body.result, method) : body.result;
    } catch (error) {
      if (error instanceof McpClientError) throw error;
      if (timeout.signal.aborted) {
        throw new McpClientError({ code: "request_timeout", message: `MCP ${method} request timed out`, retryable: true });
      }
      throw new McpClientError({
        code: "transport_error",
        message: `MCP ${method} request failed`,
        retryable: true,
        details: error instanceof Error ? error.message : undefined,
      });
    } finally {
      timeout.cancel();
    }
  }
}
