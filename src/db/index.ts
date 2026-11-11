// D1 data access for agent-friendly-platform.
// Phase 2.2: god module split into repositories by aggregate.
// Callers keep `import * as db from "./db"` — public signatures unchanged.

export {
  createAdminSession,
  deleteAdminSession,
  getSessionShop,
  setAdminKey,
  updatePaymentMethods,
  updatePolicies,
  updateProduct,
  verifyAdminKey,
} from "./repositories/admin";

export {
  getPayment,
  getPolicies,
  getProduct,
  getRecommendations,
  getShop,
  listProducts,
  listShops,
} from "./repositories/catalog";

export {
  autoCompleteShipped,
  cancelOrder,
  confirmReceipt,
  createOrder,
  expireUnpaidOrders,
  getOrder,
  listOrderEvents,
  listOrders,
  markShipped,
  type OrderTotals,
  orderCounts,
  totals,
  transitionOrder,
  updateBuyerInfo,
} from "./repositories/orders";

export {
  addImagePaymentProof,
  addPaymentProof,
  confirmPayment,
  consumeProofUploadToken,
  createProofUploadToken,
  proofUploadUrl,
  verifyProofUploadToken,
} from "./repositories/proofs";
export {
  AUTO_COMPLETE_AFTER_DAYS,
  DomainError,
  DomainRpcError,
  FREE_SHIPPING_OVER,
  ORDER_STATUSES,
  type Order,
  type OrderEvent,
  type OrderItemInput,
  type OrderLineItem,
  type OrderStatus,
  type PaymentProof,
  PROOF_UPLOAD_TTL_DAYS,
  type Product,
  SHIPPING_FLAT,
  type Shop,
  type ShopPolicies,
  sha256Hex,
  toHttpError,
  toMcpError,
  UNPAID_EXPIRY_MINUTES,
} from "./shared";
