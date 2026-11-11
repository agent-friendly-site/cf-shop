import { describe, expect, it } from "vitest";
import { DomainRpcError } from "../../src/domain/errors";
import {
  assertCanConfirmPayment,
  assertCanSubmitProof,
  type ConfirmableOrder,
  canSubmitProof,
  matchProofUploadToken,
} from "../../src/domain/payment";

function order(
  partial: Partial<ConfirmableOrder> & Pick<ConfirmableOrder, "status">,
): ConfirmableOrder {
  return {
    id: "ord_test",
    total_cny: 140,
    proofs: [{ id: "proof_1" }],
    ...partial,
  };
}

describe("assertCanConfirmPayment", () => {
  it("accepts payment_submitted with matching amount and proofs", () => {
    expect(() =>
      assertCanConfirmPayment(order({ status: "payment_submitted" }), 140),
    ).not.toThrow();
  });

  it("rejects wrong status", () => {
    expect(() => assertCanConfirmPayment(order({ status: "pending_payment" }), 140)).toThrow(
      /not payment_submitted/,
    );
  });

  it("rejects when there are no proofs", () => {
    expect(() =>
      assertCanConfirmPayment(order({ status: "payment_submitted", proofs: [] }), 140),
    ).toThrow(/has no payment proof/);
  });

  it("rejects amount mismatch and keeps legacy wording", () => {
    try {
      assertCanConfirmPayment(order({ status: "payment_submitted" }), 139);
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as DomainRpcError;
      expect(err).toBeInstanceOf(DomainRpcError);
      expect(err.code).toBe(-32000);
      expect(err.message).toBe(
        "verified amount 139 CNY does not match order total 140 CNY; order stays payment_submitted",
      );
    }
  });
});

describe("assertCanSubmitProof", () => {
  it.each(["pending_payment", "payment_submitted"] as const)("allows %s", (status) => {
    expect(canSubmitProof(status)).toBe(true);
    expect(() => assertCanSubmitProof("ord_x", status)).not.toThrow();
  });

  it.each(["paid", "shipped", "completed", "cancelled"] as const)("rejects %s", (status) => {
    expect(canSubmitProof(status)).toBe(false);
    expect(() => assertCanSubmitProof("ord_x", status)).toThrow(/cannot submit a payment proof/);
  });
});

describe("matchProofUploadToken", () => {
  const base = {
    shop: "terra-pots",
    order_id: "ord_1",
    used_at: null as string | null,
    expires_at: "2026-11-18T00:00:00.000Z",
    token_hash: "abc",
  };
  const nowOk = Date.parse("2026-11-11T00:00:00.000Z");

  it("accepts a fresh matching token", () => {
    expect(
      matchProofUploadToken(base, { shop: "terra-pots", orderId: "ord_1", nowMs: nowOk }),
    ).toEqual(base);
  });

  it("rejects missing row", () => {
    expect(
      matchProofUploadToken(null, { shop: "terra-pots", orderId: "ord_1", nowMs: nowOk }),
    ).toBeNull();
  });

  it("rejects shop / order mismatch", () => {
    expect(
      matchProofUploadToken(base, { shop: "bean-bloom", orderId: "ord_1", nowMs: nowOk }),
    ).toBeNull();
    expect(
      matchProofUploadToken(base, { shop: "terra-pots", orderId: "ord_other", nowMs: nowOk }),
    ).toBeNull();
  });

  it("rejects already-used token (single use)", () => {
    expect(
      matchProofUploadToken(
        { ...base, used_at: "2026-11-11T01:00:00.000Z" },
        { shop: "terra-pots", orderId: "ord_1", nowMs: nowOk },
      ),
    ).toBeNull();
  });

  it("rejects expired token", () => {
    expect(
      matchProofUploadToken(base, {
        shop: "terra-pots",
        orderId: "ord_1",
        nowMs: Date.parse("2026-11-19T00:00:00.000Z"),
      }),
    ).toBeNull();
  });
});
