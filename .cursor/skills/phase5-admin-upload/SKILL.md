---
name: phase5-admin-upload
description: >-
  Phase 5 HonoX admin + proof-upload for cf-shop (cutover complete).
  Use when working on app/ islands, admin shell, or upload page.
---

# Phase 5 — admin + upload UI（已切 HonoX）

双轨已结束：仅 HonoX。见 `docs/phase5-ui-cutover.md` 与 `docs/refactor-plan.md` §5。不动 API/MCP/状态机。

## Hard rules

1. **API / MCP / 店铺静态路由不迁文件路由**；HonoX 只接后台与上传页。
2. **岛之间不许互相 import**；共用逻辑放 `app/lib/`（含 Auth bus、`getQueryClient()`）。
3. **`honox-island { display: contents; }` 不许删**。
4. React 岛与 hono/jsx 岛不混写；React 岛用 `className` + `react` hooks。
5. 金额 / 时限 / 状态机判断在服务端；岛只调 API、展示状态。
6. 新后台禁止 `alert()` / `confirm()`。
7. 全后台唯一 Toaster 在 `admin-shell`；上传页自带一个 Toaster。

## Architecture

- SSR：`app/routes/shops/[shop]/admin/index.tsx` 渲染 `AdminShell` + 四内容岛。
- 壳岛：登录 / 常驻导航 / Toaster。
- 内容岛：鉴权读 session bus；未登录 `return null`。
- Query：`getQueryClient()` 模块单例，跨岛 invalidate 生效。

## Local verify

```bash
npx tsc --noEmit
npm test
npm run build
npm run dev
# 浏览器：/shops/bean-bloom/admin
```

## Real-device checklist

### 上传页

- [ ] 首屏：店名、商品、金额、付款倒计时
- [ ] 过期订单：明确已取消，无上传表单
- [ ] 选图预览 / 超 5MB / 非图片 → 本地拦住
- [ ] 提交成功 → 待核验说明
- [ ] 坏 token / 已用链接 → 一句话原因 + 下一步
- [ ] 手机宽度可用

### 后台页

- [ ] 错 key → 可读错误
- [ ] 登录后切「商品」「政策」立即有内容；常驻三 tab
- [ ] 筛选 `?status=` 刷新仍在；Badge 中文
- [ ] 确认收款 / 发货 / 取消后列表即时变；Toast 只一条
- [ ] 商品「取消」还原；政策可改收款说明
- [ ] 凭据图可点放大；无 `alert`/`confirm`

## Do not

- 恢复 `UI_MODE` / legacy HTML 双轨
- 在岛里复制状态机或「顺手」改 MCP
- 混进行为改动（价格、15 分钟、7 天）
