---
name: parity-check
description: >-
  Compare agent-facing routes and admin/upload API contracts against a known
  baseline for cf-shop. Use after data/static/route changes, post-deploy
  contract checks, or Phase 5 UI cutover when pages change but APIs must not.
---

# Parity check

对外契约回归：店铺静态文件、（可选）MCP tools/list、Phase 5 期间后台 API 形状。旧行为是规格。

## When to use

- 改了 `src/data/`、`src/static/`、店铺路由、gen-data
- Phase 4/5 部署后确认 agent 可见面没漂
- 用户说「比对一下线上」或提到 `compare_routes.py`

## Steps

### A. 店铺静态路由（现成脚本）

```bash
python3 tests/compare_routes.py
```

- 带浏览器 UA（脚本已内置）
- 输出 `MATCH` / `DIFF` / `ERROR`
- **预期**：重构阶段 agent 可见路径应全 MATCH（host 归一化后）
- GitHub Pages 已归档；若 OLD 侧大面积 ERROR，改报「OLD 不可达」，不要假装 NEW 有问题就算过

报告时按路径列出 DIFF；不要只说「有差异」。

### B. MCP tools/list（13 工具）

对任一演示店（如 bean-bloom）`POST .../mcp`，`tools/list`：

- 工具名集合与线上/上一稳定版一致（数量 13）
- **不要改工具 description 原文**（契约）
- 记录：工具名列表是否一致；不一致则阻塞发布

### C. 后台 API 形状（Phase 5 UI 切流时必做）

页面可以换，**API 路径与 JSON 错误形状不要换**。最少核对：

| 调用 | 期望 |
| --- | --- |
| `POST .../admin/api/login` 错 key | 401，`{ "error": "wrong admin key" }` |
| `POST .../admin/api/login` 对 key | Set-Cookie `af_admin=...`，Path 含 `/shops/:shop/admin/` |
| 未登录访问订单 API | 401 |
| 登录后订单列表 | 200，字段与现网一致（id/status/amounts 等） |

对比方式：同一店铺、同一操作，对 **legacy HTML 页背后的 API** 与 **HonoX 岛调用的 API** 打同一组请求；响应 status + 关键错误字段必须一致。

可用 curl（带 UA + cookie jar）。**不要把真实 admin key 写进 skill 输出或提交到 git**；从本地/用户提供的一次性环境读。

### D. 上传页契约

- `GET /shops/:shop/orders/:id/upload-proof?token=...`：坏 token / 过期 / 已用 → 可读 HTML 说明，不是裸 500
- `POST` multipart：超 5MB / 非图片 → 当场拒绝；成功 → 订单变 `payment_submitted`
- Phase 5 切 HonoX 后：上述 status 与业务结果不变；只允许 HTML 壳变好看

## Pass / fail

- **Pass**：A 无意外 DIFF；B 工具集合一致；Phase 5 期间 C/D 与切流前基线一致
- **Fail**：任一 agent 可见 JSON/文本契约漂了，或 API 错误码/字段改名——先修，再谈 UI

## Do not

- 为了让比对变绿去改店铺事实「迁就 NEW」——事实只改 `src/data/` 且有意为之
- 删除或「优化」MCP 工具描述
- 在比对报告里粘贴密钥或完整付款凭据
