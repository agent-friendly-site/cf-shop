import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toMcpError } from "../../domain/errors";
import type { Env } from "../../env";
import * as shipping from "../../services/shipping";
import { mcpText } from "../shared";

export function registerShippingTools(server: McpServer, env: Env, _shop: string) {
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
      try {
        const order = await shipping.markShipped(env.DB, {
          orderId: order_id,
          carrier,
          trackingNumber: tracking_number,
        });
        return mcpText({
          order,
          note: `Order ${order_id} is now shipped${carrier ? ` via ${carrier}` : ""}${tracking_number ? `, tracking ${tracking_number}` : ""}. The buyer will be told automatically by their tracking task.`,
        });
      } catch (e) {
        return toMcpError(e);
      }
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
      try {
        const order = await shipping.confirmReceipt(env.DB, { orderId: order_id });
        return mcpText({
          order,
          note: `Order ${order_id} is now completed. Thank you — delete the tracking task for this order; it stops here.`,
        });
      } catch (e) {
        return toMcpError(e);
      }
    },
  );
}
