# Phase 5 UI 切流方案（feature flag）

> 状态：草案（2026-11-12）。配套 skill：`.cursor/skills/phase5-admin-upload/`。  
> 目标：HonoX 重写后台 + 上传页时，**默认可回退到旧 HTML**，避免一次切死。  
> 非目标：不改 API/MCP/店铺静态契约；不加国家级灰度；不新开 Worker。

## 1. 为什么要 flag

`docs/refactor-plan.md` §5.3 要求最终删掉 `ADMIN_HTML` 和 upload `page()`。  
若部署当天就删、默认直出新页，真机不过只能整包 rollback。  
学 X 的做法：新旧并存 → 小流量/显式开关验 → 改默认 → 再删旧实现。

## 2. 开关设计（尽量薄）

### 2.1 环境变量（默认）

在 `wrangler.toml` / `Env` 增加可选变量：

```toml
[vars]
UI_MODE = "legacy"   # legacy | honox
```

| 值 | 行为 |
| --- | --- |
| `legacy` | `GET` 后台/上传页走现有模板字符串 HTML（当前线上行为） |
| `honox` | `GET` 走 HonoX SSR + React 岛 |

`POST` 上传、全部 `/admin/api/*`、MCP、店铺静态文件：**不受此变量影响**。

### 2.2 请求级覆盖（验收用，不改默认）

解析顺序（后者覆盖前者）：

1. `env.UI_MODE`
2. Cookie `af_ui=legacy|honox`（Path=/，Max-Age 建议 1 天，仅调试）
3. Query `?ui=legacy|honox`（上传页用 `&ui=`）

规则：

- 非法值忽略，回退到上一层。
- Query 若存在，可顺带 `Set-Cookie: af_ui=...`，方便同会话点进去不再带参。
- **生产默认保持 `legacy`，直到真机清单全过。**

实现落点建议：

- `src/routes/helpers.ts`（或小模块 `src/routes/ui-mode.ts`）：`resolveUiMode(c) → "legacy" | "honox"`
- `src/routes/admin.ts` 的 `GET .../admin/`：按 mode 分支
- `src/routes/upload.ts` 的 `GET .../upload-proof`：按 mode 分支
- HonoX `app` 挂载方式仍按 refactor-plan §2.1（API 不迁文件路由）

### 2.3 不做什么

- 不做按店铺 / 按国家分流（三家演示店同开关即可）。
- 不做独立 `lite.` 域名（本仓库没有边缘多 app 需求）。
- 不把 flag 写进 MCP 工具返回；买家链接不加默认 `ui=`（避免 agent 缓存脏链接）。验收时人工加参。

## 3. 切流阶段

| 阶段 | 默认 `UI_MODE` | 谁看到新 UI | 退出条件 |
| --- | --- | --- | --- |
| A. 双轨实现 | `legacy` | 仅 `?ui=honox` / cookie | 上传页 §5.2 体验清单本地过 |
| B. 上传页预发 | `legacy` | 同上，线上 deploy | Hall 真机上传主路径 + 失败分支过 |
| C. 后台预发 | `legacy` | 同上 | Hall 真机后台清单过（含错 key、金额不符、发货、取消） |
| D. 切默认 | `honox` | 所有人 | 观察 ≥1 次完整卖家流程；parity-check C/D 过 |
| E. 删旧页 | `honox`（可随后移除变量） | — | `grep` 无 `ADMIN_HTML` / 大段 `page()` HTML；§5.3/5.5 静态检查过 |

**允许回退：**

- D 之前：去掉 query/cookie 即回 legacy；或 `UI_MODE=legacy` 再 deploy（秒级配置级回退优先于整包 rollback）。
- D 之后、E 之前：把 `UI_MODE` 改回 `legacy` 再 deploy。
- E 之后：只能 Worker Version rollback（故 E 必须在 D 稳定后做）。

## 4. 页面与 API 边界

```
GET  /shops/:shop/admin/          ← flag 作用域（HTML）
GET  /shops/:shop/orders/:id/upload-proof  ← flag 作用域（HTML）
POST /shops/:shop/orders/:id/upload-proof  ← 不变
*    /shops/:shop/admin/api/*     ← 不变
*    /shops/:shop/mcp             ← 不变
*    /shops/:shop/*.txt|json|md   ← 不变
```

HonoX 岛必须打现有 API，禁止平行造第二套 admin API。

## 5. 验收指标（有用内容，不是 splash）

记录方式不限（DevTools Performance / 手机秒表均可），部署说明里写一句即可：

| 页面 | 主指标 |
| --- | --- |
| 后台 | 导航开始 → 订单列表第一行可点击 |
| 上传 | 打开链接 → 文件选择控件可点 |

次要：错态是否可读、手机宽度是否可完成主流程。  
不要用「首屏出了标题」代替主指标。

## 6. Commit 纪律

- 实现 flag + 双轨渲染：可单独 commit（行为：默认仍 legacy → **对外默认行为不变**）。
- HonoX 页面实现：不混价格/状态机改动。
- 切默认 `UI_MODE=honox`：单独 commit + 单独 deploy。
- 删 `ADMIN_HTML`：单独 commit，且仅在阶段 E。

## 7. 与现有文档的关系

- 详细体验/实现要求：`docs/refactor-plan.md` §5
- Agent 执行清单：`.cursor/skills/phase5-admin-upload/SKILL.md`
- 部署冒烟：`.cursor/skills/deploy-verify/SKILL.md`
- 契约比对：`.cursor/skills/parity-check/SKILL.md`

本文件只定**怎么切、怎么回退**；体验条目以 §5 为准，不在这里重复扩写。
