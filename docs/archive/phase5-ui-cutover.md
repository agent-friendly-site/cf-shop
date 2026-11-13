# Phase 5 UI 切流（已完成）

> 状态：**已完成（2026-11-12）**。双轨结束：后台与上传页仅走 HonoX；`UI_MODE` / `?ui=` / `af_ui` cookie / `src/routes/ui-mode.ts` 已删除。  
> 配套 skill：`.cursor/skills/phase5-admin-upload/`（历史执行清单，不再做 flag 切流）。

## 结论

- `GET /shops/:shop/admin` 与 `GET .../upload-proof` 固定 HonoX SSR + React 岛。
- 旧 `ADMIN_HTML` / upload `page()` 已删；回退只能靠 Worker Version rollback。
- Admin UX 精修（P0→P1）：共享 Auth bus + QueryClient 单例 + 单 Toaster（Radix）、常驻 `admin-shell` 导航、`?tab=` / `?status=` 深链、中文状态、Table/Form/Select、凭据 lightbox、政策含收款方式编辑。

## 边界（未变）

```
GET  /shops/:shop/admin              ← HonoX
GET  /shops/:shop/orders/:id/upload-proof  ← HonoX
POST /shops/:shop/orders/:id/upload-proof  ← API 不变
*    /shops/:shop/admin/api/*        ← 不变
*    /shops/:shop/mcp                ← 不变
*    /shops/:shop/*.txt|json|md      ← 不变
```

岛只打现有 admin/upload API，无平行第二套。

## 相关文档

- 体验/实现要求：`docs/archive/refactor-plan.md` §5
- 部署冒烟：`.cursor/skills/deploy-verify/SKILL.md`
- 契约比对：`.cursor/skills/parity-check/SKILL.md`
