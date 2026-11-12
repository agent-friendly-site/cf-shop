---
name: phase5-admin-upload
description: >-
  Execute Phase 5 HonoX rewrite of admin and proof-upload pages for cf-shop
  with feature-flag cutover. Use when working on app/ islands, ADMIN_HTML
  removal, upload page rewrite, or Phase 5 acceptance.
---

# Phase 5 — admin + upload UI

HonoX 重写后台页与上传页。读并遵守 `docs/phase5-ui-cutover.md` 与 `docs/refactor-plan.md` §5。不动 API/MCP/状态机。

## When to use

- 开始或继续 Phase 5
- 改 `app/` 岛、后台/上传 SSR
- 准备删 `ADMIN_HTML` / `page()` 之前做切流验收

## Hard rules

1. **API / MCP / 店铺静态路由不迁文件路由**；HonoX 只接两个页面。
2. **岛之间不许互相 import**；共用逻辑放 `app/lib/`。
3. **`honox-island { display: contents; }` 不许删**。
4. React 岛与 hono/jsx 岛不混写；React 岛用 `className` + `react` hooks。
5. 金额 / 时限 / 状态机判断在服务端；岛只调 API、展示状态。
6. 新后台禁止 `alert()` / `confirm()`。
7. **未按切流文档切到默认 `honox` 并经真机签字前，禁止删 `ADMIN_HTML` / upload `page()`。**

## Implementation order

1. 读 `docs/phase5-ui-cutover.md`，实现 `UI_MODE` + 覆盖开关（先 flag，后删旧页）。
2. **先上传页**（5.1）→ 默认仍 legacy，用 `?ui=honox` 真机验。
3. **再后台页**（5.2）→ 同上。
4. Hall/负责人真机清单全过 → 默认改 `honox` → 观察 → 再删旧 HTML（5.3）。
5. 跑 Phase 5 静态检查（岛 import、display:contents、无 ADMIN_HTML 残留）。

## Local verify

```bash
npm run typecheck
npm test
npm run dev
# 浏览器：
#   /shops/bean-bloom/admin/?ui=honox
#   上传链接加 &ui=honox
```

## Real-device checklist（声称完成前）

### 上传页

- [ ] 首屏：店名、商品、金额、付款倒计时
- [ ] 过期订单：明确已取消，无上传表单
- [ ] 选图预览 / 超 5MB / 非图片 → 本地拦住
- [ ] 提交成功 → 待核验说明
- [ ] 坏 token / 已用链接 → 一句话原因 + 下一步
- [ ] 手机宽度可用

### 后台页

- [ ] 错 key →「Key 不对…」类可读错误，非裸 JSON
- [ ] 登录成功 → 列表；筛选不丢
- [ ] 确认收款：金额不符前端先拦；成功状态变已付款
- [ ] 发货、取消（Dialog 确认）、商品/政策行内编辑
- [ ] 凭据图可看；未登录图片 401
- [ ] 无 `alert`/`confirm`
- [ ] 手机可完成登录→开单→确认收款

### 计时（可选但推荐记一笔）

- 后台：从导航到**订单列表可点击**的时间
- 上传：从打开链接到**文件按钮可点**的时间  
  不要用「出了个 logo/标题」冒充可用。

## After UI sign-off

1. `UI_MODE` 默认 `honox`（见切流文档）。
2. 再跑 deploy-verify + parity-check（C/D）。
3. 删 `ADMIN_HTML` / `page()`；`grep` 零命中（测试除外）。
4. 更新 `AGENTS.md` 当前状态：Phase 5 完成。

## Do not

- 跳过 flag、一次性替换线上默认 UI
- 在岛里复制状态机或「顺手」给 MCP confirm_payment 加鉴权（非目标）
- 混进行为改动（价格、15 分钟、7 天）——重构 commit 不混行为
