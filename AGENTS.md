# AGENTS.md — agent-friendly-platform（cf-shop）

给在这个仓库里干活的 coding agent 看的。先读这份文件，再动手。
业务背景见 `README.md` 和 `docs/design-order-tracking-admin.md`。
重构（Hono + TS + HonoX）**已完成**（v2.0.0+）；历史任务书见 `docs/archive/refactor-plan.md`。

## 这是什么

单 Cloudflare Worker（Hono）+ D1 + R2 上的多商户 agent 专属商城。
每个商户是一个 agent-only 店面：`/shops/:shop/`，发现靠 llms.txt，
下单靠 MCP（`POST /shops/:shop/mcp`），付款线下，凭据靠一次性上传链接。
当前版本 **2.0.1**，线上地址：https://agent-friendly-platform.refined-x.workers.dev

三家演示店（数据全是测试数据）：bean-bloom（咖啡）、paper-lantern（文具）、
terra-pots（陶土）。价格、政策、状态机见 `docs/archive/refactor-plan.md` 附录 A，
改代码前先读那张表。

## 常用命令

```bash
npm install
npm run build                 # Vite + HonoX → dist/
npm run dev
npm test                      # 本地 Vitest
npm run test:smoke            # 线上冒烟
npm run gen-data
npm run seed -- --local       # 或 --remote
npm run update-shop-facts -- --local
npm run gen-admin-keys -- --remote   # 明文只 stdout，勿提交 / 勿随意轮换
```

部署：`npm run build && npx wrangler deploy`，然后 `npm run test:smoke`。
Version ID 记进 `README.md` 发版记录。

## 目录

```
app/               HonoX SSR + React 岛（admin / upload-proof）
src/
  index.ts         入口：挂 routes + scheduled()
  routes/          HTTP 接入层
  mcp/             MCP server + tools/*（13 工具，描述原样保留）
  domain/          纯规则
  services/        业务编排
  db/              schema + repositories
  static/data.ts   生成的静态 import map（npm run gen-data）
  data/            店铺事实（改事实只改这里）
drizzle/           D1 migrations
tests/             Vitest + smoke.ts
scripts/           seed / gen-data / update-shop-facts / gen-admin-keys（全 TS）
wrangler.toml
```

## Skills

| Skill | 何时用 |
| --- | --- |
| `deploy-verify` | 构建部署、线上冒烟、回滚 |
| `parity-check` | 店铺发现面 / MCP / 后台 API 契约 |
| `phase5-admin-upload` | **ARCHIVE** Phase 5 后台+上传切流清单（勿当现行 TODO） |

## 规矩

1. **对外契约不动**：路由、MCP 工具名/参数、店铺文件路径、订单状态机、
   价格/政策/时限（15 分钟、7 天）——改之前先确认，不许“顺手优化”。
2. **commit 不混行为与重构**：一个 commit 只做一件事。
3. **分层调用**：
   - `routes` / `mcp` / `app` → 只调 `services/*`
   - `services/*` → 可调 `domain/*` + `db/repositories/*`
   - 接入层禁止 `import` repositories / `import * as db`
   - 边界错误：服务抛 `DomainError`（常用便捷子类 `DomainRpcError`）；
     HTTP `toHttpError`，MCP `toMcpError`
4. **改店铺事实只改 `src/data/`**，再 `gen-data` / `seed` 或 `update-shop-facts`。
5. **不要把密钥、token、后台 key 明文写进仓库**。丢了再 `gen-admin-keys`，
   不要为了测试去轮换 Hall 的 key。
6. **D1 订单全是测试单**。
7. **前端改动必须真机验证**：`tsc` 不够；岛之间不许互相 import；
   `honox-island { display: contents; }` 不许删。
8. **声称完成前先线上验证**：部署后读实际返回 / 跑 `test:smoke`。
9. **测试先行**：逻辑改动先 `npm test`；部署后 `test:smoke`；
   新行为补 `TEST_PROMPTS.md`。

## 部署

- Worker `agent-friendly-platform`；D1 `agent-friendly-orders`；R2 `PROOFS`
- `npx wrangler login` 后 `npm run build && npx wrangler deploy`
- 每次部署记下 Version ID → `README.md` 发版记录
- GitHub 推送走 snapshot-push（本仓库未必是标准 git checkout）

## 坑

- D1 `/batch` 在此账号 404：一次一条语句（脚本走 wrangler `--file`）
- cron 免费版上限 5/账号已满；本 Worker 仅 `* * * * *`
- workers.dev 要浏览器 UA
- MCP 无图片上传：买家走上传链接
- “必须”用代码卡在工具/服务层，不要只写提示词
- GitHub Pages 已归档：勿再推 Pages；关站点仍等 Hall

## 当前状态

- **v2.0.x**：重构收尾完成（Phase 0–6）。全仓无 `.py`；HonoX 后台/上传；
  运维脚本全 TS；线上冒烟 `tests/smoke.ts`。
- `TEST_PROMPTS` 1–18 **不可恢复、不补造**；现行 19–27，盲测至少 25–27。
- 待 Hall：关 GitHub Pages。
