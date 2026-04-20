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
│                 │  → payload_hash 不匹配: 返回 422 idempotency_payload_mismatch
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
- 幂等冲突 → 409 send_in_progress / 422 idempotency_payload_mismatch
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

### 实现检查清单

迁移时必须同步修改以下组件，避免半迁移状态：

- [ ] `parseProviderConfig()` — cloudflare 类型忽略 `worker_url`/`api_key`
- [ ] `CloudflareProvider` 构造函数 — 接受 `env.EMAIL` + `env.DB`
- [ ] `createProvider()` — 签名加 `env` 参数
- [ ] `POST /api/providers` — cloudflare 类型不再校验 `worker_url`/`api_key`
- [ ] `PUT /api/providers/:id` — 同上
- [ ] Provider 创建/编辑 UI 表单 — cloudflare 类型隐藏 `worker_url`/`api_key` 字段
- [ ] `cf_email_idempotency` 表 — 合并进主 `schema.sql`

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

## Worker Naming

| Worker | 环境 | 域名 | KV Namespace |
|---|---|---|---|
| `dove` | 生产 | `dove.hexly.ai` | `dove` |
| `dove` + `[env.test]` | 测试（E2E） | `dove-test.hexly.ai` | `dove-test` |

重写完成后删除：
- `dove.worker.hexly.ai`（D1 proxy Worker）
- `dove-email.worker.hexly.ai`（邮件 Worker）

---

## Implementation Plan

直接在 main 分支重建。Railway 部署已切断，无需考虑迁移兼容性。每一步都是独立 commit。

### Phase 0 — Infrastructure Setup（手动）

在开始代码工作前，手动完成以下配置：

1. **创建 KV namespaces**
   ```bash
   wrangler kv:namespace create dove
   wrangler kv:namespace create dove-test
   ```

2. **Google Console 添加新 OAuth callback URLs**
   ```
   https://dove.hexly.ai/api/auth/google/callback
   https://dove-test.hexly.ai/api/auth/google/callback
   ```

3. **配置 DNS**（如果尚未配置）
   - `dove.hexly.ai` → CF Worker custom domain
   - `dove-test.hexly.ai` → CF Worker custom domain (env.test)

---

### Phase A — Scaffold

**C001** `wrangler.toml` + `src/server/env.ts`：Worker 配置和类型定义
- 所有 bindings（DB, KV, EMAIL）
- `[env.test]` 配置
- custom domain routes

**C002** `src/server/index.ts` + `src/server/lib/version.ts`：最小 Hono app
- `GET /api/live` 健康检查
- D1 连接验证

**C003** Vite + React 19 骨架
- `vite.config.ts`
- `src/client/main.tsx`
- `src/client/styles/globals.css`（Tailwind v4）

**C004** React Router v7 配置
- `src/client/routes/_layout.tsx`（AppShell 骨架）
- 路由配置文件

**C005** 验证 `bun run build && wrangler dev` 可访问 SPA + `/api/live`

---

### Phase B — Data Layer

**C006** `src/server/lib/db/d1.ts`：D1 native binding 薄包装
```typescript
export async function query<T>(db: D1Database, sql: string, params?: unknown[]): Promise<T[]>;
export async function queryOne<T>(db: D1Database, sql: string, params?: unknown[]): Promise<T | null>;
export async function execute(db: D1Database, sql: string, params?: unknown[]): Promise<D1Result>;
```

**C007** `src/server/lib/db/projects.ts`：项目 CRUD（从现有迁移）

**C008** `src/server/lib/db/recipients.ts`：收件人 CRUD

**C009** `src/server/lib/db/templates.ts`：模板 CRUD

**C010** `src/server/lib/db/send-logs.ts`：发送日志 CRUD

**C011** `src/server/lib/db/webhook-logs.ts`：Webhook 日志 CRUD

**C012** `src/server/lib/db/email-providers.ts`：Provider CRUD

**C013** `src/server/schema.sql`：完整 schema
- 现有所有表
- `cf_email_idempotency`（合并自 worker-email）

---

### Phase C — Auth

**C014** `src/server/lib/session.ts`：KV session 工具
```typescript
export async function createSession(kv: KVNamespace, email: string): Promise<string>;
export async function getSession(kv: KVNamespace, sessionId: string): Promise<SessionData | null>;
export async function deleteSession(kv: KVNamespace, sessionId: string): Promise<void>;
```

**C015** `src/server/middleware/auth-session.ts`：Session 校验中间件

**C016** `src/server/routes/auth.ts`：Google OAuth 路由
- `GET /api/auth/google` → 跳转 Google
- `GET /api/auth/google/callback` → 校验 + 写 KV session + set cookie
- `POST /api/auth/signout` → 删 session
- `GET /api/auth/me` → 当前用户信息

**C017** `src/server/middleware/auth-bearer.ts`：Bearer token 校验（webhook 用）

**C018** `src/client/routes/login.tsx`：登录页

---

### Phase D — API Routes

**C019** `src/server/lib/id.ts`：nanoid 生成器

**C020** `src/server/lib/pagination.ts`：分页工具

**C021** `src/server/lib/sanitize.ts`：响应清理

**C022** `src/server/routes/projects.ts`：项目 CRUD API
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id`
- `POST /api/projects/:id/token`

**C023** `src/server/routes/recipients.ts`：收件人 CRUD API

**C024** `src/server/routes/templates.ts`：模板 CRUD + preview API

**C025** `src/server/routes/providers.ts`：Provider CRUD + health + test-send API

**C026** `src/server/routes/send-logs.ts`：发送日志分页查询 API

**C027** `src/server/routes/webhook-logs.ts`：Webhook 日志分页查询 API

**C028** `src/server/routes/stats.ts`：Dashboard 统计 API

**C029** `src/server/routes/live.ts`：健康检查 API

**C030** `src/server/lib/email/render.ts`：模板渲染

**C031** `src/server/lib/email/quota.ts`：配额检查

**C032** `src/server/lib/email/provider.ts`：Provider 接口 + 工厂
- `parseProviderConfig()` 兼容旧 cloudflare config
- `createProvider()` 签名加 `env` 参数

**C033** `src/server/lib/email/providers/resend.ts`：Resend provider

**C034** `src/server/lib/email/providers/cloudflare.ts`：Cloudflare provider
- 直接使用 `env.EMAIL` binding
- 合并 `worker-email/` 的 Layer 2 幂等逻辑

**C035** `src/server/routes/webhook.ts`：核心 webhook 路由
- `HEAD /api/webhook/:projectId` — health check
- `GET /api/webhook/:projectId/templates` — 获取模板列表
- `POST /api/webhook/:projectId/send` — 发送邮件（**完全复制现有 12 步逻辑**）

**C036** 集成所有路由到 `src/server/index.ts`

---

### Phase E — UI Migration

**C037** `src/client/components/ui/*`：shadcn/ui 组件（搬运）

**C038** `src/client/components/layout/*`：AppShell / Sidebar / Breadcrumbs

**C039** `src/client/components/charts/*`：Dashboard 图表

**C040** `src/client/components/template-editor.tsx`：模板编辑器

**C041** `src/client/components/skeletons.tsx`：加载骨架

**C042** `src/client/lib/api.ts`：fetch 封装

**C043** `src/client/routes/index.tsx`：Dashboard 页面

**C044** `src/client/routes/projects/index.tsx`：项目列表

**C045** `src/client/routes/projects/$id.tsx`：项目详情

**C046** `src/client/routes/projects/new.tsx`：新建项目

**C047** `src/client/routes/templates/index.tsx`：模板列表

**C048** `src/client/routes/templates/$id.tsx`：模板编辑

**C049** `src/client/routes/providers/index.tsx`：Provider 列表

**C050** `src/client/routes/providers/$id.tsx`：Provider 详情

**C051** `src/client/routes/send-logs.tsx`：发送日志页面

**C052** `src/client/routes/webhook-logs.tsx`：Webhook 日志页面

**C053** 更新 React Router 配置，集成所有路由

---

### Phase F — Quality

**C054** 配置 L1 单测：vitest + miniflare mock

**C055** 迁移现有单测到新目录结构

**C056** 配置 L2 API E2E：wrangler dev + vitest

**C057** 迁移现有 E2E 测试

**C058** 配置 L3 Playwright

**C059** 迁移现有 Playwright 测试

**C060** 更新构建脚本：`scripts/check-coverage.ts`

**C061** 更新 E2E 脚本：`scripts/run-e2e.ts`

**C062** 更新 Husky hooks：pre-commit = G1 + L1，pre-push = L2 ‖ G2

**C063** 验证所有测试通过

---

### Phase G — Deploy

**C064** 设置 secrets
```bash
wrangler secret put AUTH_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put ALLOWED_EMAILS

wrangler secret put AUTH_SECRET --env test
wrangler secret put GOOGLE_CLIENT_ID --env test
wrangler secret put GOOGLE_CLIENT_SECRET --env test
wrangler secret put RESEND_API_KEY --env test
wrangler secret put ALLOWED_EMAILS --env test
```

**C065** 部署 test 环境
```bash
wrangler deploy --env test
```

**C066** 验证 test 环境 + 运行 L3 E2E

**C067** 部署 production
```bash
wrangler deploy
```

**C068** Smoke test production
- `curl https://dove.hexly.ai/api/live`
- 登录测试（Google OAuth）
- 发送测试邮件

---

### Phase H — Cleanup（部署成功后）

**C069** 删除旧代码
- `worker/`（D1 proxy Worker）
- `worker-email/`（邮件 Worker）
- `src/app/`（Next.js pages）
- `src/auth.ts`、`src/proxy.ts`
- `src/lib/db/d1-client.ts`
- `Dockerfile`、`railway.json`
- `next.config.*`、`next-env.d.ts`

**C070** 删除旧测试脚本
- `scripts/deploy-test-worker.ts`
- `scripts/verify-test-db.ts`

**C071** 更新 `CLAUDE.md`
- 移除 Railway 相关说明
- 更新 Tech Stack 为 Cloudflare Workers

**C072** 删除旧 Workers
```bash
# dove.worker.hexly.ai (D1 proxy)
cd worker && wrangler delete

# dove-email.worker.hexly.ai
cd worker-email && wrangler delete
```

**C073** 更新 `docs/02-quality-upgrade.md`：标记相关段落为 superseded by 03

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
| 幂等语义：payload hash 不匹配返回 **422** `idempotency_payload_mismatch` | 同现有逻辑（422 不是 409） |
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
