import { DomainRpcError, PROOF_UPLOAD_TTL_DAYS, sha256Hex, writeEvent } from "../shared";
import { getOrder, transitionOrder } from "./orders";

export function proofUploadUrl(shop: string, orderId: string, token: string): string {
  return `https://agent-friendly-platform.refined-x.workers.dev/shops/${shop}/orders/${orderId}/upload-proof?token=${token}`;
}

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
  if (order.status !== "pending_payment" && order.status !== "payment_submitted") {
    throw new DomainRpcError(
      `order ${orderId} is already ${order.status}; cannot submit a payment proof`,
      -32000,
    );
  }
  const wasPending = order.status === "pending_payment";
  const now = new Date().toISOString();
  const id = `proof_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const insert = db
    .prepare(
      "INSERT INTO payment_proofs (id, order_id, payment_method, transaction_id, amount_cny, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id, orderId, paymentMethod, transactionId, amountCny, now);
  if (wasPending) {
    const update = db
      .prepare("UPDATE orders SET status = 'payment_submitted', updated_at = ? WHERE id = ?")
      .bind(now, orderId);
    const evt = writeEvent(db, {
      orderId,
      event: "payment_proof_submitted",
      fromStatus: "pending_payment",
      toStatus: "payment_submitted",
      actor: "buyer",
      note: `${paymentMethod} ${transactionId}`,
      now,
    });
    await db.batch([insert, update, evt]);
  } else {
    await insert.run();
  }
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
  if (!["pending_payment", "payment_submitted"].includes(order.status)) {
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
  await db
    .prepare(
      "INSERT INTO proof_upload_tokens (token_hash, shop, order_id, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, NULL)",
    )
    .bind(await sha256Hex(token), shop, orderId, now, expires)
    .run();
  return { token, url: proofUploadUrl(shop, orderId, token), expires_at: expires };
}

export async function verifyProofUploadToken(
  db: D1Database,
  { shop, orderId, token }: { shop: string; orderId: string; token: string },
) {
  if (!token) return null;
  const row = (await db
    .prepare("SELECT * FROM proof_upload_tokens WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .first()) as {
    shop: string;
    order_id: string;
    used_at: string | null;
    expires_at: string;
    token_hash: string;
  } | null;
  if (!row) return null;
  if (row.shop !== shop || row.order_id !== orderId) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export async function consumeProofUploadToken(db: D1Database, tokenHash: string): Promise<void> {
  await db
    .prepare("UPDATE proof_upload_tokens SET used_at = ? WHERE token_hash = ?")
    .bind(new Date().toISOString(), tokenHash)
    .run();
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
  if (order.status !== "pending_payment" && order.status !== "payment_submitted") {
    throw new DomainRpcError(
      `order ${orderId} is already ${order.status}; cannot submit a payment proof`,
      -32000,
    );
  }
  const wasPending = order.status === "pending_payment";
  const now = new Date().toISOString();
  const id = `proof_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const insert = db
    .prepare(
      "INSERT INTO payment_proofs (id, order_id, payment_method, transaction_id, amount_cny, proof_type, r2_key, file_name, mime_type, file_size, created_at) VALUES (?, ?, ?, ?, ?, 'image', ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      orderId,
      paymentMethod,
      transactionId || null,
      amountCny ?? null,
      r2Key,
      fileName,
      mimeType,
      fileSize,
      now,
    );
  const note = `图片凭据 ${fileName}${transactionId ? ` · 单号 ${transactionId}` : ""}`;
  if (wasPending) {
    const update = db
      .prepare("UPDATE orders SET status = 'payment_submitted', updated_at = ? WHERE id = ?")
      .bind(now, orderId);
    const evt = writeEvent(db, {
      orderId,
      event: "payment_proof_submitted",
      fromStatus: "pending_payment",
      toStatus: "payment_submitted",
      actor: "buyer",
      note,
      now,
    });
    await db.batch([insert, update, evt]);
  } else {
    await insert.run();
  }
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
  if (order.status !== "payment_submitted") {
    throw new DomainRpcError(
      `order ${orderId} is ${order.status}, not payment_submitted; only an order awaiting verification can be confirmed`,
      -32000,
    );
  }
  if (!order.proofs || order.proofs.length === 0) {
    throw new DomainRpcError(
      `order ${orderId} has no payment proof; cannot confirm payment`,
      -32000,
    );
  }
  if (verifiedAmountCny !== order.total_cny) {
    throw new DomainRpcError(
      `verified amount ${verifiedAmountCny} CNY does not match order total ${order.total_cny} CNY; order stays payment_submitted`,
      -32000,
    );
  }
  const now = new Date().toISOString();
  return transitionOrder(db, order, "paid", "payment_confirmed", "seller", note || null, {
    verified_amount_cny: verifiedAmountCny,
    verified_at: now,
    verification_note: note || null,
  });
}
