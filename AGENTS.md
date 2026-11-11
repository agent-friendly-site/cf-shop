# AGENTS.md — agent-friendly-platform（cf-shop）

给在这个仓库里干活的 coding agent 看的。先读这份文件，再动手。
业务背景和完整设计见 `README.md` 和 `docs/design-order-tracking-admin.md`；
重构进行中，见 `docs/refactor-plan.md`（它是当前最高优先级的任务书）。

## 这是什么

单 Cloudflare Worker（Hono）+ D1 + R2 上的多商户 agent 专属商城。
每个商户是一个 agent-only 店面：`/shops/:shop/`，发现靠 llms.txt，
下单靠 MCP（`POST /shops/:shop/mcp`），付款线下，凭据靠一次性上传链接。
当前版本 1.7.0，线上地址：https://agent-friendly-platform.refined-x.workers.dev

三家演示店（数据全是测试数据）：bean-bloom（咖啡）、paper-lantern（文具）、
terra-pots（陶土）。价格、政策、状态机见 `docs/refactor-plan.md` 附录 A，
改代码前先读那张表。

## 常用命令

```bash
npm install          # 装依赖
npm run build        # esbuild 打包到 dist/worker.mjs
npm run dev          # wrangler dev 本地开发
npm test             # 线上 E2E（Python + curl 打线上 Worker）
npm run seed         # 从 src/data 同步商品/政策到 D1（要账号和库 ID 参数）
```

部署：Phase 0 已验证，走 `npx wrangler deploy`（见“部署”一节）；cf.py 仅兜底。
测试：`tests/test_client.py`（MCP 全流程）、`tests/test_admin.py`（后台）。

## 目录

```
src/
  index.js         入口：全部路由 + scheduled()
  db.js            数据访问 + 业务逻辑（740 行，正在拆——见重构计划）
  mcp.js           13 个 MCP 工具
  admin.js         后台 API + 后台页面（ADMIN_HTML 模板字符串，正在拆）
  proof_upload.js  上传页 + 上传接口
  data.js          生成的静态文件 import map（别手改，用 scripts/gen_data_module.py 生成）
  data/            店铺事实：商品、价格、政策、guide、mcp.json 等（改事实只改这里）
migrations/        D1 建表 SQL（0001–0005）
tests/             Python 线上 E2E
scripts/           Python 运维脚本（seed、生成 key、改店铺事实）
wrangler.toml      绑定（D1、R2）和触发器
```

## 规矩

1. **对外契约不动**：路由、MCP 工具名/参数、店铺文件路径、订单状态机、
   价格/政策/时限（15 分钟、7 天）——改之前先确认，不许“顺手优化”。
2. **重构 commit 不混行为改动**：一个 commit 只做一件事；行为改动单独 commit。
3. **改店铺事实只改 `src/data/`**，再跑同步脚本写 D1；不要直接改 D1 里的商品数据。
4. **不要把密钥、token、后台 key 明文写进仓库、记忆或代码**。
   后台 key 只给过 Hall 一次，丢了就重新生成，不要为了测试去轮换他的 key。
5. **D1 里的订单全是测试单**，交易单号全是测试号；不要当成真实订单。
6. **前端页面改动必须真机验证**：`npx tsc --noEmit` 通过后，再用浏览器
   实际点一遍（登录、主流程、一个失败分支）。只测 API 不算验证通过。
   前端走 HonoX（React 岛 + Tailwind + shadcn/ui），见 `docs/refactor-plan.md`
   §2.1–§2.2、§5.4：岛之间不许互相 import，`honox-island { display: contents; }`
   不许删，React 岛与 hono/jsx 岛不混写。
7. **声称完成前先线上验证**：部署后读线上实际返回（/health、工具列表、
   店铺文件），不要只凭本地构建成功就汇报。Pages/部署有同步延迟，
   没刷出来就明说，不要硬说成功了。
8. **测试先行**：改订单流、金额、时限这类逻辑，先跑 `tests/test_client.py`；
   改后台先跑 `tests/test_admin.py`；新行为要补测试 prompt 到 `TEST_PROMPTS.md`。

## 部署

- Worker 名 `agent-friendly-platform`，账号 `b74b5f1383b4c12d7d98a26b462e7c22`，
  D1 `agent-friendly-orders`（`dd3c36b4-a260-4fc5-9da2-b9b06ccfb1cc`），
  R2 `agent-friendly-proofs`（绑定 `PROOFS`）。
- 部署命令（构建 + 上传；`wrangler.toml` 已含 D1/R2/cron）：
  ```bash
  npm run build
  npx wrangler deploy
  ```
  需先 `npx wrangler login`（OAuth；token 不进仓库）。WSL 与 Windows
  的 wrangler 凭证目录不同，换环境要重新 login 或同步 config。
- Phase 0（2026-11-11）已验证 wrangler 可用；cf.py `worker-put` 保留为兜底，
  不再作为默认路径。详见 `docs/refactor-plan.md` §2.2。
- 每次部署记下返回的 Version ID / deployment_id，回滚就靠它。
- 推送到 GitHub 用 snapshot-push 流程（本仓库不是 git checkout）：
  先读 `/opt/hatch/connectors/github/references/snapshot-push.md`，
  按那份流程走：核对远端 head、更新 `~/workspace/cf-shop-paths.txt` 清单、
  推送成功后把确认的 commit SHA 写进 `~/workspace/cf-shop.muse-github-snapshot-sync.json`。
  只有 GitHub 确认的 SHA 才能写进同步记录。

## 坑（都是真金白银踩出来的，别再踩）

- **HTML 别放进 JS 模板字符串**：`ADMIN_HTML` 里的 `\'` / `\"` 转义会被剥掉，
  导致整个页面脚本解析失败（`doLogin is not defined`，2026-11-11）。
  前端重构（`docs/refactor-plan.md` §5）就是为了根除它：页面改走 HonoX，
  不再有模板字符串里的 HTML。
- **D1 `/batch` 在这个账号上 404**：写 D1 一次只调一条语句。
- **cron 触发器**：账号免费版上限 5 个/账号，已满；本 Worker 只有 1 个触发器
  （每分钟 `* * * * *`）。新建/修改触发器后要等约 15 分钟才会第一次触发，
  别刚建完就断定它坏了。现在由 `wrangler.toml` `[triggers]` + `wrangler deploy`
  应用；若走 API，PUT body 是裸 JSON 数组 `[{"cron": "..."}]`，不是
  `{"schedules": [...]}`。
- **workers.dev 有 Browser Integrity Check**：自动化请求要带浏览器 UA。
- **MCP 没有图片上传**：买家截图走一次性上传链接（v1.6.0），不许改回让 agent 读图。
- **文字规则卡不住流程**：v1.4.1 的“下单前必须问地址”被盲测绕过，
  最后是把 `shipping_address` 做成工具层必填才卡住的。
  凡是“必须”，一律在工具/服务层用代码卡，不要只写进提示词。
- **跟踪只在交凭据后开始**（每 6 小时查一次）；取消订单要删跟踪任务。
- **上传链接 7 天有效但订单 15 分钟就过期**：链接要在 15 分钟付款窗口内用。
- **盲测要找没看过设计的 fresh agent**：自己测自己设计的流程不算盲测。
- **GitHub Pages 已归档**：不要再往 `agent-friendly-site.github.io` 推东西；
  那个仓库的 Pages 还等 Hall 手动关掉。

## 当前状态

- v1.7.0 已上线：15 分钟未付款自动取消、上传链接交截图、卖家核验、
  跟踪 + 后台管理。全部功能见 `README.md` 的版本记录。
- 进行中：`docs/refactor-plan.md` 的 v2.0 重构。**Phase 0 已通过**；
  **Phase 1.1 已完成**（`src/` 全仓 TypeScript `strict`，`npm run typecheck`）。
  下一步 Phase 1.2 Biome → 1.5 Vitest。前端已定 HonoX 0.1.62（pin 死）+ React
  渲染器 + Tailwind v4 + shadcn/ui；只接后台和上传页，API/MCP 不迁文件路由。
  接手时先读计划，按阶段做，不要跳阶段。
- 待 Hall 手动做的事：关 GitHub Pages；在真机上点一遍后台和上传页（Phase 5 检查点）。
