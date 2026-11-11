import { describe, expect, it } from "vitest";
import {
  ORDER_STATUSES,
  type OrderStatus,
  UNPAID_EXPIRY_MINUTES,
} from "../../src/domain/constants";
import { DomainRpcError } from "../../src/domain/errors";
import {
  allowedTransitions,
  assertCanTransition,
  canCancel,
  canTransition,
  canUpdateBuyerInfo,
  isUnpaidExpired,
  paymentExpiresAt,
  TRANSITIONS,
} from "../../src/domain/order";

describe("order status machine", () => {
  it("lists every status in ORDER_STATUSES", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it.each([
    ["pending_payment", "payment_submitted"],
    ["pending_payment", "cancelled"],
    ["payment_submitted", "paid"],
    ["payment_submitted", "cancelled"],
    ["paid", "shipped"],
    ["shipped", "completed"],
  ] as const)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(allowedTransitions(from)).toContain(to);
  });

  it.each([
    ["pending_payment", "paid"],
    ["pending_payment", "shipped"],
    ["pending_payment", "completed"],
    ["payment_submitted", "shipped"],
    ["payment_submitted", "completed"],
    ["payment_submitted", "pending_payment"],
    ["paid", "cancelled"],
    ["paid", "completed"],
    ["paid", "payment_submitted"],
    ["shipped", "cancelled"],
    ["shipped", "paid"],
    ["completed", "shipped"],
    ["completed", "cancelled"],
    ["cancelled", "pending_payment"],
    ["cancelled", "paid"],
  ] as const)("rejects %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("assertCanTransition throws DomainRpcError with legacy message", () => {
    expect(() => assertCanTransition("ord_x", "paid", "cancelled")).toThrow(DomainRpcError);
    try {
      assertCanTransition("ord_x", "paid", "cancelled");
    } catch (e) {
      const err = e as DomainRpcError;
      expect(err.message).toBe("order ord_x is paid; cannot move to cancelled");
      expect(err.code).toBe(-32000);
    }
  });

  it("terminal statuses have no outbound transitions", () => {
    expect(allowedTransitions("completed")).toEqual([]);
    expect(allowedTransitions("cancelled")).toEqual([]);
  });
});

describe("canCancel / canUpdateBuyerInfo", () => {
  it.each(["pending_payment", "payment_submitted"] as OrderStatus[])(
    "can cancel from %s",
    (status) => {
      expect(canCancel(status)).toBe(true);
    },
  );

  it.each(["paid", "shipped", "completed", "cancelled"] as OrderStatus[])(
    "cannot cancel from %s",
    (status) => {
      expect(canCancel(status)).toBe(false);
    },
  );

  it.each(["pending_payment", "payment_submitted", "paid"] as OrderStatus[])(
    "can update buyer info from %s",
    (status) => {
      expect(canUpdateBuyerInfo(status)).toBe(true);
    },
  );

  it.each(["shipped", "completed", "cancelled"] as OrderStatus[])(
    "cannot update buyer info from %s",
    (status) => {
      expect(canUpdateBuyerInfo(status)).toBe(false);
    },
  );
});

describe("unpaid expiry", () => {
  const created = "2026-11-11T12:00:00.000Z";
  const createdMs = Date.parse(created);

  it("is not expired before the window", () => {
    expect(isUnpaidExpired(created, createdMs + (UNPAID_EXPIRY_MINUTES * 60 * 1000 - 1))).toBe(
      false,
    );
  });

  it("is expired at and after the window", () => {
    expect(isUnpaidExpired(created, createdMs + UNPAID_EXPIRY_MINUTES * 60 * 1000)).toBe(true);
    expect(isUnpaidExpired(created, createdMs + UNPAID_EXPIRY_MINUTES * 60 * 1000 + 1)).toBe(true);
  });

  it("paymentExpiresAt only for pending_payment", () => {
    expect(paymentExpiresAt(created, "pending_payment")).toBe(
      new Date(createdMs + UNPAID_EXPIRY_MINUTES * 60 * 1000).toISOString(),
    );
    expect(paymentExpiresAt(created, "payment_submitted")).toBeNull();
    expect(paymentExpiresAt(created, "paid")).toBeNull();
  });
});
