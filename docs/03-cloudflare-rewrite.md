# 03 — Cloudflare-Native Rewrite

## Goal

把 dove 从 **Next.js 16 on Railway + 2 个外挂 Worker** 重写为 **纯 Cloudflare 原生应用**，充分利用 CF 平台能力：

| 能力 | 用途 |
|---|---|
| **Workers** | 统一运行时：API + 静态资产 + 邮件发送 |
| **D1** | 关系型数据（projects / recipients / templates / send_logs） |
| **Queues** | 异步邮件投递管道，解耦 webhook 响应与实际发送 |
| **KV** | 会话存储 + 配置缓存（模板热数据、provider 健康状态） |
| **Durable Objects** | 每项目速率限制 / 配额强一致计数器 |
| **Analytics Engine** | 高吞吐可观测日志（替代 `webhook_logs` 表，支持 SQL 聚合） |
| **R2** | 邮件附件 / 模板资产 / 审计归档 |
| **Email Routing** | CF 原生 SMTP 发送（`env.EMAIL`） |
| **Workers Static Assets** | SPA 静态托管（Vite 产物） |

部署收敛到 `wrangler deploy` 一条命令。业务行为（API 形状、错误码、幂等语义、配额规则、模板渲染、whitelist 校验）**保持不变**——01-architecture.md 与 design/multi-provider-email.md 仍是单一权威源。本文只描述"换骨"的技术路径。

---

## Design Principles

1. **第一性原理**：不是"把 Next.js 搬到 CF"，而是"如果从零在 CF 上构建邮件中继服务，应该怎么设计"
2. **原生优先**：优先使用 CF 平台能力，而不是自己实现（如 Queues 代替自建队列、Analytics Engine 代替日志表）
3. **不受免费额度限制**：设计时假设付费 tier，选择最合适的架构而非最省钱的架构
4. **边缘优先**：所有逻辑跑在 Worker，无中心化服务器
5. **单一部署面**：一个 `wrangler.toml`，一个 `wrangler deploy`

---

## Why Rewrite (Not Migrate)

现状的痛点都来自"app 在 Railway、数据在 CF"这条边界：

| 痛点 | 现在 | 重写后 |
|---|---|---|
| 数据库延迟 | Railway → HTTPS → `dove.worker.hexly.ai` → D1，每次查询过一次北美往返 | Worker 内 `env.DB` 原生 binding，sub-millisecond |
| 邮件发送 | Railway → HTTPS → `dove-email.worker.hexly.ai` → CF Email | 同进程直接 `env.EMAIL.send()` |
| 配额检查 | SQL COUNT + 乐观锁，并发下可能超发 | **Durable Object** 强一致计数器，精确到单封 |
| 日志写入 | 同步写 D1 `webhook_logs` 表，增加延迟 | **Analytics Engine** 异步写，火即忘 |
| 部署 | Railway 镜像构建 + 2 套 wrangler env | 单 `wrangler deploy`（含 `[env.test]`） |
| 冷启动 / 成本 | Railway 常驻 + 2 个 Worker | 全 Worker，按请求计费 |
| 鉴权链 | NextAuth v5 + `proxy.ts` 自维护的 host/cookie 逻辑 | 同样思路，但跑在 Worker 边缘 |
| `.env.test` + `D1_WORKER_URL` 映射 | 必须维护 prod/test 两套 worker URL 与 API_KEY | D1 隔离回归到 wrangler `[env.test]` 原生模型，零自定义 proxy |

**结论**：D1 proxy Worker（`worker/`）的存在唯一原因是"Railway 无法直接 binding D1"。一旦应用搬到 Worker，这一层就该被删除，而不是迁移。更进一步，把"同步写日志"、"SQL 计数配额"等模式替换为 CF 原生方案。

---

## Target Stack

| 层 | 选型 | 备注 |
|---|---|---|
| **运行时** | Cloudflare Workers | `compatibility_date` 取最新 |
| **框架** | Hono | 一线 Worker HTTP 框架，TS 一等公民，与 OpenAPI/Zod 生态打通 |
| **前端** | Vite 7 + React 19 + React Router v7 | SPA 形态，Worker 内静态资产由 Workers Static Assets 服务 |
| **UI** | Tailwind CSS v4 + shadcn/ui | 保持现有 basalt 风格，组件整体搬运 |
| **图表** | Recharts | 不变 |
| **校验** | Zod v4 | 不变 |
| **鉴权** | `@hono/oauth-providers` (Google) + KV session | 替换 NextAuth v5；whitelist 逻辑沿用 `ALLOWED_EMAILS` |
| **关系数据** | D1 | projects / recipients / templates / send_logs / email_providers |
| **会话存储** | KV | signed session token → user info，TTL 7 天 |
| **配额计数** | Durable Objects | 每项目一个 DO 实例，强一致日/月计数器 |
| **异步队列** | Queues | webhook → 入队 → consumer Worker 实际发送 |
| **可观测日志** | Analytics Engine | 替代 `webhook_logs` 表，支持 SQL 聚合查询 |
| **对象存储** | R2 | 邮件附件 / 模板资产 / 审计归档 |
| **邮件发送** | Resend HTTP + CF Email Routing | 双 provider 架构保留 |
| **模板渲染** | marked | 不变 |
| **ID 生成** | nanoid | 不变 |
| **部署** | `wrangler deploy` | 单 worker；`[env.test]` 给 L2/L3 |
| **域名** | `dove.hexly.ai` | custom domain route |

> **不选 OpenNext for Cloudflare**：技术上可以把现有 Next.js 直接搬到 Workers，但那意味着继承 Next.js App Router 的所有运行时假设、build pipeline、middleware 形态——等于"换底没减重"。我们要的是更薄的栈，所以走 Hono + Vite SPA 路线。

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
│                     │    ├─ /api/webhook/*      ──► Bearer APIs            │
│                     │    │    │                                             │
│                     │    │    ├─ 1. Auth check                              │
│                     │    │    ├─ 2. DO.checkQuota() ◄─── Durable Object    │
│                     │    │    ├─ 3. Validate + render template              │
│                     │    │    ├─ 4. Queue.send() ◄─────── Queues           │
│                     │    │    ├─ 5. AE.writeDataPoint() ◄─ Analytics Engine│
│                     │    │    └─ 6. Return 202 Accepted (async)            │
│                     │    │                                                  │
│                     │    └─ /api/live           ──► Health                  │
│                     │                                                       │
│                     └─► Bindings                                            │
│                          ├─ DB            : D1 (dove-db)                    │
│                          ├─ KV            : KV namespace (sessions)         │
│                          ├─ QUEUE         : Queue (email-send)              │
│                          ├─ QUOTA_DO      : Durable Object (per-project)    │
│                          ├─ AE            : Analytics Engine (logs)         │
│                          ├─ BUCKET        : R2 (attachments)                │
│                          ├─ EMAIL         : send_email binding              │
│                          └─ Secrets       : AUTH_SECRET, GOOGLE_*,          │
│                                             RESEND_API_KEY, ...             │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Queue Consumer (same Worker, different handler)                           │
│     │                                                                       │
│     ├─ Dequeue message                                                      │
│     ├─ Select provider (Resend / CF Email)                                  │
│     ├─ Send email (with retry)                                              │
│     ├─ Update D1 send_logs                                                  │
│     ├─ DO.confirmSend() or DO.rollbackQuota()                               │
│     └─ AE.writeDataPoint() (send result)                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 关键数据流：异步邮件发送

```
Webhook Request
     │
     ▼
┌─────────────────┐
│  1. Auth check  │  Bearer token → D1 project lookup
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  2. Quota check │  Durable Object: atomic increment, returns allow/deny
└────────┬────────┘
         │ (fail fast if over quota)
         ▼
┌─────────────────┐
│  3. Validate    │  recipient whitelist, template exists, render markdown
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  4. Enqueue     │  Queue.send({ projectId, to, subject, html, idempotencyKey })
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  5. Log intent  │  Analytics Engine: { event: "webhook_received", ... }
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  6. Return 202  │  { success: true, queued: true, idempotency_key }
└─────────────────┘

         ~~~~ Queue Consumer (async) ~~~~

┌─────────────────┐
│  7. Dequeue     │  Cloudflare Queues delivers message
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  8. Send email  │  Resend HTTP or CF Email (based on provider config)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  9. Persist     │  D1: INSERT send_logs; DO: confirmSend() or rollback
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 10. Log result  │  Analytics Engine: { event: "email_sent", provider, ... }
└─────────────────┘
```

### 为什么用 Queues 解耦？

| 同步模式（现有） | 异步模式（Queues） |
|---|---|
| Webhook 必须等邮件发完才返回 | Webhook 入队后立即返回 202 |
| p99 延迟 = 外部 API 延迟 | p99 延迟 < 50ms（本地入队） |
| 外部 API 故障 → webhook 失败 | 外部 API 故障 → 队列重试，调用方无感 |
| 无法批量处理 | 可批量消费降低 API 调用数 |
| 并发爆发 → Railway 排队 | 并发爆发 → 队列缓冲，平滑消费 |

### 为什么用 Durable Objects 做配额？

| SQL COUNT 模式（现有） | Durable Object 模式 |
|---|---|
| `SELECT COUNT(*) WHERE date = today` | 原子计数器，单次 RPC |
| 并发高时可能超发（乐观锁失效） | 强一致，精确到单封 |
| 每次请求一次 DB 查询 | 内存状态，sub-ms |
| 月配额需要扫描 30 天数据 | 月计数器独立维护 |

### 为什么用 Analytics Engine 替代 webhook_logs？

| D1 表模式（现有） | Analytics Engine 模式 |
|---|---|
| 同步 INSERT，增加请求延迟 | 异步写入，火即忘 |
| 表膨胀需要定期清理 | 自动过期（90 天默认） |
| 聚合查询慢（无索引优化） | SQL 聚合引擎，毫秒级 |
| 存储成本随日志量线性增长 | 按写入点数计费，压缩存储 |
| UI 需要分页 API | 直接 SQL 查询返回聚合结果 |

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

# Queue (email sending)
[[queues.producers]]
binding = "QUEUE"
queue = "dove-email-queue"

[[queues.consumers]]
queue = "dove-email-queue"
max_batch_size = 10
max_batch_timeout = 30

# Durable Objects (quota)
[[durable_objects.bindings]]
name = "QUOTA_DO"
class_name = "ProjectQuota"

[[migrations]]
tag = "v1"
new_classes = ["ProjectQuota"]

# Analytics Engine
[[analytics_engine_datasets]]
binding = "AE"
dataset = "dove_logs"

# R2 Bucket (attachments)
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "dove-attachments"

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

[[env.test.queues.producers]]
binding = "QUEUE"
queue = "dove-email-queue-test"

[[env.test.queues.consumers]]
queue = "dove-email-queue-test"
max_batch_size = 10
max_batch_timeout = 5

[[env.test.analytics_engine_datasets]]
binding = "AE"
dataset = "dove_logs_test"

[[env.test.r2_buckets]]
binding = "BUCKET"
bucket_name = "dove-attachments-test"
```

---

## CF Feature Deep Dive

### 1. Queues — 异步邮件管道

**职责**：解耦 webhook 请求与邮件实际发送，提供重试、削峰、批量处理能力。

```typescript
// Producer (webhook handler)
interface EmailMessage {
  id: string;                    // nanoid
  projectId: string;
  idempotencyKey: string;
  to: string;
  subject: string;
  html: string;
  provider: 'resend' | 'cloudflare';
  attempt: number;
  enqueuedAt: number;
}

await c.env.QUEUE.send(message);

// Consumer (queue handler)
export default {
  async queue(batch: MessageBatch<EmailMessage>, env: Env) {
    for (const msg of batch.messages) {
      try {
        const result = await sendEmail(env, msg.body);
        await persistSendLog(env.DB, msg.body, result);
        await confirmQuota(env.QUOTA_DO, msg.body.projectId);
        msg.ack();
      } catch (err) {
        if (msg.body.attempt < 3) {
          msg.retry({ delaySeconds: Math.pow(2, msg.body.attempt) * 60 });
        } else {
          await persistSendLog(env.DB, msg.body, { error: err.message });
          await rollbackQuota(env.QUOTA_DO, msg.body.projectId);
          msg.ack(); // don't retry forever
        }
      }
    }
  }
};
```

**配置**：
- `max_batch_size = 10`：批量消费降低 Resend API 调用频率
- `max_batch_timeout = 30`：最多等 30s 凑批
- Dead Letter Queue：3 次失败后进入 DLQ 供人工处理

### 2. Durable Objects — 配额计数器

**职责**：每项目一个 DO 实例，维护日/月配额的强一致计数器。

```typescript
export class ProjectQuota implements DurableObject {
  private daily: number = 0;
  private monthly: number = 0;
  private lastDayReset: string = '';  // YYYY-MM-DD
  private lastMonthReset: string = ''; // YYYY-MM

  constructor(private state: DurableObjectState, private env: Env) {
    // Lazy load from storage on first request
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/check-and-reserve') {
      // Atomic: check limits + reserve slot
      const { dailyLimit, monthlyLimit } = await request.json();
      this.maybeResetCounters();
      
      if (this.daily >= dailyLimit) {
        return Response.json({ allowed: false, reason: 'daily_exceeded' });
      }
      if (this.monthly >= monthlyLimit) {
        return Response.json({ allowed: false, reason: 'monthly_exceeded' });
      }
      
      this.daily++;
      this.monthly++;
      await this.state.storage.put({ daily: this.daily, monthly: this.monthly, ... });
      
      return Response.json({ allowed: true, daily: this.daily, monthly: this.monthly });
    }
    
    if (url.pathname === '/confirm') {
      // Email sent successfully, keep the reservation
      return Response.json({ ok: true });
    }
    
    if (url.pathname === '/rollback') {
      // Email failed, release the reservation
      this.daily = Math.max(0, this.daily - 1);
      this.monthly = Math.max(0, this.monthly - 1);
      await this.state.storage.put({ daily: this.daily, monthly: this.monthly, ... });
      return Response.json({ ok: true });
    }
    
    // GET /stats
    return Response.json({ daily: this.daily, monthly: this.monthly });
  }
}
```

**关键设计**：
- **Reserve → Confirm/Rollback 两阶段**：入队时 reserve，发送成功 confirm，失败 rollback
- **自动 reset**：每天/每月首次请求时检查并重置计数器
- **持久化**：每次变更写入 `state.storage`，Worker 重启不丢失
- **ID 路由**：`env.QUOTA_DO.idFromName(projectId)` 保证同一项目总是路由到同一实例

### 3. Analytics Engine — 可观测日志

**职责**：替代 `webhook_logs` 表，提供高吞吐异步写入 + SQL 聚合查询。

```typescript
// 写入（火即忘）
c.env.AE.writeDataPoint({
  blobs: [
    projectId,           // index1
    event,               // index2: webhook_received | email_sent | email_failed
    provider,            // index3
    recipientEmail,      // blob1
    templateId,          // blob2
    errorMessage || '',  // blob3
  ],
  doubles: [
    Date.now(),          // timestamp
    latencyMs,           // double1
    attempt,             // double2
  ],
});

// 查询（Dashboard API）
const query = `
  SELECT
    index1 AS project_id,
    index2 AS event,
    COUNT(*) AS count,
    AVG(double2) AS avg_latency
  FROM dove_logs
  WHERE timestamp > NOW() - INTERVAL '24' HOUR
  GROUP BY index1, index2
  ORDER BY count DESC
`;
const result = await c.env.AE.sql(query);
```

**优势**：
- 写入不阻塞请求（异步）
- 自动保留 90 天，无需手动清理
- SQL 聚合在 CF 侧完成，UI 只拿聚合结果
- 成本远低于 D1 行存储

**Dashboard 改造**：
- 原有的 `GET /api/webhook-logs` 改为查询 Analytics Engine
- 分页 → 时间范围 + 聚合
- 详情页保留（查 `send_logs` 表，但 webhook_logs 不再写 D1）

### 4. KV — 会话存储

**职责**：存储 OAuth 登录后的 session token。

```typescript
// 登录成功后
const sessionId = nanoid();
const sessionData = { email: user.email, createdAt: Date.now() };
await c.env.KV.put(`session:${sessionId}`, JSON.stringify(sessionData), {
  expirationTtl: 7 * 24 * 60 * 60, // 7 days
});
setCookie(c, 'session', sessionId, { httpOnly: true, secure: true, sameSite: 'Lax' });

// 中间件校验
const sessionId = getCookie(c, 'session');
const data = await c.env.KV.get(`session:${sessionId}`, 'json');
if (!data || !ALLOWED_EMAILS.includes(data.email)) {
  return c.json({ error: 'unauthorized' }, 401);
}
c.set('user', data);
```

**为什么用 KV 而不是 signed cookie**：
- Session 可以服务端撤销（登出、强制下线）
- 可以存储更多元数据（角色、权限等，未来扩展）
- Cookie 只存 session ID，更小

### 5. R2 — 对象存储

**职责**：
1. **邮件附件**（未来功能）：用户上传附件 → 存 R2 → 发送时附加
2. **模板资产**：模板中引用的图片、文件
3. **审计归档**：每日 send_logs 导出为 JSONL 存档

```typescript
// 上传附件
app.post('/api/attachments', async (c) => {
  const file = await c.req.file('file');
  const key = `attachments/${nanoid()}/${file.name}`;
  await c.env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });
  return c.json({ key, url: `https://dove.hexly.ai/r2/${key}` });
});

// 审计归档（定时任务或手动）
const logs = await db.query('SELECT * FROM send_logs WHERE date = ?', [yesterday]);
const jsonl = logs.map(l => JSON.stringify(l)).join('\n');
await c.env.BUCKET.put(`archive/${yesterday}.jsonl`, jsonl);
await db.run('DELETE FROM send_logs WHERE date = ?', [yesterday]);
```

---

## What Goes Away

重写后从仓库消失：

- `worker/`（D1 proxy Worker） → 删
- `src/lib/db/d1-client.ts` 的 HTTP fetch + retry 层 → 删，替换为 `env.DB.prepare(...).bind(...).all()` 的薄包装
- `src/proxy.ts`（Next.js 16 auth proxy） → 删
- `src/auth.ts`（NextAuth v5 配置） → 删，由 Hono OAuth + KV session 替代
- `Dockerfile`、`railway.json` → 删
- `next.config.*`、`next-env.d.ts`、所有 `app/` 下的 `route.ts` / `page.tsx` Next.js 形态 → 删
- `scripts/deploy-test-worker.ts` / `scripts/verify-test-db.ts` / `_test_marker` 表 → 删（隔离回归到 wrangler env）
- `worker-email/` → 合并进主 Worker（`cf_email_idempotency` 逻辑合并，但表本身可能被 DO 替代）
- `webhook_logs` 表 → 迁移到 Analytics Engine，D1 表删除

保留并迁移：

- `src/lib/db/{projects,recipients,templates,send-logs,email-providers}.ts` — 业务函数签名不变
- `src/lib/email/{provider,providers/*,render}.ts` — Provider 接口不变
- `src/lib/{id,pagination,sanitize,version}.ts` — 直接搬
- `src/components/**` — 直接搬到 Vite 项目下
- `src/lib/db/schema.ts` — 内容简化（删 webhook_logs），运行入口改为 `wrangler d1 execute`

---

## Repository Layout (Target)

```
dove/
├── wrangler.toml              # 单 worker，含 [env.test]，所有 bindings
├── package.json
├── vite.config.ts             # 客户端构建（Vite + React 19）
├── tsconfig.json              # paths: @/server, @/client
├── src/
│   ├── server/
│   │   ├── index.ts           # Worker entry: Hono app + queue consumer
│   │   ├── env.ts             # Env 类型 (D1, KV, Queue, DO, AE, R2, Email, secrets)
│   │   ├── durable-objects/
│   │   │   └── project-quota.ts  # 配额计数器 DO
│   │   ├── middleware/
│   │   │   ├── auth-session.ts   # KV session check
│   │   │   ├── auth-bearer.ts    # webhook bearer check
│   │   │   └── analytics.ts      # AE logging middleware
│   │   ├── routes/
│   │   │   ├── auth.ts        # /api/auth/google/* → KV session
│   │   │   ├── projects.ts
│   │   │   ├── recipients.ts
│   │   │   ├── templates.ts
│   │   │   ├── providers.ts
│   │   │   ├── send-logs.ts
│   │   │   ├── webhook-logs.ts  # 查询 Analytics Engine
│   │   │   ├── stats.ts         # Dashboard (AE aggregates)
│   │   │   ├── webhook.ts       # /api/webhook/[projectId]/* → Queue
│   │   │   ├── attachments.ts   # R2 upload/download
│   │   │   └── live.ts
│   │   ├── queue/
│   │   │   └── email-consumer.ts  # Queue handler
│   │   ├── lib/
│   │   │   ├── db/            # D1 CRUD
│   │   │   ├── email/         # provider 层
│   │   │   ├── quota.ts       # DO client wrapper
│   │   │   ├── analytics.ts   # AE client wrapper
│   │   │   ├── id.ts
│   │   │   ├── sanitize.ts
│   │   │   └── version.ts
│   │   └── schema.sql         # CREATE TABLE (无 webhook_logs)
│   └── client/
│       ├── main.tsx           # React Router entry
│       ├── routes/
│       │   ├── _layout.tsx    # AppShell + sidebar
│       │   ├── index.tsx      # Dashboard (AE data)
│       │   ├── login.tsx
│       │   ├── projects/
│       │   ├── templates/
│       │   ├── providers/
│       │   ├── send-logs.tsx
│       │   └── webhook-logs.tsx  # AE query UI
│       ├── components/
│       ├── hooks/
│       ├── lib/api.ts
│       └── styles/globals.css
├── scripts/
│   ├── check-coverage.ts
│   ├── gate-security.ts
│   ├── release.ts
│   └── db-archive.ts          # send_logs → R2 归档脚本
├── e2e/
│   ├── api/                   # L2 — Miniflare in-process
│   └── bdd/                   # L3 — Playwright
└── docs/
```

---

## Cutover Plan (Atomic Commits, Branch: `cf-rewrite`)

每一步都是一个独立 commit，可单独 review、回滚。所有 phase 完成前，main 分支 Next.js 版本继续可部署到 Railway——重写在 long-lived branch 上推进。

### Phase A — Scaffold（1–2 天）

1. 新建 `src/server/index.ts`：最小 Hono app，`GET /api/live` 返回 `{ status:"ok", version }`
2. 新建 `wrangler.toml`：所有 bindings（DB, KV, Queue, DO, AE, R2, EMAIL）
3. `wrangler dev` 跑通 + `wrangler deploy --dry-run` 通过
4. 新建 `src/client/`：Vite + React 19 最小骨架，`vite build` 输出 `dist/client/`
5. Worker 加上 Static Assets 配置，验证浏览器能访问 SPA + `/api/live`

### Phase B — Infrastructure Primitives（2 天）

6. **Durable Object**：`src/server/durable-objects/project-quota.ts`
   - `check-and-reserve` / `confirm` / `rollback` / `stats` 接口
   - 单元测试（Miniflare DO mock）
7. **Queue Consumer**：`src/server/queue/email-consumer.ts`
   - 解析消息 → 选 provider → 发送 → 更新 D1 → 调用 DO
   - 重试逻辑（指数退避，最多 3 次）
8. **Analytics Engine wrapper**：`src/server/lib/analytics.ts`
   - `writeWebhookEvent()` / `writeSendEvent()` 封装
   - 查询接口供 Dashboard 使用
9. **KV Session**：`src/server/lib/session.ts`
   - `createSession()` / `getSession()` / `deleteSession()`

### Phase C — Data Layer Migration（1 天）

10. `src/server/lib/db/d1.ts`：薄包装 `c.env.DB` 的 `query/run/first/all`
11. 把 `projects/recipients/templates/send-logs/email-providers.ts` 整体搬到 `src/server/lib/db/`
12. `src/server/schema.sql`：汇总所有 `CREATE TABLE`（**删除 webhook_logs 表定义**）
13. **配额逻辑迁移**：`src/lib/email/quota.ts` 改为调用 Durable Object

### Phase D — Auth（1 天）

14. `src/server/routes/auth.ts`：`@hono/oauth-providers/google` + KV session
15. `src/server/middleware/auth-session.ts`：从 KV 读 session，校验 `ALLOWED_EMAILS`
16. `src/server/middleware/auth-bearer.ts`：webhook 路径走 Bearer token 校验
17. 客户端 `/login` 路由 → `GET /api/auth/google` 跳转

### Phase E — API Routes Migration（2–3 天）

18. `routes/projects.ts`（CRUD + `/token` 重置）
19. `routes/recipients.ts`
20. `routes/templates.ts`（含 preview）
21. `routes/providers.ts`（含 health + test-send）
22. `routes/send-logs.ts`（查 D1）
23. `routes/webhook-logs.ts`（**查 Analytics Engine**，新接口）
24. `routes/stats.ts`（Dashboard，混合 D1 + AE 聚合）
25. `routes/webhook.ts`（**核心重写**）：
    - Auth → DO.checkAndReserve() → Validate → Queue.send() → AE.write() → 202
26. `routes/attachments.ts`（R2 上传/下载，预留）
27. `routes/live.ts`：D1 ping + version

### Phase F — UI Migration（2–3 天）

28. 把 `src/components/**` 整体搬到 `src/client/components/`
29. `src/client/main.tsx` 配 React Router v7
30. 页面逐个迁移：dashboard / projects / templates / providers / send-logs / webhook-logs / login
31. **Dashboard 改造**：从 AE 拉取聚合数据，图表逻辑调整
32. **Webhook Logs 改造**：时间范围查询 + 聚合视图（不再分页）

### Phase G — Quality（1–2 天）

33. L1 单测：DO / Queue consumer / AE wrapper / 业务 CRUD
34. L2 API E2E：Miniflare 提供 D1/KV/Queue/DO/AE mock
35. L3 Playwright：`wrangler dev --env test` 起在 27032
36. G1：`tsc --noEmit` + ESLint（删 next 相关）
37. G2：osv-scanner + gitleaks
38. Husky hooks：pre-commit = G1 + L1，pre-push = L2 ‖ G2

### Phase H — Cutover（半天）

39. 创建生产 KV namespace / Queue / DO binding / AE dataset / R2 bucket
40. `wrangler deploy`
41. 执行 `schema.sql`（`wrangler d1 execute`）
42. DNS：`dove.hexly.ai` 切到新 Worker custom domain
43. Google Console 添加新 OAuth callback URL
44. 旧 Railway 服务保留 7 天观测期
45. 7 天后下线 Railway，删除 `worker/`、`worker-email/` 目录

---

## Migration: webhook_logs → Analytics Engine

### 现有数据迁移

`webhook_logs` 表现有数据处理策略：

1. **历史数据归档**：cutover 前导出现有 `webhook_logs` 到 R2（JSONL 格式）
2. **新数据双写**：灰度期间同时写 D1 和 AE（可选，增加复杂度）
3. **推荐：Clean cut**：cutover 时停止写 D1，新日志全部进 AE；历史数据通过 R2 归档查看

### 查询接口变化

| 操作 | 旧（D1） | 新（AE） |
|---|---|---|
| 最近 N 条 | `SELECT * LIMIT N OFFSET M` | `SELECT * ORDER BY timestamp DESC LIMIT N` |
| 按项目过滤 | `WHERE project_id = ?` | `WHERE index1 = 'project_id'` |
| 时间范围 | `WHERE created_at > ?` | `WHERE timestamp > NOW() - INTERVAL '24' HOUR` |
| 聚合统计 | `SELECT COUNT(*) GROUP BY ...` | 同，但毫秒级返回 |
| 详情查看 | `SELECT * WHERE id = ?` | 不支持单条精确查询（设计如此） |

### UI 改造

- **列表页**：从分页模式改为时间范围选择器 + 聚合表格
- **详情**：webhook_logs 不再提供单条详情；send_logs（D1）仍可查看发送详情
- **Dashboard 图表**：直接从 AE 聚合，响应更快

---

## D1 Strategy: Same DB

**决策**：复用现有 `dove-db`。

理由：
- 现有 schema 已经设计为 idempotent（`CREATE TABLE IF NOT EXISTS`）
- 新 Worker 和旧 Railway 在 cutover 那一刻只有一方持有写流量（DNS 切换是原子的）
- 幂等表 + send_logs 唯一约束保证了即便两边并发也不会重复发送
- `webhook_logs` 表不再写入，但保留供历史查询（可后续清理）

---

## Test Isolation

回到 Cloudflare 原生模型：

```toml
[env.test]
# 所有 bindings 都有 test 版本
[[env.test.d1_databases]]
binding = "DB"
database_name = "dove-db-test"
database_id = "1adca6ff-076f-45ff-a4d6-a1fdae9397ea"

[[env.test.kv_namespaces]]
binding = "KV"
id = "<test-kv-id>"

# ... 其他 bindings
```

- **L2**：Miniflare 跑在内存里，所有 bindings 都是 mock
- **L3**：`wrangler dev --env test` 直接绑定 test bindings
- 不再需要 `_test_marker` 表或 `verify-test-db.ts`

---

## Public Contract Preservation

下列东西**必须**逐字节兼容（已有调用方依赖）：

- 所有 `/api/webhook/{projectId}/*` 的请求/响应 schema、错误码、HTTP 状态
- `Authorization: Bearer <token>` 鉴权方式
- `X-Idempotency-Key`/`idempotency_key` 语义
- 错误码字符串（`auth_invalid` / `recipient_not_found` / `quota_daily_exceeded` / ...）
- send_logs 的 `resend_id` / `provider_message_id` 字段
- **新增返回字段**：`queued: true`（202 响应表示已入队，不影响现有调用方）

UI 路由保持相同 URL：`/projects`, `/templates`, `/send-logs`, `/webhook-logs`, `/login`

---

## Risks & Mitigations

| 风险 | 影响 | 缓解 |
|---|---|---|
| OAuth 回调 URL 变更 | 登录失败 | cutover 前先在 Google Console 新增 callback URL |
| KV session vs cookie | 登录会话失效 | 新旧系统独立 session；cutover 后用户需重新登录（可接受） |
| Queue 消息丢失 | 邮件丢失 | 开启 Queue 持久化；DLQ 兜底；send_logs 最终一致性检查 |
| DO 状态不一致 | 配额计数错误 | DO 使用 `state.storage` 持久化；每日/月重置逻辑兜底 |
| AE 写入失败 | 日志丢失 | AE 是 best-effort 设计，接受少量丢失；关键事件同时写 send_logs |
| Worker CPU 限制 | 大模板渲染失败 | `marked` 是同步纯计算，单封邮件 CPU 远低于 50ms 限制 |
| 静态资产路由优先级 | API 被 SPA 截走 | Hono 在前、Static Assets 兜底 |
| Vite SSR 缺失 | 首屏白屏 | dove 是内部后台，不在乎 SEO/首屏 |
| 重写期间业务漂移 | 长 branch 冲突 | main 分支冻结新功能；估计 10–14 工作日完成 |

---

## Cost Estimation (Paid Tier)

| 资源 | 估算用量 | 月成本 |
|---|---|---|
| Workers requests | ~100k/月 | Free tier 覆盖 |
| D1 reads/writes | ~500k reads, ~10k writes | ~$0.50 |
| KV reads/writes | ~200k reads, ~20k writes | ~$0.50 |
| Queues messages | ~10k/月 | Free tier 覆盖 |
| Durable Objects | ~50k requests | ~$0.15 |
| Analytics Engine | ~50k writes | Free tier 覆盖 |
| R2 storage | <1GB | Free tier 覆盖 |
| **Total** | | **< $5/月** |

对比 Railway：当前 ~$5/月 + Worker 成本。重写后成本持平或更低，但获得更好的边缘延迟和可扩展性。

---

## Definition of Done

- [ ] `wrangler deploy` 单命令出生产
- [ ] `dove.hexly.ai` 服务所有现有 UI 路由 + API 路径
- [ ] 异步邮件管道正常工作（Queue → Consumer → D1）
- [ ] 配额计数正确（DO 强一致）
- [ ] webhook 日志可查询（Analytics Engine）
- [ ] 6 维质量门禁全绿（L1≥90% / L2 / L3 / G1 / G2 / 测试隔离）
- [ ] 至少一个真实项目切换到新 URL 后，连续 7 天 0 增量错误
- [ ] `worker/`、`worker-email/`、`Dockerfile`、`railway.json`、`src/auth.ts`、`src/proxy.ts`、`d1-client.ts` HTTP 层从仓库删除
- [ ] Railway 项目下线
- [ ] 02-quality-upgrade.md 中的相关段落标记为 superseded by 03

---

## Out of Scope

- 任何新业务功能
- 新 provider 类型（SES / Postmark）
- 多租户 / RBAC
- 邮件附件功能（R2 基础设施就位，但 UI/API 不实现）
- 实时通知（WebSocket / SSE）
