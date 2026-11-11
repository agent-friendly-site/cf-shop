# 重构计划 — agent-friendly-platform v2.0（Hono + TS）

> 状态：**Phase 0 + Phase 1 + Phase 2.1–2.3 已完成（2026-11-11）**。下一步 Phase 2.4（seed.ts）。
> 本文是重构的需求文档；Phase 0 结论见 §2.2 末尾。执行时每个阶段都要能独立部署、
> 独立验证；重构不改变任何对外行为，除非本文件明确写出。业务规则见附录 A
> （重构期间这些规则一个字都不动）。
>
> Phase 1.5 注：计划写的 `@cloudflare/vitest-pool-workers` 已弃用并更名为
> `@cloudflare/vitest-plugin`；实现改用后者，验收目标不变（本地 Vitest + 真 D1）。

## 0. 背景与目标

### 0.1 为什么现在重构

v1.0–v1.7.0 是在一天之内按需求叠出来的 demo：Hono Worker + D1，
功能已经闭环（下单、线下支付、截图上传、卖家核验、跟踪、后台管理、
15 分钟自动取消、7 天自动完成），线上可用。但代码是按功能逐块长出来的，
现在的结构已经开始拖慢下一步：

- `src/db.js` 740 行、约 30 个导出，商品、订单、凭据、后台、定时任务全混在一起。
- 两个前端页面是塞在 JS 模板字符串里的 HTML+JS（`ADMIN_HTML`），转义 bug
  已经出过一次（`doLogin is not defined`，2026-11-11），根因没除掉。
- 纯 JavaScript，无类型；MCP 工具、HTTP 路由直接调 D1，没有分层。
- 测试只有 Python + curl 打线上，没有单元测试，没有本地数据库。
- 运维脚本是 Python，应用是 JS，两种语言；部署绕开 wrangler（历史原因）。
- 静态店铺文件三份重复（bean-bloom / paper-lantern / terra-pots 各 15 个文件），
  改一处规则要改三处（现在靠 /tmp 脚本批量改，没有校验）。

### 0.2 目标

1. **一个 coding agent 打开仓库就能干活**：类型齐全、模块边界清晰、
   本地能跑完整测试，不用先读三天代码。
2. **代码按最佳实践分层**：路由 → 服务 → 数据，MCP 工具是服务的薄适配层，
   前端页面是真正的源文件，不再有模板字符串里的 HTML。
3. **前端按最佳体验重写**：后台管理页和上传页状态清晰（加载/空/错/成功）、
   手机上能用、操作有反馈。卖家后台是复杂交互页，用 HonoX（Hono 官方
   meta-framework）+ React Islands + Tailwind + shadcn/ui 做，不再手写
   裸 HTML + 原生 TS 去重造组件库。
4. **可验证**：每个阶段结束都有自动化测试 + 线上验证，任何时候都能回滚。

### 0.3 非目标（这次不做）

- 不加新功能：不做退款、商品上下架、多员工权限、自定义域名、
  confirm_payment / mark_shipped 的 MCP 鉴权（仍是后台 UI 为唯一鉴权路径）。
- 不换框架：继续 Hono，继续 Cloudflare Workers + D1 + R2，继续单 Worker。
  前端改走 HonoX（仍是 Hono 生态），但 **API / MCP / 店铺静态文件路由
  不迁到 HonoX 文件路由**：它们继续留在 `src/routes/` + `src/mcp/` 里
  用代码挂载，HonoX 只接两个页面（后台 + 上传页）。这是本次重构
  范围的硬边界，见 §2.1。
- 不动对外契约：所有 HTTP 路由、MCP 工具名/参数、店铺文件路径、订单状态机、
  价格/政策/时限（15 分钟、7 天）全部不变。
- 不动线上数据：D1 里的订单、凭据、后台 key 全部保留；不重建数据库。

## 1. 现状审计（2026-11-11，v1.7.0）

### 1.1 规模

| 位置                  | 行数         | 说明                                                                            |
| --------------------- | ------------ | ------------------------------------------------------------------------------- |
| `src/db.js`           | 740          | 数据访问 + 业务逻辑 + 定时任务，约 30 个导出                                    |
| `src/mcp.js`          | 375          | 13 个 MCP 工具，全部 inline 注册                                                |
| `src/index.js`        | 323          | 约 25 条路由 + `scheduled()`                                                    |
| `src/admin.js`        | 457          | 后台 API + `ADMIN_HTML` 模板字符串（约 190 行 HTML+JS）                         |
| `src/proof_upload.js` | 175          | 上传页 HTML 生成 + POST 处理                                                    |
| `src/data.js`         | 115          | 生成的静态文件 import map（`gen_data_module.py` 产出）                          |
| `src/data/`           | 约 45 个文件 | 3 家店 × 15 个文件（llms.txt、openapi.json、agent.json、mcp.json、guide.md 等） |
| `migrations/`         | 0001–0005    | 手写 SQL，14 张表；仓库里没有 migration runner                                  |
| `tests/`              | 540          | Python + curl 打线上（test_client.py、test_admin.py、compare_routes.py）        |
| `scripts/`            | 约 420       | Python：seed、import、gen_data、update_shop_facts、gen_admin_keys               |

依赖：`hono ^4.13`、`@modelcontextprotocol/sdk ^1.32`、`zod ^4.6`、
`esbuild`、`wrangler ^4.160`（devDeps）。本地 Node v24。

### 1.2 技术债清单（按严重程度）

1. **前端在模板字符串里**（最严重）：`admin.js` 的 `ADMIN_HTML`、
   `proof_upload.js` 的 `page()`。JS 模板字面量里的 `\'` / `\"`
   转义会被剥掉，页面脚本整体解析失败；静态 HTML 里还有内联 `onclick`。
   每次改页面都要先抽 served `<script>` 跑 `node --check` 再真机点一遍。
2. **db.js 是 god module**：商品、订单、凭据、上传 token、后台 key/session、
   商品政策管理、两个定时任务、常量、金额计算全在一个文件。
   改订单逻辑要读 740 行；新 agent 不敢动。
3. **没有分层**：路由和 MCP 工具直接调 `db.*`；状态机校验只在
   `transitionOrder` 里，调用方各自拼参数；错误没有统一形状
   （有的抛 `{code: -32000}`，有的返回 `{error}`，HTTP 层各自处理）。
4. **无类型**：纯 JS。订单、商品、凭据的形状只存在于运行时；
   改一个字段要靠 grep 和记忆。
5. **测试只有线上 E2E**：Python + curl 打线上 Worker；没有单元测试；
   本地没有 D1（`wrangler dev` 的本地 D1 没接线）；cron 逻辑无法本地验证
   （v1.7.0 第一次 E2E 失败就是因为触发器同步要等 15 分钟）。
6. **双语言**：运维脚本 Python，应用 JS；改店铺事实要跑 /tmp 下的一次性脚本，
   没有版本化、可复用的改事实工具。
7. **部署绕开 wrangler**：`cf.py worker-put` 直接调 API（历史原因：
   wrangler 用不了 vault 里的 token）；`wrangler.toml` 只用来记绑定和本地开发；
   cron 触发器靠 API 单独设置（免费版上限 5 个/账号，已满——见 §6.4）。
8. **静态文件三份重复**：3 家店的 guide.md / mcp.json / agent.json / llms.txt
   结构相同、事实不同；规则改动靠脚本批量替换 + 断言，没有单一事实来源。
9. **后台鉴权散落**：`requireAdmin`（admin.js）、上传 token 校验（db.js +
   proof_upload.js）各自实现；没有统一的鉴权中间件。
10. **无 lint/format、无 CI**：风格靠自觉；没有提交前检查。

## 2. 目标技术栈（定稿）

原则：**选 Hono 生态里最标准、最少胶水的组合；一个 coding agent
不用学新框架就能改；后台的复杂交互交给成熟的 React 组件生态，
而不是手写组件。**

| 层               | 选择                                                       | 为什么是它                                                                                                                                                                                   | 替代方案（为什么不选）                                                                                                      |
| ---------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 语言             | **TypeScript（strict）**                                   | 对 coding agent 收益最大：类型即文档，改字段、改接口时编译器先报错；Hono + MCP SDK 都是 TS 优先                                                                                              | 继续 JS：省事但 agent 每次都要靠 grep 猜形状                                                                                |
| 框架             | **Hono（保留）**                                           | 已在用；Workers 原生、体积小、类型完备                                                                                                                                                       | 不换框架是本次非目标                                                                                                        |
| 全栈框架（前端） | **HonoX 0.1.x（alpha，见 §2.1 风险）**                     | Hono 官方 meta-framework：文件路由 + SSR + Islands 水合，只给交互组件发 JS；`createApp()` 返回的就是 Hono 实例，可挂载现有 API                                                               | 纯 Vite + React SPA：脱离 Hono，又要多维护一套路由/渲染；hono/jsx + 手写 CSS：已证明撑不起后台体验（§0.1、2026-11-11 讨论） |
| 渲染器           | **React（BYOR，`@hono/react-renderer`）**                  | HonoX 默认是 hono/jsx；要上 shadcn/ui 必须走 BYOR 换 React 渲染器。React 岛用 `/** @jsxImportSource react */`，写 `className`、从 `react` 引 hooks，与 hono/jsx（`class`、`hono/jsx`）不混用 | 默认 hono/jsx：组件生态小，shadcn 要用非官方的 shadcn-hono-jsx 移植版；见 §2.1 兜底                                         |
| 服务端渲染       | **HonoX SSR + Islands**                                    | 首屏服务端渲染，后台列表/详情先出 HTML；只有交互岛（筛选、详情操作、行内编辑、文件选择、倒计时）才水合                                                                                       | 整页 SPA 水合：首屏慢、JS 量大，两个页面用不上                                                                              |
| 校验             | **Zod v4（保留并推广）**                                   | 已在用；所有边界（MCP 入参、HTTP body/query、D1 行）都用同一套 schema                                                                                                                        | 不引入新校验库                                                                                                              |
| 数据库           | **Drizzle ORM（drizzle-orm/d1）+ drizzle-kit**             | Hono + D1 的标准组合；schema 即类型，单点事实；migration 由工具生成和管理                                                                                                                    | 继续手写 SQL：类型要手写两份，迟早漂移；Prisma：Workers 上重，且与 D1 的结合不如 Drizzle                                    |
| 测试             | **Vitest + @cloudflare/vitest-plugin**（原 vitest-pool-workers） | 在 miniflare/workerd 里跑真 D1，单元 + 集成测试本地就能跑；cron 逻辑可本地触发验证                                                                                                         | 继续 Python + curl：只保留为上线后的冒烟检查，不再是主测试                                                                  |
| Lint/Format      | **Biome**                                                  | 一个工具管 lint + format，零配置倾向，速度快                                                                                                                                                 | ESLint + Prettier：两个工具两份配置，收益相同                                                                               |
| 构建/部署        | **Vite（HonoX 插件）+ wrangler（目标），cf.py 保留为兜底** | HonoX 是 Vite-centric：构建分两遍（`vite build --mode client && vite build`），Workers 产物走 `@hono/vite-build/cloudflare-workers`；`wrangler deploy` 一次做完部署 + 触发器                 | 见 §2.2：先做 Phase 0 验证，通不过就保留 cf.py                                                                              |
| 脚本             | **Node + TS（tsx）**                                       | 仓库一种语言；seed / 改事实 / 生成 import map 全部改写为 TS                                                                                                                                  | 继续 Python：双语言是本次要消除的债                                                                                         |
| 前端样式         | **Tailwind CSS v4（`@tailwindcss/vite`）**                 | HonoX 官方指引的样式方案；`app/style.css` 里 `@import "tailwindcss" source("../app")`，在 `_renderer.tsx` 里用 `Link` 引入；设计 token（颜色、状态徽标、按钮）两页共用                       | 手写单文件 CSS：两个页面约 200 行够用，但后台组件一多就失控，且与 shadcn 不搭                                               |
| 前端组件         | **shadcn/ui（React / Radix）**                             | 后台要的 Table、Dialog、Toast、Form、Badge、Skeleton 都是现成可复制的组件；无障碍（键盘、焦点）由 Radix 兜底；coding agent 训练语料最多                                                      | 手写组件：重造轮子，且容易丢无障碍；Mantine/Ant Design：重、与 Tailwind v4 搭配的胶水多，不如 shadcn 轻                     |
| 前端数据         | **TanStack Query + React Hook Form + Zod**                 | 后台是服务端状态密集页：列表加载/错误重试/操作后自动刷新由 Query 管；确认收款、发货、改价/改政策的表单由 Hook Form + Zod 管，校验与后端共用 schema                                           | 手写 fetch + 手动刷 DOM：正是现在 `admin.js` 的写法，状态一多就乱                                                           |

**明确不引入**：Vue/Svelte、tRPC、Prisma、任何状态管理库（Zustand/Redux 等）、
任何 SPA 路由库（HonoX 文件路由已覆盖）。React 只出现在 HonoX 岛里，
不做整页 SPA；MCP/API 层不引 React。

### 2.1 HonoX 采用方式与风险（必读）

Hall 2026-11-11 定：前端走 HonoX。以下四条是写进计划的约束，
执行时不许绕过：

1. **HonoX 只接两个页面，不接 API**。后台 `/shops/:shop/admin/` 和
   上传页 `/shops/:shop/orders/:id/upload-proof` 走 HonoX 文件路由
   （`app/routes/`）；`/shops/:shop/mcp`、订单/商品/政策等 API、店铺静态
   文件路由继续留在 `src/` 里用代码挂载。`createApp()` 返回 Hono 实例，
   API 子应用用 `.route()` 挂上去——这条混合挂载能不能走通，是 Phase 0
   spike 必须验证的第一项（见 §2.2），验证不通过就停下来，不要硬迁 API。
2. **HonoX 还是 alpha（0.1.x，2026-11-11 查到最新 0.1.62）**：按 0ver
   语义，小版本内也可能有 breaking change。`package.json` 里 pin 死确切
   版本，升级只在单独 commit 里做并重跑 Phase 5 验收。不要用 `^0.1.x`。
3. **React 是 BYOR，不是官方默认支持**。HonoX 默认渲染器是 hono/jsx；
   官方文档明说自带渲染器“可能不提供支持”（We may not provide support
   for the renderer you bring）。所以 React 渲染器 + Tailwind + shadcn 这
   条链路必须在 Phase 0 spike 里先在 Workers 上跑通（登录→列表→确认收款
   一条线），跑不通就走兜底：**hono/jsx 岛 + shadcn-hono-jsx 移植版**，
   不要在 Phase 5 才发现 React 岛水合不了。
4. **Islands 铁律**（HonoX 已知坑，写进 AGENTS.md）：
   - 岛只能放在 `app/islands/` 或以 `$` 前缀命名；岛拿不到请求上下文，
     数据必须由路由文件以 props 传进去。
   - **绝不从一个岛里 import 另一个岛**（HonoX Issue #154：子岛会重复求值、
     状态重置）；共用逻辑抽到 `app/lib/`。
   - `<honox-island>` 默认是 `display: inline`，`style.css` 里必须有
     `honox-island { display: contents; }`，不要删。
   - React 岛与 hono/jsx 岛不混写：React 岛用 `className` + `react` 的 hooks；
     hono/jsx 岛用 `class` + `hono/jsx` 的 hooks。

### 2.2 Phase 0 决策点：部署走 wrangler 还是保留 cf.py + HonoX spike

现状：部署用 `cf.py worker-put`，因为 wrangler 用不了 vault 里的 token。
重构第一步先验证，不假设。Phase 0 包含两个验证，做完才进 Phase 1：

**（a）部署验证**

- 尝试 `CLOUDFLARE_API_TOKEN=<vault 换出的 token> npx wrangler deploy`
  （token 只进环境变量，不进文件、不进仓库）。
- **如果通**：wrangler 成为唯一部署路径；`wrangler.toml` 的 `[triggers]`
  由 deploy 直接应用（注意：免费版 5 个触发器上限，当前只有 1 个，
  deploy 不会超）；cf.py 退为 D1/R2 管理工具。
- **如果不通**：保留 `cf.py worker-put` + API 设触发器，在 AGENTS.md
  里写明原因；不要为了换工具而换工具，更不要把 token 写进仓库或脚本。

**（b）HonoX spike（新增，2026-11-11 Hall 定 HonoX 后补）**

在独立分支上搭一个最小 HonoX 应用（`npm create hono@latest` 选 `x-basic`
为起点，再换 React 渲染器），必须逐项跑通才算通过：

1. `createApp()` 返回的 Hono 实例能 `.route()` 挂载现有 API 子应用
   （至少挂一个 `/shops/:shop/mcp` 级别的路由），且 HonoX 文件路由
   （`app/routes/shops/[shop]/admin.tsx`）与 API 路由不冲突。
2. React 渲染器（`@hono/react-renderer`）+ 一个 React 岛在 Workers 上
   正常 SSR + 水合；Tailwind v4（`@tailwindcss/vite`）样式正常出；
   一个 shadcn/ui 组件（Dialog 或 Toast）能正常交互。
3. 两遍构建（`vite build --mode client && vite build`）+ Workers 产物
   （`@hono/vite-build/cloudflare-workers`）能部署到线上并跑通
   “登录 → 订单列表 → 点开详情 → 确认收款”一条线（可用测试订单）。
4. 产物大小与冷启动可接受：HonoX + React 会比现在 1.0 MB 的单文件 bundle
   大，记下实际大小；如果 Workers 免费版跑起来明显变慢，停下来找 Hall 定。

任一项不通过：先按 §2.1 第 3 条走兜底（hono/jsx 岛 + shadcn-hono-jsx），
兜底也不通则回 Phase 0 重新定前端方案，**不要带着未验证的选型进 Phase 5**。

两种结果都要在 README 里写清最终采用的部署命令。

#### Phase 0 结论（2026-11-11）

**（a）部署：通过 → 定稿 `wrangler deploy`**

- 本机没有 vault/`cf.py` 路径；用 `npx wrangler login`（OAuth）验证。
- `npm run build` + `npx wrangler deploy` 成功部署生产 Worker
  `agent-friendly-platform`：D1/R2 绑定正确，cron `* * * * *` 由 deploy 应用，
  `/health`、MCP `tools/list`、店铺 `llms.txt` 冒烟通过。
- 生产 Version ID（本次）：`c051a92a-df44-4fdb-8837-7a2d899426db`。
- cf.py 退为可选兜底（D1/R2 运维仍可用）；日常部署改走 wrangler。

**（b）HonoX spike：4 项全过 → React 渲染器路线可进 Phase 5**

- 代码在 `spike-honox/`（独立 Worker `agent-friendly-honox-spike`，不碰生产）。
- 混合挂载：`createApp({ trailingSlash: true })` + `app.route('/', api)`，
  `/shops/:shop/mcp` 与 `/shops/:shop/admin/` 共存无冲突。
  注意：生产路径带尾斜杠，HonoX 需 `trailingSlash: true`。
- React 岛 SSR + 水合、Tailwind v4、shadcn-style Dialog 线上可点：
  登录 → 列表 → 详情 Dialog → 确认收款（金额不符拒绝 / 相符变 paid）。
- 两遍构建 OK。产物（spike）：Worker upload **664 KiB / gzip 132 KiB**，
  startup **12 ms**（对比生产 esbuild 单包 ~1325 KiB / gzip 272 KiB / 32 ms）。
  可接受；完整后台 + MCP SDK 合包后体积会再涨，Phase 5 再记一笔。
- HonoX **pin `0.1.62`**（不写 `^`）。

## 3. 目标架构

### 3.1 分层规则（硬规则，写进 AGENTS.md）

```
HTTP 路由 (routes/) / MCP 工具 (mcp/)     ← 只做：解析输入、调服务、格式化输出
        ↓
服务层 (services/)                        ← 业务逻辑、状态机、金额、时限；不碰 HTTP
        ↓
数据层 (db/)                              ← Drizzle schema + 查询；不含业务规则
        ↓
D1 / R2
```

- 路由和 MCP 工具**不直接碰 D1/R2**，只调服务函数。
- 服务函数**不读 `c.req`、不构造 Response**，返回领域对象或抛领域错误。
- 错误统一：服务抛 `DomainError(code, message, status)`，HTTP 层和 MCP 层
  各自翻译成自己的错误形状（HTTP: `{error: {code, message}}`；
  MCP: `isError: true` + 文本）。
- 常量集中：时限（15 分钟、7 天）、金额（运费 12、免邮 200）、
  状态机、文件限制（5MB、图片类型）只定义一次，分别放在
  `domain/constants.ts` 和各服务的 schema 里，禁止散落魔法数字。
- 店铺事实（商品、价格、库存、政策、收款账号）的**唯一来源仍是
  `src/data/*.json`**；D1 是运行态的镜像，不是事实来源。
  改事实只改 `src/data`，再跑 seed/同步脚本写 D1。

### 3.2 目标目录结构

```
src/
  index.ts                  # 唯一入口：建 Hono app、挂路由、export scheduled
  env.ts                    # Env 类型（DB / PROOFS / 变量）
  domain/
    constants.ts            # 时限、金额、状态机、文件限制
    errors.ts               # DomainError + 常见错误
    order.ts                # 订单领域类型、状态机定义（纯类型 + 纯函数）
    money.ts                # 金额计算（totals，纯函数、可单测）
  db/
    schema.ts               # Drizzle schema（全部 14 张表，唯一事实）
    client.ts               # Drizzle 实例创建
    repositories/           # 按聚合拆：catalog.ts、orders.ts、proofs.ts、admin.ts
  services/
    catalog.ts              # 商品/政策/推荐（读）
    orders.ts               # 下单、改地址、取消、查单（调 transition）
    payments.ts             # 提交凭据、卖家核验、上传 token 发放/核销
    shipping.ts             # 发货、确认收货
    admin.ts                # 后台 key/session、商品政策管理
    jobs.ts                 # 定时任务：expireUnpaidOrders、autoCompleteShipped
  routes/
    shop.ts                 # 店铺静态文件 + 商品/政策等读接口
    orders.ts               # 订单事件公开接口
    mcp.ts                  # POST /shops/:shop/mcp（转调 mcp/）
    admin.ts                # 后台 API（页面移到 app/routes/shops/[shop]/admin.tsx）
    upload.ts               # 上传接口（页面移到 app/routes/shops/[shop]/orders/[id]/upload-proof.tsx）
    health.ts               # /health
  mcp/
    server.ts               # createMcpServer（注册表）
    tools/
      catalog.ts            # list_products / get_product / recommend / calculate_total
      orders.ts             # create_order / get_order / update_buyer_info / cancel_order
      payments.ts           # submit_payment_proof / get_payment_proof_upload_link / confirm_payment
      shipping.ts           # mark_shipped / confirm_receipt
  static/
    data.ts                 # 生成的静态文件 import map（生成器改写为 TS，见 §4.6）
  data/                     # 店铺事实（不动，仍是 JSON/Markdown）
app/                         # HonoX 前端（只含两个页面，见 §2.1；API 不进这里）
  server.ts                 # createApp() 入口：挂 app/routes + .route() 挂 src/ 的 API
  client.ts                 # 客户端入口（水合 islands）
  routes/
    _renderer.tsx           # reactRenderer：html 骨架 + Tailwind <Link>
    shops/
      [shop]/
        admin.tsx           # GET /shops/:shop/admin/（SSR 壳 + 岛）
        orders/
          [id]/
            upload-proof.tsx  # GET /shops/:shop/orders/:id/upload-proof（SSR 壳 + 岛）
  islands/
    admin/
      order-list.tsx        # 订单列表岛：筛选、分页、点开详情
      order-detail.tsx      # 订单详情岛：时间线、凭据放大、确认收款/发货/取消
      product-editor.tsx    # 商品改价/库存岛（行内编辑）
      policy-editor.tsx     # 政策/收款方式岛（行内编辑）
    upload/
      proof-form.tsx        # 上传表单岛：倒计时、文件预览、提交
      # 注意：岛之间不许互相 import（HonoX Issue #154），共用逻辑放 app/lib/
  components/
    ui/                     # shadcn/ui 组件（Button/Dialog/Toast/Table/Form/Badge/Skeleton）
  lib/
    api.ts                  # 前端 fetch 封装（鉴权头、超时、错误映射）
    format.ts               # 金额/时间格式化（纯函数）
  style.css                 # Tailwind v4 入口：@import "tailwindcss" source("../app") + honox-island { display: contents; }
drizzle/                    # drizzle-kit 生成的 migrations（接管 migrations/）
tests/
  unit/                     # Vitest：money、状态机、校验
  integration/              # Vitest workers-pool：服务 + 路由 + MCP（真 D1）
  smoke.ts                  # 上线后冒烟：TS 写的小脚本（替代 tests/test_client.py 的主流程）
scripts/
  seed.ts                   # 从 src/data 同步商品/政策/收款方式到 D1
  gen-data.ts               # 生成 src/static/data.ts（替代 gen_data_module.py）
  update-shop-facts.ts      # 改店铺事实的脚本（替代 update_shop_facts.py）
  gen-admin-keys.ts         # 生成后台 key（替代 gen_admin_keys.py）
```

### 3.3 兼容性红线

- 所有 HTTP 路由、MCP 工具名、入参、出参字段名**保持不变**
  （`payment_deadline`、`proof_upload`、`payment_expires_at` 等字段原样保留）。
- `src/data/` 里的店铺文件**内容不变**（版本号 1.7.0 保持到下一次功能发版，
  重构本身不 bump 版本）。
- D1 表结构不变（Drizzle schema 是现有 14 张表的精确映射，不是重新设计）；
  迁移文件由 drizzle-kit 从现有 schema 生成基线，之后的新迁移才走 drizzle-kit。
- `scheduled()` 行为不变（每分钟两项扫表）。

## 4. 模块重写清单

按阶段执行，每项做完都要通过 §8 的验收再进入下一项。

### 4.1 Phase 1 — 地基（先做，后面都依赖它）

| #   | 任务                                                                                                                                                            | 验收                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1.1 | TypeScript：全仓改 `.ts`，`strict: true`；esbuild 已支持 TS，构建脚本基本不动；修掉所有类型错误                                                                 | `npx tsc --noEmit` 通过；`npm run build` 产物与之前等价（/health、关键路由冒烟通过） |
| 1.2 | Biome 接入：`biome.json`，`npm run lint` / `npm run format`；全仓格式化一次（单独 commit，不混业务改动）                                                        | lint 零错误；格式化 commit 里只有空白/风格变化                                       |
| 1.3 | Phase 0 部署验证（§2.2（a））：wrangler deploy 是否走通；定稿部署命令，写进 README 和 AGENTS.md                                                                 | 明确结论 + 命令；线上版本不变                                                        |
| 1.4 | HonoX spike（§2.2（b））：最小 HonoX + React 渲染器 + Tailwind + shadcn 应用，验证混合挂载、岛水合、两遍构建、线上登录→列表→确认收款一条线；产物大小记入 README | spike 验收 4 项全过，或按 §2.1 走兜底并记录决策；**不通过不进 Phase 5**              |
| 1.5 | Vitest + workers-pool 搭架子：能跑一个最小集成测试（建 D1、seed、调一次服务）                                                                                   | `npm test` 本地通过，不依赖线上                                                      |

### 4.2 Phase 2 — 数据层（Drizzle）

| #   | 任务                                                                                                                      | 验收                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 2.1 | `db/schema.ts`：14 张表的 Drizzle schema，与现有 D1 结构逐字段对照                                                        | 与 `migrations/0001–0005` 的建表语句逐表核对无差异；`drizzle-kit check` 通过 |
| 2.2 | `db/repositories/*`：把 `db.js` 的纯查询按聚合拆开（catalog / orders / proofs / admin），签名不变、逻辑不变               | 现有 Python E2E 全过（行为未变）                                             |
| 2.3 | drizzle-kit 接管 migrations：从当前 schema 生成基线，`migrations/` 旧 SQL 归档为 `migrations/archive/`，README 写清新流程 | 新库从零 `migrate` 后与线上结构一致（表名、字段、索引逐项比对）              |
| 2.4 | seed 脚本改写为 TS（`scripts/seed.ts`）：读 `src/data`，写 D1；与旧 `seed.py` 输出逐行比对                                | 同一份 `src/data`，新旧脚本写入的 D1 内容一致                                |

### 4.3 Phase 3 — 服务层

| #   | 任务                                                                                                                                                                | 验收                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 3.1 | `services/orders.ts`：createOrder / getOrder / updateBuyerInfo / cancelOrder / transition；状态机收进 `domain/order.ts`（纯函数：允许的转移、是否可取消、是否过期） | 单元测试覆盖全部状态转移（含非法转移抛错）；E2E 全过             |
| 3.2 | `services/payments.ts`：submitPaymentProof / confirmPayment / 上传 token（发放/校验/核销）/ addImagePaymentProof；金额校验逻辑不变                                  | 单元测试覆盖：金额不符拒绝、无凭据拒绝、token 一次有效、过期拒绝 |
| 3.3 | `services/catalog.ts` / `services/shipping.ts` / `services/admin.ts`：按聚合拆；`totals` 移到 `domain/money.ts`（纯函数单测）                                       | 金额用例全过（68+12=80、128+12=140、免邮 200 边界）              |
| 3.4 | `services/jobs.ts`：expireUnpaidOrders / autoCompleteShipped；定时任务在 workers-pool 里可本地触发验证（不再等线上触发器同步）                                      | 本地测试：回拨时间的订单被取消、发货超 7 天的订单被完成          |
| 3.5 | 统一错误：`domain/errors.ts`；所有服务抛 DomainError；路由/MCP 翻译层单测                                                                                           | 错误形状快照测试通过                                             |

### 4.4 Phase 4 — 接入层（路由 + MCP）

| #   | 任务                                                                                                                        | 验收                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 4.1 | `routes/` 按领域拆 index.js；每个路由只做输入校验（zod）→ 调服务 → 输出                                                     | 路由表与重构前逐条比对（方法、路径、状态码、响应字段）                          |
| 4.2 | `mcp/tools/*`：13 个工具按领域拆文件；工具描述文字原样保留（agent 靠这些文字工作，一字不改）；handler 只做参数校验 → 调服务 | `tools/list` 输出与重构前逐项比对；TEST_PROMPTS.md 的 27 条 prompt 全部重跑通过 |
| 4.3 | 统一鉴权中间件：后台 API 的 `requireAdmin`、上传 token 校验收进 `routes/middleware.ts`（或 Hono 中间件），消除两处各自实现  | 未授权访问测试：无 key 401、无 token 拒绝、过期 token 拒绝                      |
| 4.4 | 静态文件：`src/static/data.ts` 生成器改写为 TS；店铺文件内容不动                                                            | 全部店铺路由与重构前逐字节比对（compare_routes.py 全过）                        |

### 4.5 Phase 5 — 前端重写（HonoX，两个页面，见 §5）

| #   | 任务                                                                                                                                                                            | 验收                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 5.1 | 上传页：`app/routes/shops/[shop]/orders/[id]/upload-proof.tsx`（SSR 壳）+ `app/islands/upload/proof-form.tsx`（倒计时、文件预览、提交）+ 共用 `_renderer.tsx` / `app/style.css` | §5 的验收清单全过；真机浏览器测试通过                                             |
| 5.2 | 后台页：`app/routes/shops/[shop]/admin.tsx`（SSR 壳）+ `app/islands/admin/` 四个岛（列表、详情、商品编辑、政策编辑）+ shadcn/ui 组件                                            | §5 的验收清单全过；真机浏览器测试通过（含登录失败、确认收款金额不符、发货、取消） |
| 5.3 | 删掉 `ADMIN_HTML` 模板字符串和 `page()` HTML 拼接；全仓 grep 确认没有残留的 HTML 模板字符串；同时删掉 `src/ui/`、`src/client/` 占位（如果 Phase 1–4 建过的话，以 `app/` 为准）  | `grep -r "ADMIN_HTML\|<!doctype" src/ app/` 零命中（测试除外）                    |
| 5.4 | 旧 Python 测试退役：`tests/test_client.py` / `test_admin.py` 改为仅上线后冒烟（或由 `tests/smoke.ts` 替代）；`compare_routes.py` 保留为比对工具直到 4.4 完成，之后可删          | `npm test` 不再依赖线上；冒烟脚本单独命令                                         |
| 5.5 | HonoX 回归：岛之间无互相 import（grep 检查）、`honox-island { display: contents; }` 在样式里、React 岛与 hono/jsx 岛不混写                                                      | 静态检查全过；Phase 0 spike 的验收项在完整版上重跑一遍                            |

### 4.6 Phase 6 — 收尾

| #   | 任务                                                                                                           | 验收                                      |
| --- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 6.1 | 脚本 TS 化：`update-shop-facts.ts`、`gen-admin-keys.ts`；删 Python 脚本；`scripts/` 只有 TS                    | 全仓无 `.py`（仓库外 cf.py 不算）         |
| 6.2 | 文档：README 按新结构重写（命令、目录、部署、测试）；设计文档追加一节（v2.0 架构）；AGENTS.md 更新为重构后状态 | 新 agent 按 README 从零到第一次部署不卡住 |
| 6.3 | 发版：版本号 1.7.0 → 2.0.0（重构发版，不是功能发版）；线上验证 + 盲测重跑；旧 bundle 保留回滚路径              | §8 验收全过                               |

## 5. 前端重写需求

两个页面：卖家后台（`/shops/:shop/admin/`）和付款截图上传页
（`/shops/:shop/orders/:id/upload-proof`），都走 HonoX：SSR 出首屏，
交互只在岛里水合。要求分两层：**体验要求**（用户感知）和
**实现要求**（代码约束）。后台体验不达标是这次改前端的直接原因
（2026-11-11 Hall：现在后台的裸表格 + `alert`/`confirm` 完全不合格，
好体验离不开 UI 框架）——§5.3 的验收按“能用的后台”写，不按“能跑的页面”写。

### 5.1 体验要求（两个页面通用）

- **状态永远清晰**：每个异步操作都有加载态；列表有空态；出错有可读的
  错误文案（不是 `alert`，不是裸 JSON）；成功操作有即时反馈
  （行内更新或轻提示）。
- **手机优先**：买家在手机上打开上传页；后台也在手机上能看能操作；
  按钮够大、表单不溢出、图片预览不撑破布局。
- **不丢上下文**：刷新不丢登录态（已有 session cookie，保留）；
  上传页刷新不丢已填内容（表单内容保留到提交成功）。
- **防呆**： destructive 操作（取消订单、改价）要点确认；金额输入框
  校验数字、提示与订单总额的对比；文件选择先在本地校验类型和大小
  （5MB），不合格当场提示，不发请求。
- **可访问性基础**：表单有 label、按钮有可读文本、焦点可见、颜色不是
  唯一的状态表达（状态徽标带文字）。

### 5.2 上传页（买家）

- 首屏一眼看到：店铺名、商品、应付金额、**付款截止倒计时**
  （15 分钟，从 `payment_expires_at` 算；过期后明确显示订单已取消、
  请重新下单，不再显示上传表单）。
- 付款方式下拉、金额输入（预填订单总额，可改）、交易单号（可选）、
  文件选择（显示文件名、大小、缩略图预览；可更换、可清除）。
- 提交后成功页：状态“待核验”、接下来会发生什么（一句话）、
  不用再来这里查。
- 失效态：链接用过/过期/订单已取消/已付款——各给一句话说明和下一步
  （重新取链接请联系 agent；订单已取消请重新下单）。

### 5.3 后台页（卖家）

- 登录：key 输入、错误提示“Key 不对，请检查后重试”、登录中状态。
- 订单列表：按状态筛选（全部/待付款/待核验/已付款/已发货/已完成/已取消）、
  显示订单号、商品、金额、买家、下单时间；点开详情。
- 订单详情：时间线（事件 + 时间）、凭据区（文字凭据显示交易单号和金额；
  图片凭据显示缩略图，点开放大）、买家信息、收货地址。
- 确认收款：输入框预填订单总额；金额与总额不符时当场提示并禁止提交
  （现在是服务端拒绝，前端要先拦住）；成功后状态即时变“已付款”。
- 发货：快递公司 + 单号；取消：填原因并确认；改商品价格/库存、改政策、
  改收款方式：行内编辑，保存/取消，保存失败显示原因、成功显示已保存。
- 列表刷新不丢筛选条件；操作失败不丢已填内容。
- 反馈用组件，不用浏览器原生弹窗：成功用 Toast、取消/ destructive 操作
  用 Dialog 确认、保存中按钮带加载态、列表加载用 Skeleton——
  `alert()` / `confirm()` 在新后台里不许出现。

### 5.4 实现要求（硬约束）

- 页面走 **HonoX 文件路由**（`app/routes/`），渲染器是 **React**
  （`@hono/react-renderer`，`app/routes/_renderer.tsx`）；交互组件是
  **React 岛**（`app/islands/`），样式是 **Tailwind v4 + shadcn/ui**——
  **禁止把 HTML/CSS/JS 拼进模板字符串**。
- 不用内联 `onclick` / `onchange`；交互一律用 React 组件 + TanStack Query
  （服务端状态）+ React Hook Form + Zod（表单校验）。
  v1.2.0 的 data-attribute + 事件委托模式随 `admin.js` 一起退役，
  不再作为新前端的模式。
- 岛只做：读 props、调 API（`app/lib/api.ts` 统一封装：鉴权头、超时、
  错误映射、JSON 解析失败处理）、渲染结果；不拼业务规则
  （金额、时限、状态机的判断在服务端）。
- 岛之间**不许互相 import**（HonoX Issue #154）；共用逻辑放 `app/lib/`；
  React 岛与 hono/jsx 岛不混写；`honox-island { display: contents; }`
  必须保留在样式里。
- 每个页面改动后必须：`npx tsc --noEmit` 通过 + 真机浏览器点一遍
  （登录、主流程、一个失败分支）。只测 API 不算验证通过。

## 6. 横切关注点

### 6.1 鉴权与安全

- 后台：API key（SHA-256 存 D1）+ session cookie 机制保留，收进统一中间件；
  图片接口必须走鉴权（已验证 401），重构后重测。
- 上传 token：一次有效、7 天过期、只存哈希——机制不变，收进 payments 服务。
- MCP 的 confirm_payment / mark_shipped 仍无鉴权（本次非目标，见 §0.3），
  但要在代码注释和文档里保留这句警告，不要在重构中“顺手”把它藏起来。
- 永远不在聊天里要卡号/验证码/支付密码；卖家收款账号只在订单结果里出现。
- 密钥、token 不进仓库、不进日志、不进测试快照。

### 6.2 错误与日志

- 服务层只抛 `DomainError`；HTTP 层统一翻译；MCP 层统一翻译。
- 定时任务每次执行记结构化日志（扫到几单、取消几单、完成几单、耗时）；
  失败要重试一次并记错，不要静默吞掉。
- 客户端错误（fetch 失败、JSON 解析失败）要给用户可读文案，不要裸 `Error`。

### 6.3 配置与常量

- 时限、金额、文件限制只定义一次（`domain/constants.ts`），
  测试引用同一份常量，禁止在测试里手写 15 / 7 / 12 / 200。
- 环境变量（D1、R2、Workers 子域名）只从 `env` / `wrangler.toml` 读，
  不 hardcode 到业务代码里（现有 `BASE` 常量要收进 env）。

### 6.4 已知平台约束（重构不许踩的坑）

- 账号是 **Workers 免费版**：cron 触发器上限 **5 个/账号，已满**。
  本 Worker 只能有 1 个触发器（当前是每分钟 `* * * * *`）；
  `wrangler deploy` 如果尝试加触发器会失败——`wrangler.toml` 保持 1 个。
- **cron 触发器新建/修改后同步要等约 15 分钟**才会第一次触发
  （v1.7.0 实测）；不要用“刚建完就测试”来判断触发器坏了。
- D1 `/batch` 在该账号上 404：写 D1 一次只调一条语句（见 cf.py 的实现）。
- Worker 上传要用 `application/javascript+module` + 文件名 `worker.mjs`
  （cf.py 已处理；走 wrangler 时由 wrangler 处理）。
- workers.dev 有 Browser Integrity Check：自动化客户端要带浏览器 UA。
- MCP 里没有图片上传（v1.6.0 已用链接方案解决，重构不许改回读图方案）。
- **HonoX（alpha 0.1.x，pin 死版本）**：React 是 BYOR，官方不保证支持——
  React 渲染器链路必须先在 Phase 0 spike 跑通；岛之间不许互相 import
  （Issue #154）；`honox-island { display: contents; }` 不许删；
  API/MCP 不迁文件路由（§2.1）。

## 7. 数据与迁移

- D1 表结构不变；Drizzle schema 是现有结构的精确映射。
- drizzle-kit 从当前 schema 生成基线迁移；旧 `migrations/000*.sql`
  移到 `migrations/archive/` 备查，不再执行。
- 切换步骤：新 schema 在**本地 D1**验证通过 → 部署到线上 Worker →
  用线上冒烟验证读写 → 旧 SQL 归档。任何一步失败都停在原地，
  线上 D1 不动。
- 订单、凭据、后台 key 的数据零丢失；不做任何 `DROP` / 重建表操作。
- seed 数据（商品/政策/收款方式）仍从 `src/data` 来；seed 脚本改写后
  要与旧脚本输出逐行比对一致。

## 8. 测试与验收

### 8.1 测试金字塔（重构后）

- **单元测试**（Vitest，不碰网络）：金额计算、状态机、zod 校验、
  错误翻译、时限计算。目标：核心纯函数 100% 覆盖。
- **集成测试**（Vitest + workers-pool，真 D1）：每个服务函数的正常 +
  失败分支；每条路由的正常 + 401/404/400；每个 MCP 工具的正常 +
  参数错误；定时任务本地触发（回拨时间造过期订单）。
- **线上冒烟**（部署后）：`tests/smoke.ts` 跑一遍主流程
  （下单 → 付款凭据 → 核验 → 发货 → 完成）+ 一次上传链接流程；
  再加 `tools/list` 13 个工具核对。
- **盲测**（保持）：TEST_PROMPTS.md 的 prompt 1–27 在新版本上重跑一遍
  （至少覆盖 8、15、18、25、26、27）；后台页真机浏览器点一遍。

### 8.2 每个阶段的完成标准

- 该阶段的自动化测试全过（`npm test`）。
- 线上冒烟通过（部署后）。
- 该阶段不改变任何对外行为（路由表、工具列表、店铺文件逐项比对无差异）。
- 文档同步更新（README / AGENTS.md / 本文件状态）。

### 8.3 整体完成标准（v2.0 发版）

- 全部阶段验收通过；`npm test` + 冒烟 + 盲测全过。
- 全仓无 `.py`、无 HTML 模板字符串、无 `// TODO: refactor` 残留。
- 新 agent 按 README 从克隆到第一次本地测试通过，不需要问人。
- 版本号 2.0.0 上线，旧 bundle 保留回滚路径（见 §9）。

## 9. 执行计划与回滚

### 9.1 顺序（按 §4 的 Phase 1–6，不许跳阶段）

Phase 1 地基 → Phase 2 数据层 → Phase 3 服务层 → Phase 4 接入层 →
Phase 5 前端 → Phase 6 收尾。每个 Phase 是一个或多个小 commit，
每个 commit 只做一件事；**重构 commit 里不许混行为改动**，
行为改动（如果必须）单独 commit 并写清原因。

### 9.2 部署与回滚

- 每个 Phase 结束都可以独立部署到线上 Worker；部署后跑 §8.1 的冒烟。
- 回滚 = 重新部署上一个版本的 bundle（保留每次部署的 deployment_id，
  见 README 的发版记录）+ 必要时 `git revert` 对应 commit。
- D1 不做破坏性迁移，所以回滚不需要动数据库。

### 9.3 检查点

- Phase 1 结束：Hall 确认部署命令定稿（wrangler 还是 cf.py）+ HonoX spike
  结论（React 渲染器走通，或走 §2.1 兜底）。
- Phase 4 结束：Hall 确认对外契约无变化（工具列表 + 路由表比对报告）。
- Phase 5 结束：Hall 在真机上点一遍后台和上传页，确认体验。
- Phase 6 结束：v2.0 发版。

## 附录 A：重构期间不动的业务规则

（coding agent 改代码前先读这张表；这些规则来自已验证的线上行为，
重构不许“优化”掉任何一条。）

- 店铺：bean-bloom（咖啡，Yirgacheffe 68 / Cold Brew 88 / Decaf 72 缺货）、
  paper-lantern（文具，notebook 38 / pen 18 / washi 25）、
  terra-pots（陶土，mug 128 / plate 98 / vase 158），全部 CNY。
- 政策：运费 12 元，满 200 免邮，2 个工作日发货，7 天无理由退货
  （未使用、买家付退货运费）。
- 订单状态机：pending_payment → payment_submitted → paid → shipped →
  completed；cancelled 只能从 pending_payment / payment_submitted 取消。
- 下单必填收货地址（工具层硬性校验，无例外）；姓名/联系方式可选；
  地址错了发货前可用 update_buyer_info 改。
- 付款线下：agent 发收款方式（含卖家收款账号）后买家在 Agent 外付款；
  凭据两种：交易单号（文字）或截图（一次性上传链接，图片直达 R2，
  agent 不读图）；交了凭据才开始跟踪（每 6 小时查一次，直到完成/取消）。
- 卖家核验是真的：confirm_payment 要求状态 payment_submitted、有凭据、
  核验金额等于订单总额，否则拒绝。
- 未付款 15 分钟自动取消（只扫 pending_payment）；发货满 7 天未确认自动完成。
- 后台 key 是每店一个 API key（SHA-256 存 D1），明文只给过 Hall 一次，
  **不许存进仓库、记忆或代码**；丢了就重新生成。
- 测试数据：D1 里的订单全是测试单，交易单号全是测试号；不要当成真实订单处理。

## 附录 B：现状文件地图（重构前）

```
cf-shop/
  src/index.js        入口：路由 + scheduled（待拆，§4.4）
  src/db.js           数据 + 业务（待拆，§4.2/4.3）
  src/mcp.js          13 个 MCP 工具（待拆，§4.4）
  src/admin.js        后台 API + 模板字符串页面（待拆，§4.5）
  src/proof_upload.js 上传页 + 接口（待拆，§4.5）
  src/data.js         生成的 import map（生成器待改写，§4.4）
  src/data/           店铺事实（不动）
  migrations/         0001–0005（待 drizzle-kit 接管，§4.2）
  tests/              Python 线上 E2E（待 Vitest 替代，§4.5）
  scripts/            Python 运维脚本（待 TS 化，§4.6）
  wrangler.toml       绑定 + 触发器（1 个）
  package.json        1.7.0
```
