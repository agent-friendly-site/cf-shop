/**
 * Order service (Phase 3.1).
 * Orchestrates order reads/writes; status rules live in domain/order.ts.
 * Callers may still use `import * as db from "./db"` until Phase 4.
 */
export {
  cancelOrder,
  confirmReceipt,
  createOrder,
  getOrder,
  listOrderEvents,
  listOrders,
  markShipped,
  type OrderTotals,
  orderCounts,
  totals,
  transitionOrder,
  updateBuyerInfo,
} from "../db/repositories/orders";
