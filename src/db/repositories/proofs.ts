/**
 * Payment-proof data access (Phase 3.x harden).
 * Token/proof SQL only. Domain rules live in services/payments.ts.
 */
import type { UploadTokenRow } from "../../domain/payment";
import { sha256Hex, writeEvent } from "../shared";

export function proofUploadUrl(shop: string, orderId: string, token: string): string {
  return `https://agent-friendly-platform.refined-x.workers.dev/shops/${shop}/orders/${orderId}/upload-proof?token=${token}`;
}

export async function insertTextPaymentProof(
  db: D1Database,
  {
    orderId,
    paymentMethod,
    transactionId,
    amountCny,
    wasPending,
  }: {
    orderId: string;
    paymentMethod: string;
    transactionId: string;
    amountCny: number;
    wasPending: boolean;
  },
): Promise<void> {
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
}

export async function insertImagePaymentProof(
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
    wasPending,
  }: {
    orderId: string;
    paymentMethod: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    r2Key: string;
    transactionId: string | null;
    amountCny: number | null;
    wasPending: boolean;
  },
): Promise<void> {
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
}

export async function insertProofUploadToken(
  db: D1Database,
  {
    tokenHash,
    shop,
    orderId,
    now,
    expires,
  }: { tokenHash: string; shop: string; orderId: string; now: string; expires: string },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO proof_upload_tokens (token_hash, shop, order_id, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, NULL)",
    )
    .bind(tokenHash, shop, orderId, now, expires)
    .run();
}

export async function findProofUploadTokenRow(
  db: D1Database,
  token: string,
): Promise<UploadTokenRow | null> {
  return (await db
    .prepare("SELECT * FROM proof_upload_tokens WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .first()) as UploadTokenRow | null;
}

export async function markProofUploadTokenUsed(db: D1Database, tokenHash: string): Promise<void> {
  await db
    .prepare("UPDATE proof_upload_tokens SET used_at = ? WHERE token_hash = ?")
    .bind(new Date().toISOString(), tokenHash)
    .run();
}
