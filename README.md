# agent-friendly-platform

Cloudflare 上的多商户 **agent 专属商城**：单 Hono Worker + D1 + R2。  
Live: https://agent-friendly-platform.refined-x.workers.dev · **v2.0.0**

- 店面：`/shops/:shop/`（无人类购物 UI）；发现靠 `llms.txt`
- MCP：`POST /shops/:shop/mcp`（Streamable HTTP，13 工具）
- 付款线下；买家用一次性上传链接交截图；卖家后台核验 / 发货
- 生命周期：`pending_payment` → `payment_submitted` → `paid` → `shipped` → `completed`（可在付款前 `cancelled`）；未付款 15 分钟自动取消；发货 7 天可自动完成

## Shops

| slug | shop | products |
|---|---|---|
| `bean-bloom` | Bean Bloom Coffee / 晨光咖啡 | Yirgacheffe 68, Cold Brew 88, Decaf 72 (out of stock) |
| `paper-lantern` | Paper Lantern Stationery / 纸灯文具 | Notebook 38, Gel pen 18, Washi tape 25 |
| `terra-pots` | Terra Pots Ceramics / 陶土手作 | Mug 128, Plate 98, Vase 158 |

运费统一 12 元，满 200 包邮；7 天退货（未使用、买家承担运费）。事实在 `src/data/`。

## Architecture

```
Worker agent-friendly-platform
├── app/                 HonoX SSR + React 岛（后台 / 上传页）
├── src/
│   ├── routes/          HTTP 接入（health / shop / orders / admin / upload / mcp）
│   ├── mcp/             MCP server + tools/*
│   ├── services/        业务编排
│   ├── domain/          纯规则（状态机、金额、凭据）
│   ├── db/              Drizzle schema + repositories
│   └── data/            店铺事实（改事实只改这里）
├── drizzle/             D1 migrations
└── bindings             D1 agent-friendly-orders · R2 PROOFS
```

分层：`routes` / `mcp` / `app` → `services` → `domain` + `db/repositories`。  
细节见 `docs/design-order-tracking-admin.md`（含 v2.0 架构节）与 `docs/refactor-plan.md`。

## Commands

```bash
npm install
npm run build                 # Vite client + server → dist/
npm run dev                   # 本地 Vite / HonoX
npm test                      # 本地 Vitest（unit + integration + D1）
npm run test:smoke            # 线上冒烟（health / llms / tools/list / admin）
npm run gen-data              # src/data → src/static/data.ts
npm run seed -- --local       # 同步店铺事实到本地 D1（--remote 写生产）
npm run update-shop-facts -- --local   # 只刷新政策/收款 JSON 列
npm run gen-admin-keys -- --remote     # 轮换后台 key（明文只打 stdout，勿提交）
```

## Deploy

```bash
npx wrangler login            # 首次
npm run build
npx wrangler deploy
npm run test:smoke
```

记下部署返回的 **Version ID**，写入下方发版记录。回滚靠上一 Version。  
仓外 `cf.py worker-put` 仅兜底。Cron：`* * * * *`（免费账号触发器上限已满）。

## Seller admin

- URL：`/shops/:shop/admin`
- 鉴权：每店一个 `afk_…` key（登录后 httpOnly cookie）；key 哈希存 D1，明文不进仓库
- 生成：`npm run gen-admin-keys -- --remote`（会轮换；勿为测试随便轮换 Hall 的 key）

## Tests

| 层 | 命令 | 范围 |
| --- | --- | --- |
| 本地 | `npm test` | 状态机 / 金额 / 鉴权 / MCP tools/list / jobs |
| 线上冒烟 | `npm run test:smoke` | health、发现面、13 tools、admin 壳 |
| 盲测 | `TEST_PROMPTS.md` | fresh agent；至少 25–27（见文件缺口说明） |
| 真机 | 浏览器 | 后台登录 / 核验 / 发货；上传页主路径 |

## 发版记录

| 版本 | 日期 | Version ID | 说明 |
| --- | --- | --- | --- |
| 2.0.0 | 2026-11-13 | `86d53011-1153-4246-b86e-4b5ce19657fa` | 重构收尾：全 TS 脚本、HonoX 后台、无仓内 `.py`（上一版 `740d2bec-a9f5-465c-8837-4eb37cf2b322`）。smoke 过；平台侧核对 prompt 25/26/27（缺地址拒单、upload link、15 分钟 deadline）；fresh-agent 盲测仍待 Hall |
| 1.7.0 | 2026-11-11 | — | 15 分钟未付款自动取消等（见 git 历史） |

## Docs for agents

- [`AGENTS.md`](AGENTS.md) — 本仓库 coding agent 规矩
- [`docs/refactor-plan.md`](docs/refactor-plan.md) — 重构任务书（Phase 0–6 已完成）
- [`docs/design-order-tracking-admin.md`](docs/design-order-tracking-admin.md) — 订单跟踪 + 后台设计
- [`.cursor/skills/deploy-verify/`](.cursor/skills/deploy-verify/) — 部署与冒烟
- [`.cursor/skills/parity-check/`](.cursor/skills/parity-check/) — 契约抽查
