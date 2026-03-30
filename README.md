<p align="center"><img src="logo.png" width="128" height="128"/></p>

<h1 align="center">dove</h1>

<p align="center"><strong>Self-hosted email relay service</strong><br>Webhook 触发 · 模板管理 · 配额控制 · 完整日志</p>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=next.js)](https://nextjs.org/)
[![Tests](https://img.shields.io/badge/tests-192%20passed-brightgreen)](https://github.com/nocoo/dove)
[![License](https://img.shields.io/github/license/nocoo/dove)](LICENSE)

---

## 这是什么

Dove 是一个自托管的邮件中继服务。个人项目通过 Webhook 发送邮件，Dove 负责管理邮件模板、收件人白名单、发送配额和完整日志，最终通过 Resend API 投递。

```
┌──────────────────────────────────────────────────────┐
│  Your Projects                                        │
│  SaaS App · CLI Tool · Cron Job · ...                 │
└───────────────┬──────────────────────────────────────┘
                │  POST /api/webhook/send (Bearer token)
                ▼
┌──────────────────────────────────────────────────────┐
│  Dove                                                 │
│  Auth → Quota Check → Template Render → Send Log      │
└───────────────┬──────────────────────────────────────┘
                │  Resend API
                ▼
┌──────────────────────────────────────────────────────┐
│  Recipient Inbox                                      │
└──────────────────────────────────────────────────────┘
```

## 功能

**邮件发送**

- **Webhook 触发** — Bearer token 认证，一个 HTTP 请求即可发送邮件
- **模板引擎** — Markdown 模板 + 变量替换，实时预览渲染效果
- **幂等发送** — 支持 idempotency key，防止重复投递
- **配额控制** — 每项目独立的日/月发送限额（软限制）

**项目管理**

- **多项目隔离** — 每个项目独立的 token、模板、收件人和配额
- **收件人白名单** — 按项目维护允许接收邮件的地址列表
- **Token 管理** — 48 字符安全 token，支持一键重新生成

**监控面板**

- **仪表盘** — 发送统计卡片 + 7 天趋势图表
- **发送日志** — 按项目/状态筛选，分页浏览，展开查看详情
- **Webhook 日志** — 请求级别的 fire-and-forget 观测日志

## 项目结构

```
src/
├── app/
│   ├── api/
│   │   ├── projects/          # 项目 CRUD + token 重置
│   │   ├── recipients/        # 收件人 CRUD
│   │   ├── templates/         # 模板 CRUD + 预览
│   │   ├── send-logs/         # 发送日志查询
│   │   ├── webhook-logs/      # Webhook 日志查询
│   │   ├── stats/             # 仪表盘统计 + 图表
│   │   ├── webhook/           # Webhook 端点 (send/health)
│   │   └── live/              # 健康检查
│   ├── page.tsx               # 仪表盘
│   ├── projects/              # 项目管理页
│   ├── templates/             # 模板管理页
│   ├── send-logs/             # 发送日志页
│   └── webhook-logs/          # Webhook 日志页
├── components/
│   ├── layout/                # AppShell、侧边栏、面包屑
│   ├── charts/                # 趋势图表
│   └── ui/                    # shadcn/ui 基础组件
├── lib/
│   ├── db/                    # D1 数据库层 (5 表 CRUD)
│   └── email/                 # Resend 客户端、模板渲染、配额
└── auth.ts                    # NextAuth v5 Google OAuth
worker/
└── src/index.ts               # Cloudflare Worker D1 代理
```

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | [Bun](https://bun.sh) |
| 框架 | [Next.js 16](https://nextjs.org/) (App Router) |
| 语言 | [TypeScript](https://www.typescriptlang.org/) (strict mode) |
| UI | [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) |
| 图表 | [Recharts](https://recharts.org/) |
| 校验 | [Zod v4](https://zod.dev/) |
| 认证 | [NextAuth v5](https://authjs.dev/) + Google OAuth |
| 数据库 | [Cloudflare D1](https://developers.cloudflare.com/d1/) (via Worker proxy) |
| 邮件 | [Resend](https://resend.com/) API |
| 部署 | [Railway](https://railway.app/) (app) + [Cloudflare](https://cloudflare.com/) (worker) |

## 开发

**环境要求**：[Bun](https://bun.sh) ≥ 1.3、[Node.js](https://nodejs.org/) ≥ 20

```bash
git clone https://github.com/nocoo/dove.git
cd dove
bun install
# 配置 .env.local（D1 Worker URL、Resend API Key、Google OAuth 等）
bun dev  # http://localhost:7032
```

| 命令 | 说明 |
|---|---|
| `bun dev` | 启动开发服务器 (port 7032) |
| `bun run build` | 生产构建 |
| `bun test` | 运行单元测试 |
| `bun run test:coverage` | 单元测试 + 90% 覆盖率门控 |
| `bun run typecheck` | TypeScript 类型检查 |
| `bun run lint` | ESLint (strict, 0 warnings) |
| `bun run test:e2e:api` | L2 API E2E 测试 (port 17032) |
| `bun run test:e2e:bdd` | L3 Playwright BDD E2E (port 27032) |
| `bun run gate:security` | 安全扫描 (osv-scanner + gitleaks) |
| `bun run release` | 发版 (SemVer bump + CHANGELOG + tag + GH release) |

## 测试

| 层 | 内容 | 触发时机 |
|---|---|---|
| L1 Unit | 123 tests, ≥90% coverage (bun test) | pre-commit |
| G1 Static | tsc strict + ESLint strict + max-warnings=0 | pre-commit |
| L2 API E2E | 69 tests, 18 REST endpoints (port 17032) | pre-push |
| G2 Security | osv-scanner + gitleaks | pre-push |
| L3 BDD E2E | Playwright 核心流程 (port 27032) | on-demand |

```bash
bun run test:coverage        # L1 + 覆盖率
bun run typecheck && bun run lint  # G1
bun run test:e2e:api         # L2
bun run gate:security        # G2
bun run test:e2e:bdd         # L3
```

## 文档

| # | 文档 | 说明 |
|---|---|---|
| 01 | [Architecture](docs/01-architecture.md) | 技术栈、数据库设计、API 设计、项目结构 |
| 02 | [Quality Upgrade](docs/02-quality-upgrade.md) | 六维质量体系升级计划 (Tier B+ → S) |

[MIT](LICENSE) © 2026