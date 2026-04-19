# 03 — Cloudflare-Native Rewrite

## Goal

把 dove 从 **Next.js 16 on Railway + 2 个外挂 Worker** 重写为 **纯 Cloudflare 原生应用**，利用 CF 平台能力优化基础设施层，同时 **严格保持现有 webhook 契约不变**。

| CF 能力 | 用途 |
|---|---|
| **Workers** | 统一运行时：API + 静态资产 + 邮件发送 |
| **D1** | 关系型数据（projects / recipients / templates / send_logs / webhook_logs） |
| **KV** | 会话存储（替代 NextAuth session） |
| **R2** | 模板资产 / 长期归档（可选） |
| **Email Routing** | CF 原生 SMTP 发送（`env.EMAIL`） |
| **Workers Static Assets** | SPA 静态托管（Vite 产物） |

部署收敛到 `wrangler deploy` 一条命令。

### 核心约束

**业务行为完全保持不变**——01-architecture.md 与 design/multi-provider-email.md 仍是单一权威源：

- `/api/webhook/{projectId}/send` **同步返回**：
  - 成功 200 `{ id, resend_id, provider_message_id, provider_type, status: "sent" }`
  - Provider 失败 502 `{ error: { code: "resend_failed"|"cloudflare_failed", message } }`
- **幂等语义**：`send_logs` 在发送前写入 `status: 'sending'`，发送后更新为 `sent`/`failed`；重复请求返回 409 `send_in_progress` 或复用已有记录
- **配额模型**：soft limit，按 `send_logs.status = 'sent'` 和 `sent_at` 的 UTC 窗口计数，失败发送不占额度
- **webhook_logs**：保留 D1 表 + 分页 API，fire-and-forget 写入（现有实现已是异步）

本文只描述"换骨"的技术路径——把应用从 Railway 搬到 CF Worker，删除 D1 proxy 和邮件 proxy。

---

## Design Principles

1. **契约优先**：外部调用方行为不能有任何可观察变化
2. **原生优先**：直接使用 CF binding 替代 HTTP proxy 层
3. **边缘优先**：所有逻辑跑在 Worker，无中心化服务器
4. **单一部署面**：一个 `wrangler.toml`，一个 `wrangler deploy`
5. **渐进增强**：先完成等价迁移，再考虑架构升级（Queues / DO / AE 等作为 Phase 2）

---

## Why Rewrite (Not Migrate)

现状的痛点都来自"app 在 Railway、数据在 CF"这条边界：

| 痛点 | 现在 | 重写后 |
|---|---|---|
| 数据库延迟 | Railway → HTTPS → `dove.worker.hexly.ai` → D1，每次查询经过北美往返 | Worker 内 `env.DB` 原生 binding，sub-millisecond |
| 邮件发送 | Railway → HTTPS → `dove-email.worker.hexly.ai` → CF Email | 同进程直接 `env.EMAIL.send()` |
| 部署 | Railway 镜像构建 + 2 套 wrangler env | 单 `wrangler deploy`（含 `[env.test]`） |
| 冷启动 / 成本 | Railway 常驻 + 2 个 Worker | 全 Worker，按请求计费 |
| 鉴权链 | NextAuth v5 + `proxy.ts` 自维护的 host/cookie 逻辑 | Hono OAuth + KV session |
| 测试隔离 | 必须维护 prod/test 两套 worker URL 与 API_KEY | 回归到 wrangler `[env.test]` 原生模型 |

**结论**：D1 proxy Worker（`worker/`）的存在唯一原因是"Railway 无法直接 binding D1"。一旦应用搬到 Worker，这一层就该被删除。

---

## Target Stack

| 层 | 选型 | 备注 |
|---|---|---|
| **运行时** | Cloudflare Workers | `compatibility_date` 取最新 |
| **框架** | Hono | Worker HTTP 框架，TS 一等公民 |
| **前端** | Vite 7 + React 19 + React Router v7 | SPA 形态，Workers Static Assets 服务 |
| **UI** | Tailwind CSS v4 + shadcn/ui | 保持现有 basalt 风格 |
| **图表** | Recharts | 不变 |
| **校验** | Zod v4 | 不变 |
| **鉴权** | `@hono/oauth-providers` (Google) + KV session | 替换 NextAuth v5 |
| **关系数据** | D1 | projects / recipients / templates / send_logs / webhook_logs / email_providers |
| **会话存储** | KV | session token → user info，TTL 7 天 |
| **对象存储** | R2 | 模板资产 / 长期归档（可选） |
| **邮件发送** | Resend HTTP + CF Email Routing | 双 provider 架构保留 |
| **模板渲染** | marked | 不变 |
| **ID 生成** | nanoid | 不变 |
| **部署** | `wrangler deploy` | 单 worker；`[env.test]` 给 L2/L3 |
| **域名** | `dove.hexly.ai` | custom domain route |

> **不选 OpenNext for Cloudflare**：走 Hono + Vite SPA 路线，更薄的栈。

---

## Architecture

```
                                    Cloudflare Edge
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   Browser ──────► Worker (dove)                                             │
│                     │                                                       │
│                     ├─► Hono Router                                         │
│                     │    ├─ GET  /              ──► Static Assets (Vite)   │
│                     │    ├─ GET  /assets/*      ──► Static Assets          │
│                     │    ├─ /api/auth/*         ──► OAuth (Google) → KV    │
│                     │    ├─ /api/projects ...   ──► Session APIs → D1      │
│                     │    ├─ /api/webhook/*      ──► Bearer APIs → D1       │
│                     │    │    │                                             │
│                     │    │    ├─ 1. Auth check (Bearer token)               │
│                     │    │    ├─ 2. Idempotency check (D1 send_logs)        │
│                     │    │    ├─ 3. Quota check (D1 COUNT, soft limit)      │
│                     │    │    ├─ 4. Validate recipient + template           │
│                     │    │    ├─ 5. Write send_logs (status: 'sending')    │
│                     │    │    ├─ 6. Send email (Resend / CF Email)          │
│                     │    │    ├─ 7. Update send_logs (status: sent/failed)  │
│                     │    │    ├─ 8. Fire-and-forget webhook_logs            │
│                     │    │    └─ 9. Return 200 { id, provider_message_id }  │
│                     │    │                                                  │
│                     │    └─ /api/live           ──► Health (D1 ping)        │
│                     │                                                       │
│                     └─► Bindings                                            │
│                          ├─ DB            : D1 (dove-db)                    │
│                          ├─ KV            : KV namespace (sessions)         │
│                          ├─ BUCKET        : R2 (optional, assets/archive)   │
│                          ├─ EMAIL         : send_email binding              │
│                          └─ Secrets       : AUTH_SECRET, GOOGLE_*,          │
│                                             RESEND_API_KEY, ...             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 关键数据流：同步邮件发送（保持不变）

```
POST /api/webhook/{projectId}/send
Authorization: Bearer <token>
{
  "template": "welcome",              // template slug (not template_id)
  "to": "user@example.com",           // email or recipient ID
  "idempotency_key": "unique-key",    // optional
  "variables": { "name": "Alice" }    // optional
}

     │
     ▼
┌─────────────────┐
│  1. Auth check  │  Bearer token → D1 project lookup
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  2. Idempotency │  D1: SELECT FROM send_logs WHERE idempotency_key = ?
│     check       │  → status='sent': 返回已有记录 (200)
│                 │  → status='sending': 返回 409 send_in_progress
│                 │  → status='failed': 复用记录重试
│                 │  → payload_hash 不匹配: 返回 409 idempotency_payload_mismatch
└────────┬────────┘
         │ (new request or retry failed)
         ▼
┌─────────────────┐
│  3. Quota check │  D1: SELECT COUNT(*) FROM send_logs
│                 │       WHERE status = 'sent' AND sent_at IN UTC window
│                 │  (soft limit, best-effort)
└────────┬────────┘
         │ (under quota)
         ▼
┌─────────────────┐
│  4. Validate    │  recipient whitelist, template exists, render markdown
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  5. Write       │  D1: INSERT send_logs (status: 'sending')
│    sending      │  → Layer 1 幂等保证 (UNIQUE on idempotency_key)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  6. Send email  │  Resend HTTP or CF Email (based on provider config)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  7. Update log  │  D1: UPDATE send_logs SET status = 'sent'/'failed'
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  8. webhook_log │  D1: INSERT webhook_logs (fire-and-forget, void)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  9. Return 200  │  {
│                 │    id: "send_log_id",
│                 │    resend_id: "re_xxx" | null,  // null for cloudflare
│                 │    provider_message_id: "...",
│                 │    provider_type: "resend" | "cloudflare" | "legacy",
│                 │    status: "sent"
│                 │  }
└─────────────────┘

失败路径:
- Provider 失败 → 502 { error: { code: "resend_failed"|"cloudflare_failed", message: "..." } }
- 配额超限 → 429 { error: { code: "quota_daily_exceeded"|"quota_monthly_exceeded", message: "..." } }
- 幂等冲突 → 409 { error: { code: "send_in_progress"|"idempotency_payload_mismatch", message: "..." } }
- 收件人不存在 → 404 { error: { code: "recipient_not_found", message: "..." } }
- 模板不存在 → 404 { error: { code: "template_not_found", message: "..." } }
- 变量校验失败 → 422 { error: { code: "variables_invalid", message: "..." } }
```

这与 01-architecture.md 中的 12 步 pipeline 完全一致，只是基础设施从 "Railway + D1 proxy" 变为 "Worker + D1 native binding"。

---

## Bindings Summary

```toml
# wrangler.toml

name = "dove"
main = "src/server/index.ts"
compatibility_date = "2026-04-01"

# Static assets (Vite build output)
[assets]
directory = "./dist/client"
not_found_handling = "single-page-application"

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "dove-db"
database_id = "2a8b6614-2c00-4891-863e-df80d22a2421"

# KV Namespace (sessions)
[[kv_namespaces]]
binding = "KV"
id = "<kv-namespace-id>"

# R2 Bucket (optional)
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "dove-assets"

# Email
[send_email]
name = "EMAIL"

# Environment: test
[env.test]
[[env.test.d1_databases]]
binding = "DB"
database_name = "dove-db-test"
database_id = "1adca6ff-076f-45ff-a4d6-a1fdae9397ea"

[[env.test.kv_namespaces]]
binding = "KV"
id = "<kv-namespace-id-test>"

[[env.test.r2_buckets]]
binding = "BUCKET"
bucket_name = "dove-assets-test"
```

---

## What Goes Away

重写后从仓库消失：

- `worker/`（D1 proxy Worker） → 删，直接用 `env.DB`
- `worker-email/` → 合并进主 Worker，直接用 `env.EMAIL`
- `src/lib/db/d1-client.ts` 的 HTTP fetch + retry 层 → 替换为 D1 native binding
- `src/proxy.ts`（Next.js 16 auth proxy） → 删
- `src/auth.ts`（NextAuth v5 配置） → 由 Hono OAuth + KV session 替代
- `Dockerfile`、`railway.json` → 删
- `next.config.*`、`next-env.d.ts`、所有 Next.js 形态 → 删
- `scripts/deploy-test-worker.ts` / `scripts/verify-test-db.ts` → 删（回归 wrangler env）

保留并迁移：

- `src/lib/db/{projects,recipients,templates,send-logs,webhook-logs,email-providers}.ts` — 业务函数签名不变，只改底层 D1 调用方式
- `src/lib/email/{provider,providers/*,render,quota}.ts` — 见下方 Cloudflare Provider 迁移说明
- `src/lib/{id,pagination,sanitize,version}.ts` — 直接搬
- `src/components/**` — 直接搬到 Vite 项目下
- `src/lib/db/schema.ts` — **完整保留**，包括 `webhook_logs` 表

---

## Cloudflare Provider Migration

当前 `CloudflareProvider` 通过 HTTP 调用 `worker-email/` Worker：

```typescript
// 现有实现 (src/lib/email/providers/cloudflare.ts)
export class CloudflareProvider implements EmailProvider {
  constructor(
    private readonly workerUrl: string,  // 来自 email_providers.config.worker_url
    private readonly apiKey: string,     // 来自 email_providers.config.api_key
  ) {}

  async send(params: SendParams): Promise<SendResult> {
    const response = await fetch(`${this.workerUrl}/send`, {
      headers: { "X-API-Key": this.apiKey, ... },
      ...
    });
    ...
  }
}
```

重写后改为直接使用 `env.EMAIL` binding：

```typescript
// 重写后 (src/server/lib/email/providers/cloudflare.ts)
import type { SendEmail } from "cloudflare:email";

export class CloudflareProvider implements EmailProvider {
  constructor(
    private readonly emailBinding: SendEmail,
    private readonly idempotencyDb: D1Database,  // 用于 Layer 2 幂等
  ) {}

  async send(params: SendParams): Promise<SendResult> {
    // Layer 2 幂等检查 (原 worker-email 的逻辑)
    const existing = await this.checkIdempotency(params.idempotencyKey);
    if (existing) return existing;

    // 直接调用 CF Email binding
    const message = createMimeMessage(params);
    await this.emailBinding.send(message);

    // 写入幂等记录
    const id = await this.recordSent(params.idempotencyKey);
    return { id };
  }
}
```

### 关键迁移点

| 组件 | 现有 | 重写后 |
|---|---|---|
| `email_providers.config` schema | `{ worker_url, api_key }` | `{ type: "cloudflare" }`（不再需要 URL/key，binding 在 wrangler.toml） |
| Provider 工厂 | `new CloudflareProvider(config.worker_url, config.api_key)` | `new CloudflareProvider(c.env.EMAIL, c.env.DB)` |
| Provider 构造 | 无状态，可复用 | **需要 request-scoped env**，每次请求从 `c.env` 获取 |
| Layer 2 幂等 | `worker-email/` 里的 D1 表 `cf_email_idempotency` | 合并进主 Worker，同一个 `env.DB` |
| 现有 DB 记录 | `email_providers` 表有 `config: { worker_url, api_key }` 的记录 | 需要迁移脚本更新 config 字段，或保持兼容（忽略旧字段） |

### Provider CRUD 影响

1. **创建 Cloudflare provider**：UI 不再需要输入 `worker_url` / `api_key`
2. **编辑 Cloudflare provider**：只需要 `domain` 字段（发件域）
3. **校验逻辑**：`parseProviderConfig()` 需要兼容旧格式 + 新格式
4. **工厂模式**：`createProvider()` 签名需要接受 `env` 参数

```typescript
// 重写后的 createProvider
export async function createProvider(
  config: ProviderConfig,
  env: Env,  // 新增：request-scoped env
): Promise<EmailProvider> {
  switch (config.type) {
    case "resend":
      return new ResendProvider(config.api_key);
    case "cloudflare":
      return new CloudflareProvider(env.EMAIL, env.DB);
  }
}
```

### 数据迁移

现有 `email_providers` 表中 `type='cloudflare'` 的记录：

```sql
-- 现有数据
{ "worker_url": "https://dove-email.worker.hexly.ai", "api_key": "xxx" }

-- 迁移后（兼容模式：保留旧字段，新代码忽略）
{ "worker_url": "https://...", "api_key": "xxx" }  -- 旧字段被忽略

-- 或清理迁移
{ }  -- 空 config，type='cloudflare' 足够标识使用 binding
```

**推荐兼容模式**：旧字段保留不删，`parseProviderConfig()` 对 cloudflare 类型直接返回 `{ type: "cloudflare" }`，忽略 `worker_url`/`api_key`。这样无需数据迁移脚本。

---

## Repository Layout (Target)

```
dove/
├── wrangler.toml              # 单 worker，含 [env.test]
├── package.json
├── vite.config.ts             # 客户端构建
├── tsconfig.json
├── src/
│   ├── server/
│   │   ├── index.ts           # Worker entry: Hono app
│   │   ├── env.ts             # Env 类型 (D1, KV, R2, Email, secrets)
│   │   ├── middleware/
│   │   │   ├── auth-session.ts   # KV session check
│   │   │   └── auth-bearer.ts    # webhook bearer check
│   │   ├── routes/
│   │   │   ├── auth.ts        # /api/auth/google/*
│   │   │   ├── projects.ts
│   │   │   ├── recipients.ts
│   │   │   ├── templates.ts
│   │   │   ├── providers.ts
│   │   │   ├── send-logs.ts
│   │   │   ├── webhook-logs.ts   # 保留分页 API
│   │   │   ├── stats.ts
│   │   │   ├── webhook.ts        # 同步发送，保持现有契约
│   │   │   └── live.ts
│   │   ├── lib/
│   │   │   ├── db/            # D1 CRUD (native binding)
│   │   │   ├── email/         # provider 层 (保持现有逻辑)
│   │   │   ├── id.ts
│   │   │   ├── pagination.ts
│   │   │   ├── sanitize.ts
│   │   │   └── version.ts
│   │   └── schema.sql         # 完整 schema (含 webhook_logs)
│   └── client/
│       ├── main.tsx
│       ├── routes/
│       ├── components/
│       ├── hooks/
│       ├── lib/api.ts
│       └── styles/globals.css
├── scripts/
├── e2e/
└── docs/
```

---

## Cutover Plan (Branch: `cf-rewrite`)

每一步都是一个独立 commit，可单独 review、回滚。

### Phase A — Scaffold（1–2 天）

1. 新建 `src/server/index.ts`：最小 Hono app，`GET /api/live`
2. 新建 `wrangler.toml`：DB, KV, EMAIL bindings
3. `wrangler dev` + `wrangler deploy --dry-run` 通过
4. 新建 `src/client/`：Vite + React 19 骨架
5. 验证 SPA + `/api/live` 可访问

### Phase B — Data Layer（1 天）

6. `src/server/lib/db/d1.ts`：薄包装 `c.env.DB`
7. 迁移 `projects/recipients/templates/send-logs/webhook-logs/email-providers.ts`
8. `schema.sql`：完整 schema（**保留 webhook_logs**）

### Phase C — Auth（1 天）

9. `src/server/middleware/auth-session.ts`：KV session
10. `src/server/routes/auth.ts`：Google OAuth + KV
11. `src/server/middleware/auth-bearer.ts`：Bearer token 校验
12. 客户端 `/login` 路由

### Phase D — API Routes（2–3 天）

13. `routes/projects.ts`（CRUD + token 重置）
14. `routes/recipients.ts`
15. `routes/templates.ts`
16. `routes/providers.ts`
17. `routes/send-logs.ts`（**分页 API 保留**）
18. `routes/webhook-logs.ts`（**分页 API 保留**）
19. `routes/stats.ts`
20. `routes/webhook.ts`（**核心**）：
    - **完全复制现有逻辑**：幂等检查 → 配额检查 → 发送 → 更新 send_logs → 同步返回
    - `send_logs.status` 使用 `'sending'`（不是 `'pending'`）
    - CloudflareProvider 从 HTTP proxy 改为直接 `env.EMAIL.send()`，见 Cloudflare Provider Migration 章节
    - Resend provider 不变
21. `routes/live.ts`

### Phase E — UI Migration（2–3 天）

22. 搬运 `src/components/**`
23. React Router 配置
24. 页面逐个迁移
25. **webhook-logs 页面保留分页 + 明细展开**

### Phase F — Quality（1–2 天）

26. L1 单测
27. L2 API E2E（Miniflare）
28. L3 Playwright
29. G1 + G2 hooks

### Phase G — Cutover（半天）

30. 创建生产 KV namespace
31. `wrangler deploy`
32. 执行 `schema.sql`
33. DNS 切换
34. Google Console 添加 callback URL
35. Railway 保留 7 天观测期

---

## D1 Strategy: Same DB

**决策**：复用现有 `dove-db`。

- 现有 schema 已是 idempotent
- `webhook_logs` 表保留，继续写入
- `send_logs` 作为权威发送历史和配额数据源，不删除

---

## Test Isolation

回到 Cloudflare 原生模型：

```toml
[env.test]
[[env.test.d1_databases]]
binding = "DB"
database_name = "dove-db-test"
database_id = "1adca6ff-076f-45ff-a4d6-a1fdae9397ea"
```

- L2：Miniflare 内存
- L3：`wrangler dev --env test`

---

## Public Contract Preservation

**必须逐字节兼容**：

| 契约 | 保持方式 |
|---|---|
| 请求体 `{ template, to, idempotency_key?, variables? }` | `template` 是 slug，不是 ID |
| 成功响应 `{ id, resend_id, provider_message_id, provider_type, status: "sent" }` | 同步发送，不改 202 |
| Provider 失败 502 `{ error: { code: "resend_failed"\|"cloudflare_failed", message } }` | 区分 provider 类型 |
| 幂等语义：`status='sending'` 时返回 409 `send_in_progress` | send_logs 先写 `sending`，发送前检查 |
| 幂等语义：payload hash 不匹配返回 409 `idempotency_payload_mismatch` | 同现有逻辑 |
| 配额超限 429 `{ error: { code: "quota_daily_exceeded", message } }` | SQL COUNT 逻辑不变 |
| `GET /api/webhook-logs` 分页 | D1 表 + limit/offset 保留 |
| 所有错误码字符串 | 逐字保留 |

---

## Risks & Mitigations

| 风险 | 影响 | 缓解 |
|---|---|---|
| OAuth 回调 URL 变更 | 登录失败 | cutover 前添加新 callback URL |
| KV session vs NextAuth | 会话失效 | 用户重新登录（可接受） |
| `env.EMAIL.send()` 行为差异 | CF 路径发送失败 | 上线前 smoke test |
| Worker CPU 限制 | 大模板失败 | marked 同步计算，远低于 50ms |
| 重写期间业务漂移 | branch 冲突 | main 冻结新功能 |

---

## Cost Estimation

| 资源 | 估算用量 | 月成本 |
|---|---|---|
| Workers requests | ~100k/月 | Free tier |
| D1 reads/writes | ~500k reads, ~10k writes | ~$0.50 |
| KV reads/writes | ~200k reads, ~20k writes | ~$0.50 |
| R2 storage | <1GB | Free tier |
| **Total** | | **< $5/月** |

---

## Definition of Done

- [ ] `wrangler deploy` 单命令出生产
- [ ] `dove.hexly.ai` 服务所有现有 UI 路由 + API 路径
- [ ] **`POST /send` 同步返回 200，契约不变**
- [ ] **幂等语义完全保留**
- [ ] **配额模型完全保留（soft limit, sent_at）**
- [ ] **webhook_logs 分页 API 完全保留**
- [ ] 6 维质量门禁全绿
- [ ] Railway 项目下线

---

## Out of Scope (Phase 1)

以下 CF 功能**不在本次重写范围内**，可作为 Phase 2 独立项目：

| 功能 | 潜在用途 | 为什么不在 Phase 1 |
|---|---|---|
| **Queues** | 异步邮件管道 | 会改变 webhook 契约（同步 → 异步） |
| **Durable Objects** | 强一致配额 | 现有 soft limit 模型是业务决策，DO 会改变语义 |
| **Analytics Engine** | 高吞吐日志 | 会改变 webhook_logs API 契约（分页 → 聚合） |

这些功能如果要引入，需要**先与调用方协商 API 变更**，不能作为"等价迁移"的一部分。

---

## Phase 2: Architecture Evolution (Future)

如果未来需要改变 webhook 契约，以下是可选方向：

### Option A: 异步模式（Breaking Change）

- `POST /send` → 202 `{ queued: true, tracking_id }`
- 调用方轮询 `GET /send-logs/{tracking_id}` 获取最终状态
- 需要：版本化 API（`/v2/webhook/...`）或调用方升级

### Option B: 强一致配额

- Durable Objects 替代 SQL COUNT
- 需要：明确"失败是否占额度"的新语义

### Option C: 日志聚合

- Analytics Engine 替代 webhook_logs D1 表
- 需要：UI 从分页明细改为时间范围聚合

**这些都是 Phase 2 的独立决策，不在本次重写范围内。**
