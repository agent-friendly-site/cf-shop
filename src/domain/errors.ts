/**
 * Unified domain errors (Phase 3.5).
 * Services throw DomainError; HTTP/MCP adapters translate via toHttpError / toMcpError.
 */

export class DomainError extends Error {
  /** Stable machine code for HTTP `{error:{code,message}}`. */
  readonly code: string;
  /** HTTP status for the admin / REST adapters. */
  readonly status: number;
  /** JSON-RPC numeric code used by the MCP tool layer. */
  readonly rpcCode: number;

  constructor(code: string, message: string, status = 400, rpcCode = -32000) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
    this.rpcCode = rpcCode;
  }
}

/**
 * Legacy constructor used across repositories/domain helpers.
 * `code` argument is the JSON-RPC numeric code (-32602 / -32000).
 */
export class DomainRpcError extends DomainError {
  constructor(message: string, rpcCode: number) {
    super(rpcCode === -32602 ? "invalid_params" : "domain_error", message, 400, rpcCode);
    this.name = "DomainRpcError";
  }
}

export type HttpErrorBody = { error: { code: string; message: string } };

export function toHttpError(err: unknown): { status: number; body: HttpErrorBody } {
  if (err instanceof DomainError) {
    return {
      status: err.status,
      body: { error: { code: err.code, message: err.message } },
    };
  }
  if (err instanceof Error) {
    return {
      status: 500,
      body: { error: { code: "internal_error", message: err.message } },
    };
  }
  return {
    status: 500,
    body: { error: { code: "internal_error", message: String(err) } },
  };
}

export type McpErrorResult = {
  isError: true;
  content: [{ type: "text"; text: string }];
};

export function toMcpError(err: unknown): McpErrorResult {
  const message =
    err instanceof DomainError ? err.message : err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
