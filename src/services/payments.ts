/**
 * Payments service (Phase 3.x harden).
 * Proof submit / confirm / one-time upload tokens — domain rules live here.
 */
import * as proofsRepo from "../db/repositories/proofs";
import { DomainRpcError, PROOF_UPLOAD_TTL_DAYS, sha256Hex } from "../db/shared";
import {
  assertCanConfirmPayment,
  assertCanSubmitProof,
  canSubmitProof,
  matchProofUploadToken,
} from "../domain/payment";
import { getOrder, transitionOrder } from "./orders";

export { proofUploadUrl } from "../db/repositories/proofs";

export async function addPaymentProof(
  db: D1Database,
  {
    orderId,
    paymentMethod,
    transactionId,
    amountCny,
  }: { orderId: string; paymentMethod: string; transactionId: string; amountCny: number },
) {
  const order = await getOrder(db, orderId);
  if (!order) return null;
  // Submitting a proof never marks the order paid. It records the proof and
  // moves the order to payment_submitted (awaiting seller verification).
  // A proof on an already-paid (or later) order is rejected: the payment
  // is already verified and must not be re-opened by a new proof.
  assertCanSubmitProof(orderId, order.status);
  const wasPending = order.status === "pending_payment";
  await proofsRepo.insertTextPaymentProof(db, {
    orderId,
    paymentMethod,
    transactionId,
    amountCny,
    wasPending,
  });
  return getOrder(db, orderId);
}

export async function createProofUploadToken(
  db: D1Database,
  {
    shop,
    orderId,
    ttlDays = PROOF_UPLOAD_TTL_DAYS,
  }: { shop: string; orderId: string; ttlDays?: number },
) {
  const order = await getOrder(db, orderId);
  if (!order) {
    throw new DomainRpcError(`unknown order_id: ${orderId}`, -32602);
  }
  if (order.shop !== shop) {
    throw new DomainRpcError(`order ${orderId} does not belong to shop ${shop}`, -32602);
  }
  if (!canSubmitProof(order.status)) {
    throw new DomainRpcError(
      `order ${orderId} is ${order.status}; a payment proof can no longer be uploaded`,
      -32000,
    );
  }
  // A fresh token on every call: only the hash is stored, so an earlier
  // token cannot be reconstructed. Earlier unused tokens stay valid
  // until they expire or are used; that is harmless.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  await proofsRepo.insertProofUploadToken(db, {
    tokenHash: await sha256Hex(token),
    shop,
    orderId,
    now,
    expires,
  });
  return {
    token,
    url: proofsRepo.proofUploadUrl(shop, orderId, token),
    expires_at: expires,
  };
}

export async function verifyProofUploadToken(
  db: D1Database,
  { shop, orderId, token }: { shop: string; orderId: string; token: string },
) {
  if (!token) return null;
  const row = await proofsRepo.findProofUploadTokenRow(db, token);
  return matchProofUploadToken(row, { shop, orderId });
}

export async function consumeProofUploadToken(db: D1Database, tokenHash: string): Promise<void> {
  return proofsRepo.markProofUploadTokenUsed(db, tokenHash);
}

export async function addImagePaymentProof(
  db: D1Database,
  {
    orderId,
    paymentMethod,
    fileName,
    mimeType,
    fileSize,
    r2Key,
    transactionId,
    amountCny,
  }: {
    orderId: string;
    paymentMethod: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    r2Key: string;
    transactionId: string | null;
    amountCny: number | null;
  },
) {
  const order = await getOrder(db, orderId);
  if (!order) return null;
  assertCanSubmitProof(orderId, order.status);
  const wasPending = order.status === "pending_payment";
  await proofsRepo.insertImagePaymentProof(db, {
    orderId,
    paymentMethod,
    fileName,
    mimeType,
    fileSize,
    r2Key,
    transactionId,
    amountCny,
    wasPending,
  });
  return getOrder(db, orderId);
}

export async function confirmPayment(
  db: D1Database,
  {
    orderId,
    verifiedAmountCny,
    note,
  }: { orderId: string; verifiedAmountCny: number; note?: string },
) {
  const order = await getOrder(db, orderId);
  if (!order) {
    throw new DomainRpcError(`unknown order_id: ${orderId}`, -32602);
  }
  assertCanConfirmPayment(order, verifiedAmountCny);
  const now = new Date().toISOString();
  return transitionOrder(db, order, "paid", "payment_confirmed", "seller", note || null, {
    verified_amount_cny: verifiedAmountCny,
    verified_at: now,
    verification_note: note || null,
  });
}
