---
name: parity-check
description: >-
  Check agent-facing routes and admin/upload API contracts for cf-shop.
  Use after data/static/route changes or post-deploy contract checks.
---

# Parity check

对外契约回归：店铺发现面、MCP tools/list、后台/上传 API 形状。旧行为是规格。  
GitHub Pages 已归档；不再跑 Pages↔Worker 字节比对。

## When to use

- 改了 `src/data/`、`src/static/`、店铺路由、gen-data
- 部署后确认 agent 可见面没漂
- 用户说「比对一下线上」或「契约有没有变」

## Steps

### A. 店铺发现面 + 后台壳（轻量）

优先：

```bash
npm run test:smoke
```

或手工（带浏览器 UA）：

```bash
UA='Mozilla/5.0 (agent-friendly-platform-test)'
BASE='https://agent-friendly-platform.refined-x.workers.dev'
curl -sS -H "User-Agent: $UA" "$BASE/health"
curl -sS -H "User-Agent: $UA" "$BASE/shops/bean-bloom/llms.txt" | head
curl -sS -o /dev/null -w "%{http_code}\n" -H "User-Agent: $UA" "$BASE/shops/bean-bloom/admin"
```

- `llms.txt` 非空；admin HTML 含 HonoX 岛痕迹（如 `admin-shell`）
- 需要时再抽查 `products.json` / `policies.json` 等店铺静态路径

### B. MCP tools/list（13 工具）

对任一演示店（如 bean-bloom）`POST .../mcp`，`tools/list`：

- 工具名集合与线上/上一稳定版一致（数量 13）
- **不要改工具 description 原文**（契约）
- `npm run test:smoke` 已覆盖数量与固定名单

### C. 后台 API 形状

页面可以换，**API 路径与 JSON 错误形状不要换**。最少核对：

| 调用 | 期望 |
| --- | --- |
| `POST .../admin/api/login` 错 key | 401，`{ "error": "wrong admin key" }` |
| `POST .../admin/api/login` 对 key | Set-Cookie `af_admin=...`，Path 含 `/shops/:shop/admin` |
| 未登录访问订单 API | 401 |
| 登录后订单列表 | 200，字段与现网一致（id/status/amounts 等） |

可用 curl（带 UA + cookie jar）。**不要把真实 admin key 写进 skill 输出或提交到 git**；从本地/用户提供的一次性环境读。

### D. 上传页契约

- `GET /shops/:shop/orders/:id/upload-proof?token=...`：坏 token / 过期 / 已用 → 可读 HTML 说明，不是裸 500
- `POST` multipart：超 5MB / 非图片 → 当场拒绝；成功 → 订单变 `payment_submitted`
- HTML 壳可变；status 与业务结果不变

## Pass / fail

- **Pass**：A 冒烟过；B 工具集合一致；C/D API 错误码与关键字段未漂
- **Fail**：任一 agent 可见 JSON/文本契约漂了，或 API 错误码/字段改名——先修，再谈 UI

## Do not

- 为了让比对变绿去改店铺事实「迁就 NEW」——事实只改 `src/data/` 且有意为之
- 删除或「优化」MCP 工具描述
- 在报告里粘贴密钥或完整付款凭据
- 恢复对已归档 GitHub Pages 的字节比对
