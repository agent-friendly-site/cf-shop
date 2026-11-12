// Compatibility facade for agent-friendly-platform.
// Phase 4: access layer uses services/* directly. This facade remains for
// tests/scripts that still `import * as db`. Public signatures unchanged.

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
