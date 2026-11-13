---
name: deploy-verify
description: >-
  Build, deploy, and verify agent-friendly-platform on Cloudflare Workers.
  Use after code changes that need a live check, before claiming deploy success,
  or when rolling back via Version ID.
---

# Deploy + online verify

对外契约不动。部署成功 ≠ 验收通过：必须读线上实际返回。

## When to use

- Phase 完成、准备上线
- 修线上 bug 后验证
- 回滚到上一 Version ID 后确认

## Steps

1. **本地先过门禁**（部署前）

   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```

   任一失败：停，不要 deploy。

2. **记下当前线上 Version ID**（回滚用）

   ```bash
   npx wrangler deployments list
   ```

   把当前 Version ID 记进对话或 PR 描述；部署后若坏了，靠它回滚。

3. **部署**

   ```bash
   npx wrangler deploy
   ```

   需已 `npx wrangler login`。成功后记下**新** Version ID。  
   默认路径是 wrangler；`cf.py worker-put` 仅兜底，不要当日常路径。

4. **线上冒烟（带浏览器 UA）**

   优先：

   ```bash
   npm run test:smoke
   ```

   Base：`https://agent-friendly-platform.refined-x.workers.dev`  
   workers.dev 有 Browser Integrity Check，curl 必须带 UA。

   最少读这些实际响应（不要只看 HTTP 200）：

   | 检查 | 命令要点 |
   | --- | --- |
   | health | `GET /health` |
   | 店铺发现 | `GET /shops/bean-bloom/llms.txt` |
   | MCP 工具 | `POST /shops/bean-bloom/mcp` → `tools/list`，确认 13 个工具名 |
   | 后台页 | `GET /shops/bean-bloom/admin` → HTML 含 HonoX 岛 / `admin-shell` |
   | 静态契约 | 需要时跑 parity-check skill |

   示例：

   ```bash
   UA='Mozilla/5.0 (agent-friendly-platform-test)'
   BASE='https://agent-friendly-platform.refined-x.workers.dev'
   curl -sS -H "User-Agent: $UA" "$BASE/health"
   curl -sS -H "User-Agent: $UA" "$BASE/shops/bean-bloom/llms.txt" | head
   ```

5. **前端改动额外要求**

   - `npx tsc --noEmit` 不够
   - 真机浏览器点：登录、主流程、一个失败分支
   - 只测 API 不算通过（见 `AGENTS.md` / `docs/refactor-plan.md` §5）

6. **汇报格式**

   - 新 Version ID（写入 [`README.md`](../../../README.md) **发版记录**表）
   - 冒烟里实际看到的关键字段（health、tools 数量、页面是否可交互）
   - Pages/边缘有同步延迟时：**明说未刷出来**，不要硬报成功
   - 失败：给回滚命令（redeploy 上一 Version ID），不要继续叠补丁瞎试

## Rollback

```bash
# 用步骤 2 记下的旧 Version ID；具体子命令以当前 wrangler 为准
npx wrangler rollback
# 或重新 deploy 旧产物 / 指定 previous deployment
```

D1 不做破坏性迁移时，回滚 Worker 即可；不要为了回滚去动线上订单数据。

## Do not

- 把密钥、admin key、token 写进命令历史说明或仓库
- 在免费账号上新增 cron 触发器（上限已满，本 Worker 只能 1 个）
- 宣称「构建成功所以线上 OK」
