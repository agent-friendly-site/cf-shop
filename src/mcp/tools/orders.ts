import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UNPAID_EXPIRY_MINUTES } from "../../domain/constants";
import { DomainRpcError, toMcpError } from "../../domain/errors";
import type { Env } from "../../env";
import * as catalog from "../../services/catalog";
import * as orders from "../../services/orders";
import * as payments from "../../services/payments";
import { ItemShape, mcpText } from "../shared";

export function registerOrderTools(
  server: McpServer,
  env: Env,
  shop: string,
  publicOrigin: string,
) {
  server.registerTool(
    "create_order",
    {
      title: "Create order",
      description:
        "Create an order. Requires idempotency_key. Order starts as pending_payment; payment is offline, instructions are returned with the order. shipping_address is REQUIRED: create_order rejects the call when it is missing or empty — the seller cannot ship without an address, so there is no way to create an order without one. Before calling create_order, ask the buyer for name, contact and shipping address at the confirmation step and pass them as buyer_name / buyer_contact (optional) and shipping_address (required). Ask first, create the order only after you have the address. Do NOT create the order first and ask afterwards. If the buyer refuses to give an address, explain the order cannot be created without one; a missing or wrong address can be fixed later with update_buyer_info (allowed until the order ships). After a successful create_order, send the buyer the payment instructions returned with the order (payment method + the seller's configured receiving account, verbatim) and the proof-upload link returned with the order, and wait for the buyer to pay offline and submit proof. The order auto-cancels if no payment proof is submitted within 15 minutes of creation — tell the buyer this 15-minute deadline when you send the payment instructions. Proof has two paths: (a) the buyer sends a transaction id in chat — submit it with submit_payment_proof; (b) the buyer has a payment screenshot — do NOT try to read the transaction id out of it yourself, send the buyer the proof-upload link so they upload the screenshot directly to the platform. Do NOT start tracking this order yet: tracking starts only after a proof is submitted and the order becomes payment_submitted.",
      inputSchema: {
        items: z.array(ItemShape),
        idempotency_key: z.string(),
        buyer_note: z.string().optional(),
        buyer_name: z.string().optional(),
        buyer_contact: z.string().optional(),
        shipping_address: z.string().min(1),
      },
    },
    async ({ items, idempotency_key, buyer_note, buyer_name, buyer_contact, shipping_address }) => {
      try {
        const products = await catalog.listProducts(env.DB, shop);
        const t = orders.totals(items || [], products);
        const { order } = await orders.createOrder(env.DB, {
          shop,
          items,
          total: t,
          idempotencyKey: idempotency_key,
          buyerNote: buyer_note,
          buyerName: buyer_name,
          buyerContact: buyer_contact,
          shippingAddress: shipping_address,
        });
        const payment = await catalog.getPayment(env.DB, shop);
        if (!order) throw new DomainRpcError("create_order failed: order is null", -32000);
        const link = await payments.createProofUploadToken(env.DB, {
          shop,
          orderId: order.id,
          baseUrl: publicOrigin,
        });
        return mcpText({
          order,
          payment: payment?.payment || {
            method: "offline",
            summary:
              "线下支付：确认订单后卖家提供收款方式，买家在 Agent 外付款，付款后提交付款凭据，卖家核验到账后发货。",
          },
          total_verbatim: t.verbatim,
          payment_deadline: {
            minutes: UNPAID_EXPIRY_MINUTES,
            expires_at: order.payment_expires_at,
            note: "请在 15 分钟内付款并提交凭据，超时订单自动取消；交了凭据就不会过期。",
          },
          proof_upload: {
            url: link.url,
            expires_at: link.expires_at,
            how: "把这个链接发给买家：买家在浏览器里打开，直接上传付款截图，图片直达平台，不经过你识别。链接一次有效，7 天内有效；用过或过期后用 get_payment_proof_upload_link 再取一个。",
          },
          next_step:
            "买家按卖家给的线下收款方式付款，然后提交付款凭据：有交易单号就直接发给你，你用 submit_payment_proof 提交；有付款截图就把 proof_upload.url 发给买家，让买家在浏览器里直接上传，图片不经过你识别。",
          tracking:
            "先不要建跟踪任务：等买家提交付款凭据（submit_payment_proof 成功，或买家用上传链接传完截图，订单变为 payment_submitted）之后，再为这个订单建跟踪任务：每 6 小时查一次 get_order，有变化就告诉买家，直到订单完成或取消；订单取消时一并删除跟踪任务。",
        });
      } catch (e) {
        return toMcpError(e);
      }
    },
  );

  server.registerTool(
    "get_order",
    {
      title: "Get order",
      description:
        "Get an order by id, including payment and shipping status, any payment proofs, and the full status timeline (order_events). Use this for the automatic 6-hour order tracking checks.",
      inputSchema: { order_id: z.string() },
    },
    async ({ order_id }) => {
      try {
        const order = await orders.getOrder(env.DB, order_id);
        if (!order) throw new DomainRpcError(`unknown order_id: ${order_id}`, -32602);
        return mcpText({ order });
      } catch (e) {
        return toMcpError(e);
      }
    },
  );

  server.registerTool(
    "update_buyer_info",
    {
      title: "Update buyer info",
      description:
        "Fill in or correct the buyer info (name, contact, shipping address) for an order that was created without it. Use this when the buyer gives their name/contact/address only after the order was created — for example when they provide it together with the payment proof. At least one of buyer_name / buyer_contact / shipping_address is required; only the given fields change, the rest stay as they were. Allowed while the order is pending_payment, payment_submitted or paid; once the order is shipped the address is frozen and the tool errors. The change is recorded in the order timeline (event buyer_info_updated) so the seller can see it. Do not create a new order just to fix buyer info.",
      inputSchema: {
        order_id: z.string(),
        buyer_name: z.string().optional(),
        buyer_contact: z.string().optional(),
        shipping_address: z.string().optional(),
      },
    },
    async ({ order_id, buyer_name, buyer_contact, shipping_address }) => {
      try {
        const order = await orders.updateBuyerInfo(env.DB, {
          orderId: order_id,
          buyerName: buyer_name,
          buyerContact: buyer_contact,
          shippingAddress: shipping_address,
        });
        return mcpText({
          order,
          note: `Buyer info updated for order ${order_id}. Verify with get_order: buyer_name / buyer_contact / shipping_address now show the new values, and the timeline has a buyer_info_updated event.`,
        });
      } catch (e) {
        return toMcpError(e);
      }
    },
  );

  server.registerTool(
    "cancel_order",
    {
      title: "Cancel order",
      description:
        "Cancel an order before it is paid. Only pending_payment and payment_submitted orders can be cancelled; a paid order cannot be cancelled this way (refunds are not supported in v1). After a successful cancel, also cancel/delete the tracking task for this order if one was created, and tell the buyer tracking has stopped.",
      inputSchema: {
        order_id: z.string(),
        reason: z.string().optional(),
      },
    },
    async ({ order_id, reason }) => {
      try {
        const order = await orders.cancelOrder(env.DB, { orderId: order_id, reason });
        return mcpText({
          order,
          note: `Order ${order_id} is now cancelled. Also cancel/delete the tracking task for this order (if one exists) and tell the buyer tracking has stopped — do not keep polling it.`,
        });
      } catch (e) {
        return toMcpError(e);
      }
    },
  );
}
