import { describe, expect, it } from "vitest";
import { DomainError, DomainRpcError, toHttpError, toMcpError } from "../../src/domain/errors";

describe("toHttpError / toMcpError snapshots", () => {
  it("maps DomainError to HTTP {error:{code,message}}", () => {
    const err = new DomainError(
      "amount_mismatch",
      "verified amount 139 CNY does not match order total 140 CNY; order stays payment_submitted",
      400,
      -32000,
    );
    expect(toHttpError(err)).toMatchInlineSnapshot(`
      {
        "body": {
          "error": {
            "code": "amount_mismatch",
            "message": "verified amount 139 CNY does not match order total 140 CNY; order stays payment_submitted",
          },
        },
        "status": 400,
      }
    `);
  });

  it("maps DomainRpcError invalid_params", () => {
    const err = new DomainRpcError("unknown product_id: x", -32602);
    expect(toHttpError(err)).toMatchInlineSnapshot(`
      {
        "body": {
          "error": {
            "code": "invalid_params",
            "message": "unknown product_id: x",
          },
        },
        "status": 400,
      }
    `);
    expect(err.rpcCode).toBe(-32602);
  });

  it("maps DomainError to MCP isError text", () => {
    const err = new DomainError("conflict", "order ord_x is paid; cannot move to cancelled");
    expect(toMcpError(err)).toMatchInlineSnapshot(`
      {
        "content": [
          {
            "text": "order ord_x is paid; cannot move to cancelled",
            "type": "text",
          },
        ],
        "isError": true,
      }
    `);
  });

  it("maps unknown Error to internal_error HTTP 500", () => {
    expect(toHttpError(new Error("boom"))).toMatchInlineSnapshot(`
      {
        "body": {
          "error": {
            "code": "internal_error",
            "message": "boom",
          },
        },
        "status": 500,
      }
    `);
  });
});
