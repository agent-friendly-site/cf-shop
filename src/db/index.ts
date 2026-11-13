// Compatibility facade for agent-friendly-platform.
// Phase 4: access layer uses services/* directly. This facade remains for
// tests/scripts that still `import * as db`. Prefer services/* for new code.

export {
  AUTO_COMPLETE_AFTER_DAYS,
  FREE_SHIPPING_OVER,
  ORDER_STATUSES,
  type OrderStatus,
  PROOF_UPLOAD_TTL_DAYS,
  SHIPPING_FLAT,
  UNPAID_EXPIRY_MINUTES,
} from "../domain/constants";
export { DomainError, DomainRpcError, toHttpError, toMcpError } from "../domain/errors";
export {
  createAdminSession,
  deleteAdminSession,
  getSessionShop,
  setAdminKey,
  updatePaymentMethods,
  updatePolicies,
  updateProduct,
  verifyAdminKey,
} from "../services/admin";
export {
  getPayment,
  getPolicies,
  getProduct,
  getRecommendations,
  getShop,
  listProducts,
  listShops,
} from "../services/catalog";
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
} from "../services/orders";
export {
  addImagePaymentProof,
  addPaymentProof,
  confirmPayment,
  consumeProofUploadToken,
  createProofUploadToken,
  proofUploadUrl,
  verifyProofUploadToken,
} from "../services/payments";

export { sha256Hex } from "./helpers";

export type {
  Order,
  OrderEvent,
  OrderItemInput,
  OrderLineItem,
  PaymentProof,
  Product,
  Shop,
  ShopPolicies,
} from "./types";
