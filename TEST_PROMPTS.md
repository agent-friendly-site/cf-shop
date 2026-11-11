# Test prompts — order tracking + seller admin (v1.2.0)

Consumer-voice prompts for the new order lifecycle. Each prompt is
self-contained: paste it to a fresh agent with only the shop URL.
"Expected" lines are grading notes for Hall, not part of the prompt.

Shop URLs (canonical host):
- terra-pots: https://agent-friendly-platform.refined-x.workers.dev/shops/terra-pots/
- bean-bloom: https://agent-friendly-platform.refined-x.workers.dev/shops/bean-bloom/
- paper-lantern: https://agent-friendly-platform.refined-x.workers.dev/shops/paper-lantern/

## 19. 下单后不用我操心，订单有进展就告诉我

> 帮我去陶土这家店逛逛，我平时喝水喝茶想买个杯子，预算 300 块以内。
> 你推荐好、我确认下单之后，不用我再来问，你帮我盯着这个订单，
> 状态变了就告诉我一声。

Expected: agent recommends (mug first choice), confirms, asks for
name/contact/address, creates the order, then says it will track the
order automatically (checks every 6 hours, notifies on change, stops
at completed/cancelled) — without the buyer having to remember the
order id. No invented tracking page or push notification.

## 20. 我的订单到哪了

> 我前几天在陶土店下了一单，订单号是 ord_mwbrdvelxsaq，现在到哪一步了？
> 卖家发货了吗？

Expected: agent calls get_order, reports the real status (completed,
with the full timeline: created → proof submitted → payment confirmed
→ shipped via 顺丰 SF1234567890 → receipt confirmed) and does not
invent a tracking page or delivery date.

## 21. 我收到货了，帮我确认一下

> 我在陶土店买的杯子收到了，订单号 ord_mwbrdvelxsaq，帮我确认收货，
> 再告诉我这个订单是不是就完成了。

Expected: agent calls confirm_receipt (already completed in the test
data — it should say so honestly, or confirm it if still shipped);
never claims a refund or a review flow that does not exist.

## 22. 我不想要了，取消订单

> 我刚在晨光咖啡下了一单，还没付款，现在不想要了，能帮我取消吗？
> 订单号是 ord_mwbre1pm2hp0。

Expected: agent reports the order is already cancelled (test data) or
calls cancel_order for a pending_payment / payment_submitted order;
for a paid order it must refuse and explain cancellation is only
possible before payment (refunds are not supported in v1).

## Seller admin checklist (manual — the admin is a web UI, not an agent flow)

Hall (or a shop owner) opens the admin with the shop's key:

1. https://agent-friendly-platform.refined-x.workers.dev/shops/terra-pots/admin/
   Log in with the terra-pots admin key. Without a key, the orders API
   must return 401.
2. Dashboard shows counts by status; the order list filters by status.
3. Open a payment_submitted order: proofs and timeline are visible;
   confirm-payment shows the proof amount next to the order total and
   blocks on a mismatch (try 100 against a 140 order).
4. Confirm with the exact total → paid. Mark shipped with a carrier
   and tracking number → shipped.
5. Products: change a price or stock, save, then check the shop's
   api/products.json shows the new value; restore it afterwards.
6. Policies: change the flat shipping fee, save, check policies.json.
