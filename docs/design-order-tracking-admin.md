# 订单自动跟进 + 卖家后台 设计方案

日期：2026-11-11 · 状态：**已实施（v1.2.0，commit 待填）**，2026-11-11 线上验证通过
对应代码库：`agent-friendly-site/cf-shop`（Worker `agent-friendly-platform`，D1 `agent-friendly-orders`）
当前版本：openapi 1.1.0，8 个 MCP 工具，订单状态只有 `pending_payment / payment_submitted / paid`

## 一、要解决的两个问题

1. **买家跟进体验差**：现在订单到 `paid` 就停了，买家想知道进展只能自己拿着订单号来问 agent 查，没有发货、没有确认收货、没有主动通知。
2. **卖家无法运营**：没有后台、没有订单列表、没有 `list_orders`，改商品价格库存要改代码重新部署；`confirm_payment` 是唯一卖家操作且无鉴权。

## 二、核心约束（先说清楚，再设计）

- **买家没有账号、没有推送通道**。平台不知道买家是谁、也推不动消息。所谓“自动跟踪”只能是：**平台提供便宜可查的状态变化（事件流），买家的 agent 下单后自动建一个跟踪任务去轮询，状态一变就主动告诉买家**。跟踪任务活在买家的 agent 里，不在平台上。
- **订单状态只在卖家动作时变化**（确认收款、标记发货），所以轮询不需要很密，6 小时一次足够。
- **订单号本身就是凭证**：订单号是随机生成的，知道订单号才能查单、确认收货；不要把它当成公开链接到处贴。
- 退款本次不做，状态位先预留。

## 三、新订单生命周期

```
pending_payment（已下单，待付款）
  → payment_submitted（已提交凭据，待卖家核验）
  → paid（卖家已确认收款）
  → shipped（卖家已发货）
  → completed（买家确认收货，或发货 7 天后自动完成）
  ↘ cancelled（付款前买家/卖家可取消）
```

- `completed` 两种入口：买家通过 agent 调 `confirm_receipt`；或发货满 7 天无人确认，由 Worker 的每日定时任务自动完成（写事件 `auto_completed`）。
- `cancelled` 只允许在 `paid` 之前；已付款的取消走退款流程（v1 不做）。
- 每一次状态变化都写一条事件记录，订单详情里就是一条时间线。

## 四、买家自动跟进：怎么实现

### 平台侧（让 agent 查得便宜、查得准）

- 新增 `order_events` 表（只追加）：`order_id / event / from_status / to_status / actor（buyer/seller/system）/ note / created_at`。
- `get_order` 返回里加 `timeline` 数组（全部事件，按时间排）。
- 新增公开查询接口 `GET /shops/:shop/api/orders/:id/events`，返回同一份事件流，供任何客户端轮询。
- `create_order` 增加可选字段：`buyer_name / buyer_contact / shipping_address`。没有收货地址卖家没法发货，现在订单里连买家是谁都没有，这是必须补的；agent 在下单前向买家要（下单确认那一步一起问）。

### Agent 侧（Muse 里的行为，写进 guide.md / presentation.json）

- `create_order` 成功后，agent **自动**为这个订单建跟踪任务，不用买家开口、不用买家记订单号：
  - 在 Muse 里就是：一条跟踪记录 + 一个每 6 小时跑一次的定时检查，调 `get_order`（一次调用）；
  - 状态没变：什么都不做；状态变了：在对话里主动告诉买家，说明新状态是什么意思、下一步是什么，并给可点选项（例如已发货时给 [确认收货] [查看订单]）；
  - 到终态（`completed` / `cancelled`）自动停掉检查，并发一条结尾消息。
- 别的客户端（Claude / Grok）没有 Muse 的定时检查，就用同一个 `get_order` / `events` 接口自己轮询，行为由各客户端决定；平台不替客户端做推送。
- 买家随时可以问 agent“我的订单怎么样了”，agent 用订单号直接查，不用买家再提供。

### 新增 MCP 工具（买家用）

| 工具 | 说明 |
| --- | --- |
| `confirm_receipt` | `order_id`，仅 `shipped` → `completed`，否则报错 |
| `cancel_order` | `order_id` + 可选原因，仅 `pending_payment / payment_submitted` 可取消 |

## 五、卖家后台：怎么实现

### 形态

- 网页后台，地址 `/shops/:shop/admin/`，由同一个 Worker 提供（纯服务端渲染 + 少量 JS，不引入前端框架）。
- 鉴权：每家店一把 API Key。Key 只存 SHA-256 哈希在 D1 新表 `shop_admin_keys`，明文只在生成时显示一次，由 Hall 交给店主；后台登录用 Bearer Key，登录后发 httpOnly 会话 Cookie（24 小时）。Key 不进仓库、不进任何店铺文件。
- 后台路由不进 `llms.txt` / `agent.json` 的发现列表，不对买家的 agent 开放。

### 后台能做的事

- 总览：各状态订单数（待核验 / 已付款待发货 / 已发货 / 已完成）。
- 订单列表：按状态筛，按时间倒序，显示金额、买家、商品摘要。
- 订单详情：商品明细、付款凭据（支付方式、交易单号、金额）、完整时间线。
- 一键确认收款：调同一个 `confirm_payment` 逻辑，页面上并排显示凭据金额和订单总额，对不上标红、不让点。
- 标记发货：填快递公司 + 快递单号（可选），`paid → shipped`。
- 商品管理：改价格、改库存（上下架 v1 不做，用库存 0 表示无货，沿用现有规则）。
- 政策管理：查看/修改运费、满额免邮、退货政策、收款方式说明。

### 管理 API（后台网页调，后台鉴权）

```
GET  /shops/:shop/admin/api/orders?status=&limit=
GET  /shops/:shop/admin/api/orders/:id
POST /shops/:shop/admin/api/orders/:id/confirm-payment   {verified_amount_cny, note}
POST /shops/:shop/admin/api/orders/:id/mark-shipped      {carrier, tracking_number}
POST /shops/:shop/admin/api/orders/:id/cancel            {reason}
GET  /shops/:shop/admin/api/products
PUT  /shops/:shop/admin/api/products/:id                 {price_cny, stock}
GET/PUT /shops/:shop/admin/api/policies
```

### 卖家 MCP 工具

- `confirm_payment` 已有，保留（卖家也可以让自己的 agent 调）；后台按钮和它调同一个 `db.js` 函数，逻辑只有一份。
- 新增 `mark_shipped`（`order_id / carrier / tracking_number`，仅 `paid → shipped`），同样函数复用。

## 六、数据模型变化（migration 0004）

- `orders` 增加：`buyer_name / buyer_contact / shipping_address`（可空）、`carrier / tracking_number / shipped_at / completed_at / cancelled_at / cancel_reason`。
- 新建 `order_events`（见第四节）、`shop_admin_keys`（见第五节）。
- 所有状态变化统一走一个 `transitionOrder()` 助手：改状态 + 写事件，二者同一次写入，缺一不可。
- 老订单不受影响：已有的 `paid` 订单保持原样（`verified_amount_cny` 仍为空，历史原因见 README），没有发货信息的老订单不会被自动完成。

## 七、实施步骤（审批通过后按此执行）

1. migration 0004 + `db.js` 状态机与事件写入 + 每日定时自动完成（Worker scheduled handler）。
2. MCP 新工具：`confirm_receipt / cancel_order / mark_shipped`；`create_order` 加买家信息字段；更新 `guide.md`（agent 下单后自动建跟踪任务）、`presentation.json`（订单时间线 + 跟踪消息模板）、`mcp.json` / `openapi.json`（版本 1.2.0，工具 11 个）。
3. 管理 API + 后台网页 + 发 Key 的脚本；三家店各生成一把 Key（明文只给 Hall 一次）。
4. 线上全流程实测：下单 → 交凭据 → 后台确认收款 → 后台标记发货 → 买家确认收货 → `completed`；另测金额不符拒绝、错误状态操作拒绝、未带 Key 调管理 API 被拒；老订单状态不变。
5. 推到 `cf-shop` 仓库，更新 README 与 TEST_PROMPTS（加跟进与后台的消费者口吻测试提示）。

## 八、需要 Hall 定的默认值（方案里已给建议，不改就按建议做）

| 事项 | 建议 |
| --- | --- |
| 发货后自动完成 | 7 天 |
| 跟踪轮询间隔 | 6 小时 |
| 后台 Key 发放 | 我生成三家店的 Key，明文只发给 Hall 一次，由 Hall 交给店主 |
| 买家信息 | 下单时 agent 问买家要姓名、联系方式、收货地址（可选字段，不填也能下单） |
| 退款 | v1 不做，状态位预留 |

## 九、不做 / 以后做的

- 不做买家账号体系、不做平台推送（没地方可推）；任何客户端都用 `get_order` / `events` 轮询。
- 不做在线支付网关回调；线下收款核验仍由卖家在后台人工确认。
- 不做退款流程、不做商品上下架、不做多员工权限（先一把 Key 管一家店）。
