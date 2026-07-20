<p align="center"><img src="src/client/public/logo.png" width="128" height="128"/></p>

<h1 align="center">dove</h1>

<p align="center"><strong>Self-hosted email relay service</strong><br>Webhook 触发 · 模板管理 · 配额控制 · 完整日志</p>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Tests](https://img.shields.io/badge/tests-289%20passed-brightgreen)](https://github.com/nocoo/dove)
[![License](https://img.shields.io/github/license/nocoo/dove)](LICENSE)

---

## 这是什么

Dove 是一个自托管的邮件中继服务，运行在 Cloudflare Workers 上。个人项目通过 Webhook 发送邮件，Dove 负责管理邮件模板、收件人白名单、发送配额和完整日志，通过可配置的邮件服务商（Resend / Cloudflare Email Routing）投递。

```
┌──────────────────────────────────────────────────────┐
│  Your Projects                                        │
│  SaaS App · CLI Tool · Cron Job · ...                 │
└───────────────┬──────────────────────────────────────┘
                │  POST /api/webhook/send (Bearer token)
                ▼
┌──────────────────────────────────────────────────────┐
│  Dove (Cloudflare Workers)                            │
│  Auth → Quota Check → Template Render → Send Log      │
└───────────────┬──────────────────────────────────────┘
                │  Resend API / Cloudflare Email Routing
                ▼
┌──────────────────────────────────────────────────────┐
│  Recipient Inbox                                      │
└──────────────────────────────────────────────────────┘
```

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | [Cloudflare Workers](https://workers.cloudflare.com/) |
| API 框架 | [Hono](https://hono.dev/) |
| 语言 | [TypeScript](https://www.typescriptlang.org/) (strict mode) |
| 数据库 | [Cloudflare D1](https://developers.cloudflare.com/d1/) (native binding) |
| 会话存储 | [Cloudflare KV](https://developers.cloudflare.com/kv/) |
| 认证 | Google OAuth + KV sessions + email whitelist |
| 前端 | React 19 SPA ([Vite](https://vite.dev/) + React Router) |
| UI | [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) |
| 图表 | [Recharts](https://recharts.org/) |
| 校验 | [Zod v4](https://zod.dev/) |
| 邮件 | [Resend](https://resend.com/) API / Cloudflare Email Routing |
| 部署 | `wrangler deploy` (single command) |

## 开发

**环境要求**：[Bun](https://bun.sh) ≥ 1.3

```bash
git clone https://github.com/nocoo/dove.git
cd dove
bun install
bun dev  # http://localhost:7034
```

| 命令 | 说明 |
|---|---|
| `bun dev` | 启动开发服务器 (port 7034) |
| `bun run build` | 生产构建 |
| `vitest run` | 运行单元测试 |
| `bun run test:coverage` | 单元测试 + 覆盖率门控 (99/99/96/99) |
| `bun run typecheck` | TypeScript 类型检查 (7.0.2) |
| `bun run lint` | Biome check (--error-on-warnings) |
| `bun run test:e2e:api` | L2 API E2E 测试 (port 17034) |
| `bun run test:e2e:bdd` | L3 Playwright BDD E2E (port 27034) |
| `bun run gate:security` | 安全扫描 (osv-scanner + gitleaks) |
| `bun run release` | 发版 (SemVer bump + CHANGELOG + tag + GH release) |

## 测试

| 层 | 内容 | 触发时机 |
|---|---|---|
| L1 Unit | vitest coverage thresholds 99/99/96/99 (lines/funcs/branches/stmts) | pre-commit |
| G1 Static | tsc strict + Biome (`--error-on-warnings`) | pre-commit |
| L2 API E2E | REST endpoint coverage (port 17034) | pre-push |
| G2 Security | osv-scanner + gitleaks | pre-push |
| L3 BDD E2E | Playwright 核心流程 (port 27034) | on-demand |

[MIT](LICENSE) © 2026
