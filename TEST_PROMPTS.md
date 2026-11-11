# Test prompts — order tracking + seller admin (v1.7.0)

Consumer-voice prompts for the new order lifecycle. Each prompt is
self-contained: paste it to a fresh agent with only the shop URL.
"Expected" lines are grading notes for Hall, not part of the prompt.

Shop URLs (canonical host):
- terra-pots: https://agent-friendly-platform.refined-x.workers.dev/shops/terra-pots/
- bean-bloom: https://agent-friendly-platform.refined-x.workers.dev/shops/bean-bloom/
- paper-lantern: https://agent-friendly-platform.refined-x.workers.dev/shops/paper-lantern/

## 19. 下单后不用我操心，订单有进展就告诉我

> 帮我去陶土这家店逛逛，我平时喝水喝茶想买个杯子，预算 300 块以内。
> 你推荐好、我确认下单之后，把卖家的收款方式发我，我付完钱把交易单号给你，
> 然后你再帮我盯着这个订单，状态变了就告诉我一声。

Expected: agent recommends (mug first choice), confirms, asks for
name/contact/address, creates the order, then immediately sends the
seller's configured payment methods with the receiving accounts
(bank transfer / WeChat Pay / Alipay, from payment.json) and asks the
buyer to pick one — it must NOT create the tracking task yet. After
the buyer sends the transaction id and the agent submits the proof
(order becomes payment_submitted), the agent starts tracking (checks
every 6 hours, notifies on change, stops at completed/cancelled) —
without the buyer having to remember the order id. No invented
tracking page or push notification.

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
possible before payment (refunds are not supported in v1). After a
successful cancel, the agent must also cancel/delete the tracking
task for that order (if one was created) and tell the buyer tracking
has stopped — it must not keep polling a cancelled order.

## 23. 下单、付款、交凭据一气呵成，再帮我盯着

> 帮我去陶土这家店买个马克杯，预算 300 以内。下单后你把收款方式发我，
> 我付完钱就把交易单号给你，你交完凭据再帮我盯着订单，有进展就告诉我。

Expected: agent recommends/confirms/creates the order, sends the
payment methods with the receiving accounts, and does NOT create a
tracking task yet. Once the buyer replies with a transaction id, the
agent submits the proof (order becomes payment_submitted) and only
then creates the tracking task (6-hour checks, notify on change,
stop at completed/cancelled, delete the task at the end). If the
buyer instead says they don't want it before paying, the agent
cancels the order and must not leave a tracking task behind.

## 24. 下单时忘了给地址，之后再补

> 帮我去陶土这家店买个马克杯，预算 300 以内。下单确认时我没给收货信息，
> 下单成功后我再告诉你：收货人 测试买家，联系方式 test@example.com，
> 地址 测试省测试市测试路 1 号。

Expected: agent does NOT ask the buyer to place a new order; it calls
update_buyer_info with the info given after the order was created, then
confirms with get_order that buyer_name / buyer_contact /
shipping_address are filled in and the timeline has a buyer_info_updated
event. (v1.4.0 fix for the blind-test finding: an order created without
buyer info could not be patched afterwards.)

## 25. 直接下单，也要先问收货信息

> 帮我去陶土这家店买个马克杯，预算 300 以内，直接下单，别问那么多。

Expected: even when the buyer says "just order it", the agent MUST ask
for name / contact / shipping address BEFORE calling create_order — it
must not create the order first and ask afterwards. shipping_address
is REQUIRED: create_order rejects the call without it, so the agent
cannot create the order at all until the buyer gives an address. If
the buyer refuses to give an address, the agent explains the order
cannot be created without one and does not place the order.
(v1.5.0 tool-level requirement.)

## 26. 发付款截图，不用把单号打出来

> 帮我去陶土这家店买个马克杯，预算 300 以内。我付完款直接发你付款截图，不想一个个字打交易单号。

Expected: the agent must NOT ask the buyer to type out the transaction
id, and must NOT try to read it out of the screenshot itself. After
create_order it sends the payment methods AND the proof-upload link
(proof_upload.url from the create_order result, or
get_payment_proof_upload_link for a fresh one). The buyer opens the
link in a browser and uploads the screenshot; the image goes straight
to the platform and the order becomes payment_submitted without the
agent ever reading the image. Tracking starts only after
payment_submitted. (v1.6.0 upload link.)

## 27. 下了单，先不付，等一会儿再说

> 帮我去陶土这家店买个马克杯，预算 300 以内。先下单，我等会儿再付。

Expected: the agent creates the order AND tells the buyer the
15-minute payment deadline up front — the order auto-cancels if no
payment proof is submitted within 15 minutes of creation. The agent
must not promise the order will wait. If the buyer comes back after
the deadline, get_order shows cancelled with an auto_cancelled event
and the agent offers to place a new order. (v1.7.0 auto-cancel.)

## Seller admin checklist (manual — the admin is a web UI, not an agent flow)

Hall (or a shop owner) opens the admin with the shop's key:

1. https://agent-friendly-platform.refined-x.workers.dev/shops/terra-pots/admin/
   Log in with the terra-pots admin key. Without a key, the orders API
   must return 401.
2. Dashboard shows counts by status; the order list filters by status.
3. Open a payment_submitted order: proofs and timeline are visible;
   confirm-payment shows the proof amount next to the order total and
   blocks on a mismatch (try 100 against a 140 order).
4. Image proofs (v1.6.0): open a payment_submitted order with an image
   proof — the screenshot is visible in the order detail. If the buyer
   left the amount blank, the page says to read the amount off the
   screenshot; confirm with the amount read from the image → paid.
5. Confirm with the exact total → paid. Mark shipped with a carrier
   and tracking number → shipped.
6. Products: change a price or stock, save, then check the shop's
   api/products.json shows the new value; restore it afterwards.
7. Policies: change the flat shipping fee, save, check policies.json.
