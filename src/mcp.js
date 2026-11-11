// MCP server factory: one McpServer per shop, per request (stateless).
// Uses the official @modelcontextprotocol/sdk McpServer +
// WebStandardStreamableHTTPServerTransport, the pattern from the SDK's own
// Hono example (honoWebStandardStreamableHttp). Tools are backed by D1.
// Payment verification is real seller verification: submit_payment_proof
// only marks the order payment_submitted; the seller must check the actual
// receipt and amount and call confirm_payment, which marks it paid.
// NOTE: confirm_payment currently has no seller authentication in this
// demo; seller auth comes with the admin work (see README).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as db from "./db.js";

const ItemShape = z.object({
  product_id: z.string(),
  quantity: z.number().int().min(1).optional(),
});

function text(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function publicProduct(p) {
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

export function createMcpServer(env, shop) {
  const server = new McpServer({
    name: "agent-friendly-platform",
    version: "1.1.0",
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
      return text({ shop, currency: "CNY", products: products.map(publicProduct) });
    }
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
      return text({ shop, product: publicProduct(p) });
    }
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
      const why = (p) => recs.find((r) => r.product_id === p.id) || null;
      const withWhy = (p) =>
        p ? { ...publicProduct(p), best_for: why(p)?.best_for, why: why(p)?.why } : null;
      return text({
        shop,
        use: use || null,
        budget_cny: budget_cny ?? null,
        first_choice: withWhy(first),
        alternative: withWhy(alt),
        note: "首选 1 个 + 备选 1 个；先问用途再推荐；总价按 calculate_total 算。",
      });
    }
  );

  server.registerTool(
    "calculate_total",
    {
      title: "Calculate total",
      description:
        "Calculate subtotal, shipping (12 CNY, free over 200 CNY) and total for items.",
      inputSchema: { items: z.array(ItemShape) },
    },
    async ({ items }) => {
      const products = await db.listProducts(env.DB, shop);
      const t = db.totals(items || [], products);
      return text({ shop, ...t });
    }
  );

  server.registerTool(
    "create_order",
    {
      title: "Create order",
      description:
        "Create an order. Requires idempotency_key. Order starts as pending_payment; payment is offline, instructions are returned with the order.",
      inputSchema: {
        items: z.array(ItemShape),
        idempotency_key: z.string(),
        buyer_note: z.string().optional(),
      },
    },
    async ({ items, idempotency_key, buyer_note }) => {
      const products = await db.listProducts(env.DB, shop);
      const t = db.totals(items || [], products);
      const { order } = await db.createOrder(env.DB, {
        shop,
        items,
        total: t,
        idempotencyKey: idempotency_key,
        buyerNote: buyer_note,
      });
      const payment = await db.getPayment(env.DB, shop);
      return text({
        order,
        payment: payment?.payment || {
          method: "offline",
          summary: "线下支付：确认订单后卖家提供收款方式，买家在 Agent 外付款，付款后提交付款凭据，卖家核验到账后发货。",
        },
        total_verbatim: t.verbatim,
        next_step: "买家按卖家给的线下收款方式付款，然后用 submit_payment_proof 提交交易单号。",
      });
    }
  );

  server.registerTool(
    "submit_payment_proof",
    {
      title: "Submit payment proof",
      description:
        "Submit offline payment proof (transaction id) for an order. The order becomes payment_submitted (awaiting seller verification), NOT paid. The seller must then verify the actual receipt and amount with confirm_payment; only then does the order become paid and ship. Never send card numbers or verification codes.",
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
      return text({
        order,
        verification:
          "订单已标记为待核验（payment_submitted），不是已付款。卖家须核对到账和金额后用 confirm_payment 确认，确认后订单才变为已付款并发货。",
        next_step: "Seller: check the actual receipt (bank / WeChat / Alipay) and amount, then call confirm_payment with verified_amount_cny equal to the order total.",
      });
    }
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
      const order = await db.confirmPayment(env.DB, {
        orderId: order_id,
        verifiedAmountCny: verified_amount_cny,
        note,
      });
      return text({
        order,
        verification: `Seller confirmed receipt of ${verified_amount_cny} CNY for order ${order_id}; order is now paid and can ship.`,
      });
    }
  );

  server.registerTool(
    "get_order",
    {
      title: "Get order",
      description:
        "Get an order by id, including payment and shipping status and any payment proofs.",
      inputSchema: { order_id: z.string() },
    },
    async ({ order_id }) => {
      const order = await db.getOrder(env.DB, order_id);
      if (!order) throw new Error(`unknown order_id: ${order_id}`);
      return text({ order });
    }
  );

  return server;
}
