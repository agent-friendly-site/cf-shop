import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toMcpError } from "../../domain/errors";
import type { Env } from "../../env";
import * as orders from "../../services/orders";
import * as payments from "../../services/payments";
import { mcpText } from "../shared";

export function registerPaymentTools(server: McpServer, env: Env, shop: string) {
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
      try {
        if (!transaction_id) throw new Error("transaction_id is required");
        const order = await payments.addPaymentProof(env.DB, {
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
      } catch (e) {
        return toMcpError(e);
      }
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
      try {
        const order = await orders.getOrder(env.DB, order_id);
        if (!order) throw new Error(`unknown order_id: ${order_id}`);
        if (order.shop !== shop)
          throw new Error(`order ${order_id} does not belong to shop ${shop}`);
        const link = await payments.createProofUploadToken(env.DB, { shop, orderId: order_id });
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
      } catch (e) {
        return toMcpError(e);
      }
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
        const order = await payments.confirmPayment(env.DB, {
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
}
