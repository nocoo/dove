<p align="center">
  <img src="assets/brand/icon-rounded.png" width="128" height="128" alt="Dove Logo" />
</p>
<h1 align="center">Dove</h1>
<p align="center">为个人项目集中管理邮件模板，通过 Webhook 发送通知并查询记录。</p>
<p align="center">
  <a href="https://dove.hexly.ai">站点</a> ·
  <a href="docs/README.en.md">English</a>
</p>

## 这是什么

Dove 是自托管的邮件中继服务。应用、脚本或定时任务提交模板名、收件地址和变量，Dove 校验请求，在请求内调用 Resend 或 Cloudflare Email Routing 发送邮件，并记录结果。

管理界面和 API 运行在同一个 Cloudflare Worker，项目、模板、收件人与日志保存在 D1。管理界面使用 Cloudflare Access 登录；业务系统通过每个项目独立的 Bearer Token 调用 Webhook。使用线上实例需要管理员授予访问权限。

## 功能

- **项目与服务商**：按项目设置发件名称、邮箱前缀、邮件服务商和每日 / 每月额度，生成或轮换 Webhook Token。
- **模板管理**：用 Markdown 编写正文和 `{{变量}}` 占位符，声明变量类型、必填项与默认值，预览或试发模板。
- **收件人规则**：默认只向项目白名单发送；项目可以开启「Accept any email address」，由调用方负责确认收件地址。
- **Webhook 发送控制**：校验模板变量、检查额度；同一项目向同一地址发送有五分钟冷却时间，并支持请求幂等键。
- **日志与统计**：分别查看发送记录和 Webhook 请求记录，按项目筛选，查看仪表盘与近期发送趋势。
- **两种发送后端**：项目可以选择 Resend API 或 Cloudflare 的 `EMAIL` 绑定；未选服务商的项目使用环境变量中的旧版 Resend 配置。

## 使用

1. 通过 Cloudflare Access 打开管理界面，在 **Providers** 配置服务商和发件域名。Resend 需要有效 API Key；Cloudflare 模式需要可用的 Email Routing 发送绑定及符合其规则的地址。
2. 创建项目，选择服务商、发件名称、邮箱前缀与额度，保存创建时返回的 Webhook Token。需要新 Token 时可在项目详情中轮换。
3. 为项目添加收件人和模板。例如创建 slug 为 `welcome` 的模板，声明字符串变量 `name`，在正文中使用 `{{name}}`。
4. 用项目 ID 和 Token 发起请求；将下面的占位值换成自己的配置。`template` 是模板 slug，`variables` 的值均为字符串。

```bash
curl --fail-with-body https://dove.hexly.ai/api/webhook/PROJECT_ID/send \
  -X POST \
  -H 'Authorization: Bearer PROJECT_WEBHOOK_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '{
    "template": "welcome",
    "to": "reader@example.com",
    "idempotency_key": "signup-example-001",
    "variables": { "name": "Reader" }
  }'
```

白名单模式下，`to` 可以是已登记的邮箱或收件人 ID；开启任意地址模式后只接受邮箱，不会自动保存为白名单记录。成功返回 HTTP 200 和 `status: "sent"`，表示服务商调用成功；它不是收件箱送达或已读回执。

同一项目用相同幂等键和内容重试，成功请求会返回已有结果；请求仍在处理中返回 409，键相同但内容不同返回 422。额度或地址冷却触发时返回 429；地址冷却还提供 `Retry-After` 和 `error.retry_after_seconds`。

## 开发

使用 Bun 安装依赖；CI 使用 Bun 1.3.11。HTTP 与浏览器测试中的 `npx` 命令还需要 Node.js / npm。

**默认 `bun dev` 连接生产 D1。首次本地运行请显式使用 `--env test`，不要用默认环境初始化或迁移数据库。**

```bash
git clone https://github.com/nocoo/dove.git
cd dove
bun install --frozen-lockfile
bun run build
bun run scripts/setup-ci-env.ts
bunx wrangler dev --env test --env-file .env.test --port 7034
```

`setup-ci-env.ts` 只在 `.env.test` 不存在时生成占位配置。已有文件需确认 `EMAIL_DRY_RUN=true`、`RESEND_DRY_RUN=true`，并按[本地开发指南](docs/04-development.md)检查其余测试值。启动后，在另一个终端初始化本地测试库，再打开 `http://localhost:7034`：

```bash
curl --fail-with-body -X POST http://localhost:7034/api/db/init
```

localhost 自动使用开发身份。UI 由 `dist/client` 提供，修改前端后需要重新运行 `bun run build`。

本地演练发送时，让项目保持未选择服务商，使用占位 Resend 配置。当前 dry-run 开关只作用于这个旧版路径；已选择的 Resend 服务商和 Cloudflare 服务商不受这些开关保护。模板试发也遵循这一限制。

| 路径 / 命令 | 用途 |
| --- | --- |
| `src/server/` | Hono API、Access 验证、D1 查询与发送流程 |
| `src/client/` | Vite / React 管理界面 |
| `src/lib/` | 共享类型、邮件模板与服务商实现 |
| `bun run build` | 将管理界面构建到 `dist/client` |
| `bun run typecheck` | TypeScript 检查 |
| `bun run lint` | Biome 检查 |

`main` 的 CI 成功后，GitHub Release 工作流会自动构建并部署 Worker；版本标签也有部署入口。D1、Access 与邮件配置的准备见[开发与部署说明](docs/04-development.md)，仓库使用 GitHub CD 部署。

## 测试

```bash
bun run test
bun run test:webhook
```

Vitest 检查服务端和共享库；`test:webhook` 运行隔离目录中的 Webhook、模板试发和 Access 验证测试。

HTTP 与浏览器测试先准备静态资源和测试配置，再运行：

```bash
bun run build
bun run scripts/setup-ci-env.ts
bun run test:e2e:api
bunx playwright install chromium
bun run test:e2e:bdd
```

HTTP 测试自行启动端口 17034 的 Worker，初始化本地 D1 并验证测试标记；Playwright 使用端口 27034，覆盖仪表盘、项目与模板操作、日志和页面加载。两者都使用 `--env test` 与 `.env.test`，共用该 checkout 的本地测试库，按顺序运行。请使用生成的占位配置，并保持两个测试端口空闲。

## 技术栈

| 技术 | 用途 |
| --- | --- |
| TypeScript、Bun | 应用代码、依赖与开发脚本 |
| Cloudflare Workers、Hono | API 运行时、路由与静态资源托管 |
| Cloudflare D1 | 项目、模板、服务商、日志与限频状态 |
| React、Vite、React Router | 管理界面与前端构建 |
| Tailwind CSS、shadcn/ui、Recharts | 界面组件、样式与图表 |
| Cloudflare Access、jose | 管理界面身份验证与 JWT 校验 |
| Zod、Marked | 请求 / 变量校验与 Markdown 邮件渲染 |
| Resend、Cloudflare Email Routing | 邮件发送 |
| Vitest、Playwright | 服务端测试与浏览器测试 |

## 文档

- [文档索引](docs/README.md)：当前指南与历史方案的入口。
- [本地开发与部署](docs/04-development.md)：测试环境、发送配置、数据与部署前提。
- [变更记录](CHANGELOG.md)：版本变化。

## 许可证

[MIT](LICENSE) © 2026 Zheng Li。
