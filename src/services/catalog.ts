/**
 * Catalog service (Phase 3.x harden).
 * Read-only shop/product/policy/payment/recommendation access.
 */
export {
  getPayment,
  getPolicies,
  getProduct,
  getRecommendations,
  getShop,
  listProducts,
  listShops,
} from "../db/repositories/catalog";
