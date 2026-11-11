/**
 * Drizzle schema for agent-friendly-orders D1.
 * Exact mapping of the live schema after migrations 0001–0005 (13 tables).
 * The refactor plan said “14 tables”; production sqlite_master has 13 —
 * this file matches production, not the plan typo.
 */
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const shops = sqliteTable("shops", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  nameZh: text("name_zh"),
  category: text("category"),
  description: text("description"),
  city: text("city"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  address: text("address"),
  pickup: text("pickup"),
  currency: text("currency").notNull().default("CNY"),
});

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    shop: text("shop")
      .notNull()
      .references(() => shops.slug),
    name: text("name").notNull(),
    nameZh: text("name_zh"),
    price: real("price").notNull(),
    currency: text("currency").notNull().default("CNY"),
    stock: integer("stock").notNull().default(0),
    description: text("description"),
    url: text("url"),
    imageUrl: text("image_url"),
    imageCredit: text("image_credit"),
  },
  (t) => [index("idx_products_shop").on(t.shop)],
);

export const shopPolicies = sqliteTable("shop_policies", {
  shop: text("shop")
    .primaryKey()
    .references(() => shops.slug),
  shippingFlatCny: real("shipping_flat_cny").notNull(),
  freeOverCny: real("free_over_cny").notNull(),
  leadTime: text("lead_time").notNull(),
  returnsWindowDays: integer("returns_window_days").notNull(),
  returnsCondition: text("returns_condition"),
  returnShipping: text("return_shipping"),
  privacy: text("privacy"),
  orderStatuses: text("order_statuses").notNull(),
});

export const paymentMethods = sqliteTable(
  "payment_methods",
  {
    shop: text("shop")
      .notNull()
      .references(() => shops.slug),
    methodId: text("method_id").notNull(),
    label: text("label").notNull(),
    instructions: text("instructions").notNull(),
  },
  (t) => [primaryKey({ columns: [t.shop, t.methodId] })],
);

export const shopPayment = sqliteTable("shop_payment", {
  shop: text("shop")
    .primaryKey()
    .references(() => shops.slug),
  summary: text("summary").notNull(),
  flowJson: text("flow_json").notNull(),
  neverInChatJson: text("never_in_chat_json").notNull().default("[]"),
});

export const recommendations = sqliteTable(
  "recommendations",
  {
    shop: text("shop")
      .notNull()
      .references(() => shops.slug),
    productId: text("product_id").notNull(),
    bestFor: text("best_for"),
    why: text("why"),
    alternativeIfOut: text("alternative_if_out"),
    rank: integer("rank").notNull(),
  },
  (t) => [primaryKey({ columns: [t.shop, t.productId] })],
);

export const shopBundles = sqliteTable(
  "shop_bundles",
  {
    shop: text("shop")
      .notNull()
      .references(() => shops.slug),
    name: text("name").notNull(),
    itemsJson: text("items_json").notNull(),
    totalCny: real("total_cny").notNull(),
    note: text("note"),
  },
  (t) => [primaryKey({ columns: [t.shop, t.name] })],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    shop: text("shop").notNull(),
    itemsJson: text("items_json").notNull(),
    subtotalCny: real("subtotal_cny").notNull(),
    shippingCny: real("shipping_cny").notNull(),
    totalCny: real("total_cny").notNull(),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").unique(),
    buyerNote: text("buyer_note"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    // 0003 seller verification
    verifiedAmountCny: real("verified_amount_cny"),
    verifiedAt: text("verified_at"),
    verificationNote: text("verification_note"),
    // 0004 order tracking
    buyerName: text("buyer_name"),
    buyerContact: text("buyer_contact"),
    shippingAddress: text("shipping_address"),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    shippedAt: text("shipped_at"),
    completedAt: text("completed_at"),
    cancelledAt: text("cancelled_at"),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    index("idx_orders_shop").on(t.shop),
    index("idx_orders_status").on(t.shop, t.status, t.createdAt),
  ],
);

export const paymentProofs = sqliteTable(
  "payment_proofs",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    paymentMethod: text("payment_method").notNull(),
    transactionId: text("transaction_id"),
    amountCny: real("amount_cny"),
    proofType: text("proof_type").notNull().default("transaction"),
    r2Key: text("r2_key"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    fileSize: integer("file_size"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_proofs_order").on(t.orderId)],
);

export const orderEvents = sqliteTable(
  "order_events",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    event: text("event").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    actor: text("actor").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_events_order").on(t.orderId, t.createdAt)],
);

export const shopAdminKeys = sqliteTable("shop_admin_keys", {
  shop: text("shop")
    .primaryKey()
    .references(() => shops.slug),
  keyHash: text("key_hash").notNull(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
});

export const adminSessions = sqliteTable("admin_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  shop: text("shop")
    .notNull()
    .references(() => shops.slug),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const proofUploadTokens = sqliteTable(
  "proof_upload_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    shop: text("shop").notNull(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
  },
  (t) => [index("idx_upload_tokens_order").on(t.orderId)],
);

/** All application tables (13) — used by drizzle-kit and reviews. */
export const schemaTables = {
  shops,
  products,
  shopPolicies,
  paymentMethods,
  shopPayment,
  recommendations,
  shopBundles,
  orders,
  paymentProofs,
  orderEvents,
  shopAdminKeys,
  adminSessions,
  proofUploadTokens,
} as const;
