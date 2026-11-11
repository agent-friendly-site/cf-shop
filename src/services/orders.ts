/**
 * Order service (Phase 3.1 / 3.3).
 * Orchestrates order reads/writes; status rules live in domain/order.ts,
 * totals in domain/money.ts. Callers may still use `import * as db`
 * until Phase 4.
 */
export {
  cancelOrder,
  confirmReceipt,
  createOrder,
  getOrder,
  listOrderEvents,
  listOrders,
  markShipped,
  orderCounts,
  transitionOrder,
  updateBuyerInfo,
} from "../db/repositories/orders";
export { type OrderTotals, totals } from "../domain/money";
