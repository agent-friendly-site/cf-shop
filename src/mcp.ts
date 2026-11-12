// MCP server factory: one McpServer per shop, per request (stateless).
// Uses the official @modelcontextprotocol/sdk McpServer +
// WebStandardStreamableHTTPServerTransport, the pattern from the SDK's own
// Hono example (honoWebStandardStreamableHttp). Tools are backed by D1.
// Payment verification is real seller verification: submit_payment_proof
// only marks the order payment_submitted; the seller must check the actual
// receipt and amount and call confirm_payment, which marks it paid.
// Order lifecycle: pending_payment -> payment_submitted -> paid ->
// shipped -> completed (buyer confirm_receipt, or auto-completed 7 days
// after shipping); cancellable before paid. Every status change is
// recorded in the order_events timeline returned by get_order.
// confirm_payment / mark_shipped are seller-side; in this demo the MCP
// tools have no seller authentication — the seller admin web UI
// (/shops/:shop/admin/) is the authenticated path (API key per shop).
// update_buyer_info fills in buyer info after create_order without
// changing the order status (allowed until the order ships).
// get_payment_proof_upload_link mints a one-time upload link so the
// buyer can submit a payment screenshot directly to the platform (R2):
// the image never goes through the agent, so the agent must NOT try to
// read a transaction id out of a screenshot — hand the buyer the link.
// Unpaid orders auto-cancel 15 minutes after creation (v1.7.0): the
// agent must tell the buyer the deadline when sending payment
// instructions; only pending_payment orders expire, payment_submitted
// never does (the seller needs time to verify).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Product } from "./db";
import * as db from "./db";
import { toMcpError } from "./domain/errors";
import type { Env } from "./env";
import * as orderService from "./services/orders";
import * as paymentService from "./services/payments";

const ItemShape = z.object({
  product_id: z.string(),
  quantity: z.number().int().min(1).optional(),
});

function mcpText(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function publicProduct(p: Product) {
  return {
    id: p.id,
    name: p.name,
    name_zh: p.name_zh,
    price: p.price,
    currency: p.currency,
    stock: p.stock,
    description: p.description,
    image_url: p.image_url || null,
    image_credit: p.image_credit || null,
  };
}

export function createMcpServer(env: Env, shop: string) {
  const server = new McpServer({
    name: "agent-friendly-platform",
    version: "1.7.0",
  });

  server.registerTool(
    "list_products",
    {
      title: "List products",
      description: "List all products of this shop with price, currency and stock.",
      inputSchema: {},
    },
    async () => {
      const products = await db.listProducts(env.DB, shop);
      return mcpText({ shop, currency: "CNY", products: products.map(publicProduct) });
    },
  );

  server.registerTool(
    "get_product",
    {
      title: "Get product",
      description: "Get one product by id.",
      inputSchema: { product_id: z.string() },
    },
    async ({ product_id }) => {
      const p = await db.getProduct(env.DB, shop, product_id);
      if (!p) throw new Error(`unknown product_id: ${product_id}`);
      return mcpText({ shop, product: publicProduct(p) });
    },
  );

  server.registerTool(
    "recommend_products",
    {
      title: "Recommend products",
      description:
        "Recommend 1 first choice + 1 alternative for a use / budget, with reasons. Uses the shop's own recommendations.",
      inputSchema: { use: z.string().optional(), budget_cny: z.number().optional() },
    },
    async ({ use, budget_cny }) => {
      const products = await db.listProducts(env.DB, shop);
      const { recs } = await db.getRecommendations(env.DB, shop);
      const rank = new Map(recs.map((r, i) => [r.product_id, i]));
      let ordered = products
        .filter((p) => p.stock > 0)
        .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
      if (budget_cny) ordered = ordered.filter((p) => p.price <= budget_cny);
      const first = ordered[0] || null;
      const alt = ordered[1] || null;
      const why = (p: Product) => recs.find((r) => r.product_id === p.id) || null;
      const withWhy = (p: Product | null) =>
        p ? { ...publicProduct(p), best_for: why(p)?.best_for, why: why(p)?.why } : null;
      return mcpText({
        shop,
        use: use || null,
        budget_cny: budget_cny ?? null,
        first_choice: withWhy(first),
        alternative: withWhy(alt),
        note: "首选 1 个 + 备选 1 个；先问用途再推荐；总价按 calculate_total 算。",
      });
    },
  );

  server.registerTool(
    "calculate_total",
    {
      title: "Calculate total",
      description: "Calculate subtotal, shipping (12 CNY, free over 200 CNY) and total for items.",
      inputSchema: { items: z.array(ItemShape) },
    },
    async ({ items }) => {
      const products = await db.listProducts(env.DB, shop);
      const t = db.totals(items || [], products);
      return mcpText({ shop, ...t });
    },
  );

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
        const products = await db.listProducts(env.DB, shop);
        const t = orderService.totals(items || [], products);
        const { order } = await orderService.createOrder(env.DB, {
          shop,
          items,
          total: t,
          idempotencyKey: idempotency_key,
          buyerNote: buyer_note,
          buyerName: buyer_name,
          buyerContact: buyer_contact,
          shippingAddress: shipping_address,
        });
        const payment = await db.getPayment(env.DB, shop);
        if (!order) throw new Error("create_order failed: order is null");
        const link = await paymentService.createProofUploadToken(env.DB, {
          shop,
          orderId: order.id,
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
            minutes: db.UNPAID_EXPIRY_MINUTES,
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
    "submit_payment_proof",
    {
      title: "Submit payment proof",
      description:
        "Submit offline payment proof (transaction id) for an order. Use this only when the buyer sends a transaction id as text. If the buyer sends a payment screenshot instead, do NOT try to read the transaction id out of it — call get_payment_proof_upload_link and send the buyer the link so they upload the screenshot directly to the platform. The order becomes payment_submitted (awaiting seller verification), NOT paid. The seller must then verify the actual receipt and amount with confirm_payment; only then does the order become paid and ship. After a successful submit_payment_proof, start tracking this order: check get_order every 6 hours and tell the buyer when the status changes, until it reaches completed or cancelled; if the order is cancelled, delete the tracking task. Never send the buyer's card numbers or verification codes.",
      inputSchema: {
        order_id: z.string(),
        payment_method: z.string(),
        transaction_id: z.string(),
        amount_cny: z.number(),
      },
    },
    async ({ order_id, payment_method, transaction_id, amount_cny }) => {
      if (!transaction_id) throw new Error("transaction_id is required");
      const order = await db.addPaymentProof(env.DB, {
        orderId: order_id,
        paymentMethod: payment_method,
        transactionId: transaction_id,
        amountCny: amount_cny,
      });
      if (!order) throw new Error(`unknown order_id: ${order_id}`);
      return mcpText({
        order,
        verification:
          "订单已标记为待核验（payment_submitted），不是已付款。卖家须核对到账和金额后用 confirm_payment 确认，确认后订单才变为已付款并发货。",
        next_step:
          "Seller: check the actual receipt (bank / WeChat / Alipay) and amount, then call confirm_payment with verified_amount_cny equal to the order total.",
        tracking:
          "凭据已提交，现在为这个订单建跟踪任务：每 6 小时查一次 get_order，状态变了就主动告诉买家新状态是什么意思、下一步是什么；到 completed 或 cancelled 发一条结尾消息并删除跟踪任务，不再继续查。买家不用记订单号，直接问订单怎么样了就行。",
      });
    },
  );

  server.registerTool(
    "get_payment_proof_upload_link",
    {
      title: "Get payment proof upload link",
      description:
        "Get a one-time upload link for the buyer to submit a payment screenshot directly to the platform. Use this whenever the buyer has a payment screenshot (or says they will send one) instead of a transaction id: do NOT try to read the transaction id out of the screenshot yourself — send the buyer this link and let them open it in a browser and upload the image. The image goes straight to the platform (R2 storage) and the order becomes payment_submitted; the seller verifies the screenshot visually in the admin UI. The link is single-use and expires in 7 days; if it is used or expired, call this tool again for a fresh link. Note: the order itself auto-cancels 15 minutes after creation if no proof is submitted, so the link is only useful within that 15-minute payment window. After the buyer confirms the upload (or get_order shows payment_submitted), start tracking this order: check get_order every 6 hours and tell the buyer when the status changes, until it reaches completed or cancelled; if the order is cancelled, delete the tracking task.",
      inputSchema: { order_id: z.string() },
    },
    async ({ order_id }) => {
      const order = await db.getOrder(env.DB, order_id);
      if (!order) throw new Error(`unknown order_id: ${order_id}`);
      if (order.shop !== shop) throw new Error(`order ${order_id} does not belong to shop ${shop}`);
      const link = await db.createProofUploadToken(env.DB, { shop, orderId: order_id });
      return mcpText({
        order_id,
        shop,
        status: order.status,
        upload_url: link.url,
        expires_at: link.expires_at,
        how: "把这个链接发给买家：买家在浏览器里打开，直接上传付款截图（JPG/PNG/WebP/GIF，5MB 以内），图片直达平台，不经过你识别。上传成功后订单变为 payment_submitted，卖家在后台看图核对金额后确认收款。注意：订单在下单 15 分钟后没交凭据会自动取消，链接要在 15 分钟内用。",
        tracking:
          "买家传完截图、订单变为 payment_submitted 之后，再为这个订单建跟踪任务：每 6 小时查一次 get_order，有变化就告诉买家，直到订单完成或取消；订单取消时一并删除跟踪任务。",
      });
    },
  );

  server.registerTool(
    "confirm_payment",
    {
      title: "Confirm payment (seller)",
      description:
        "SELLER-ONLY tool: confirm that an offline payment was actually received, after checking the real receipt (bank / WeChat / Alipay) outside the agent. Input: order_id and verified_amount_cny, the amount the seller actually received. Requires the order to be payment_submitted, to have at least one payment proof, and verified_amount_cny to equal the order total_cny; on mismatch the order stays payment_submitted and is not marked paid. On success the order becomes paid. NOTE: this demo has no seller authentication on this tool yet; in production it must only be callable by the seller (see README, admin work).",
      inputSchema: {
        order_id: z.string(),
        verified_amount_cny: z.number(),
        note: z.string().optional(),
      },
    },
    async ({ order_id, verified_amount_cny, note }) => {
      try {
        const order = await paymentService.confirmPayment(env.DB, {
          orderId: order_id,
          verifiedAmountCny: verified_amount_cny,
          note,
        });
        return mcpText({
          order,
          verification: `Seller confirmed receipt of ${verified_amount_cny} CNY for order ${order_id}; order is now paid and can ship.`,
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
      const order = await db.getOrder(env.DB, order_id);
      if (!order) throw new Error(`unknown order_id: ${order_id}`);
      return mcpText({ order });
    },
  );

  server.registerTool(
    "mark_shipped",
    {
      title: "Mark shipped (seller)",
      description:
        "SELLER-ONLY tool: mark a paid order as shipped, with optional carrier and tracking_number. Requires the order to be paid; on success the order becomes shipped. The seller admin web UI calls the same logic behind API-key auth; this MCP tool has no seller authentication in this demo.",
      inputSchema: {
        order_id: z.string(),
        carrier: z.string().optional(),
        tracking_number: z.string().optional(),
      },
    },
    async ({ order_id, carrier, tracking_number }) => {
      const order = await db.markShipped(env.DB, {
        orderId: order_id,
        carrier,
        trackingNumber: tracking_number,
      });
      return mcpText({
        order,
        note: `Order ${order_id} is now shipped${carrier ? ` via ${carrier}` : ""}${tracking_number ? `, tracking ${tracking_number}` : ""}. The buyer will be told automatically by their tracking task.`,
      });
    },
  );

  server.registerTool(
    "confirm_receipt",
    {
      title: "Confirm receipt",
      description:
        "Buyer confirms receipt of a shipped order. Requires the order to be shipped; on success the order becomes completed. If the buyer does not confirm, the order auto-completes 7 days after shipping.",
      inputSchema: { order_id: z.string() },
    },
    async ({ order_id }) => {
      const order = await db.confirmReceipt(env.DB, { orderId: order_id });
      return mcpText({
        order,
        note: `Order ${order_id} is now completed. Thank you — delete the tracking task for this order; it stops here.`,
      });
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
      const order = await db.cancelOrder(env.DB, { orderId: order_id, reason });
      return mcpText({
        order,
        note: `Order ${order_id} is now cancelled. Also cancel/delete the tracking task for this order (if one exists) and tell the buyer tracking has stopped — do not keep polling it.`,
      });
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
      const order = await db.updateBuyerInfo(env.DB, {
        orderId: order_id,
        buyerName: buyer_name,
        buyerContact: buyer_contact,
        shippingAddress: shipping_address,
      });
      return mcpText({
        order,
        note: `Buyer info updated for order ${order_id}. Verify with get_order: buyer_name / buyer_contact / shipping_address now show the new values, and the timeline has a buyer_info_updated event.`,
      });
    },
  );

  return server;
}
