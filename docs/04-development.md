# 本地开发与部署

## 当前结构

Vite 将 `src/client/` 的 React 管理界面构建到 `dist/client`。Cloudflare Workers Static Assets 提供页面，`/api/*` 先进入 `src/server/index.ts` 的 Hono API。数据直接读写 D1；发送请求在 Worker 内调用邮件服务商。

| 入口 | 端口 | 数据库 |
| --- | --- | --- |
| 默认 `bun dev` | 7034 | `dove-db`，配置了 `remote = true`，连接生产数据 |
| 本文的 `--env test` 本地开发 | 7034 | 本地 `dove-db-test` |
| `bun run test:e2e:api` | 17034 | 同一 checkout 的本地 `dove-db-test` |
| `bun run test:e2e:bdd` | 27034 | 同一 checkout 的本地 `dove-db-test` |

端口不同不代表本地 D1 分离。测试环境只存放可丢弃的演练记录，开发和测试按顺序使用。保持 `--env test`，不要添加 `--persist-to`，也不要通过默认环境执行初始化、迁移或清空操作。

## 首次本地运行

准备 Bun、Node.js / npm。仓库 CI 使用 Bun 1.3.11，测试脚本通过 `npx` 启动 Wrangler 和 Playwright。

```bash
bun install --frozen-lockfile
bun run build
bun run scripts/setup-ci-env.ts
```

生成脚本不会覆盖已有 `.env.test`。本地演练所需值如下；使用占位密钥，不需要真实邮件服务商账号：

```dotenv
D1_WORKER_URL=http://localhost:17034
D1_WORKER_API_KEY=ci-placeholder
EMAIL_DRY_RUN=true
RESEND_DRY_RUN=true
DEV_MODE=true
RESEND_API_KEY=re_ci_placeholder_not_real
RESEND_FROM_DOMAIN=test.example.com
```

前两项供 HTTP 测试脚本读取；D1 绑定由 `wrangler.toml` 的 `env.test` 决定。显式 `--env-file .env.test` 选择测试值，不依赖默认 `.dev.vars`。

```bash
bunx wrangler dev --env test --env-file .env.test --port 7034
```

Worker 启动后，在另一个终端执行：

```bash
curl --fail-with-body -X POST http://localhost:7034/api/db/init
curl --fail-with-body http://localhost:7034/api/live
```

第一条在本地测试库创建表和测试标记；第二条检查 Worker 与 D1 连接。然后打开 `http://localhost:7034`。localhost 使用内置开发身份，无需 Cloudflare Access 登录。修改前端代码后重新运行 `bun run build`，再刷新页面。

初始化接口使用 `CREATE TABLE IF NOT EXISTS`，适合新测试库，不负责将已有旧表升级到新结构。

## 邮件配置与演练边界

| 配置方式 | 发送所需内容 | dry-run 行为 |
| --- | --- | --- |
| 项目不选 Provider，使用旧版 Resend | `RESEND_API_KEY`、`RESEND_FROM_DOMAIN` | `EMAIL_DRY_RUN=true` 或 `RESEND_DRY_RUN=true` 时生成模拟消息 ID，不调用 Resend |
| 项目选择 Resend Provider | 数据库服务商记录中的域名、`config.api_key` | 当前创建路径不应用环境变量 dry-run 开关，会尝试调用 Resend |
| 项目选择 Cloudflare Provider | 服务商域名与可用的 `EMAIL` 发送绑定 | 当前实现不支持 dry-run |

本地演练选择第一种方式，不把项目关联到真实服务商。`env.test` 没有声明 `send_email` 绑定，因此也不能据此验证 Cloudflare 真实发送。

真实发送前，发件域名与收件地址应满足对应服务商的规则。Cloudflare 模式使用 Email Routing 的 `send_email` 绑定；Resend 使用其 `/emails` API。项目的发件地址由 `from_name <email_prefix@domain>` 组合。服务商健康接口报告配置和历史统计，未执行实时投递探测。

模板预览只生成渲染结果。模板的 **Test Send** 会直接调用项目的服务商，不经过 Webhook 的白名单、配额、地址冷却与发送日志流程，因此不能用它验证这些规则。它同样受上表所述 dry-run 边界约束。

## Webhook 行为

完整示例见 [README](../README.md)。当前发送路径是 `POST /api/webhook/:projectId/send`。使用项目 Bearer Token；`GET /api/webhook/:projectId` 可检查 Token，`GET /api/webhook/:projectId/templates` 可列出模板。

- `template` 为项目内模板 slug；`to` 为收件地址，或白名单模式下的收件人 ID。
- `variables` 是字符串映射。模板声明数字或布尔类型时仍传字符串，由渲染器验证并转换。
- `idempotency_key` 可选，作用域为项目。同键同内容的成功重试复用已有结果；处理中的请求返回 409，内容不一致返回 422。
- 默认白名单模式验证收件人属于该项目。任意地址模式只接受邮箱，调用方负责地址归属验证。
- 日 / 月额度检查与地址冷却都返回 429；地址冷却包含等待秒数。同一项目与地址的冷却窗口为五分钟，明确的发送失败会释放锁供重试。
- `sent` 表示邮件服务商调用成功，dry-run 路径也会返回该状态。Dove 当前没有收件箱送达、退信或已读回执追踪。

## 部署前提

部署使用 [GitHub Release 工作流](../.github/workflows/release.yml)。`main` 的 CI 成功后部署 CI 验证过的提交；版本标签或带标签的手动工作流也可部署。仓库约定通过 GitHub CD 发布，不在本机运行 `wrangler deploy`。

自行部署前需要准备：

- 自己账号下的 D1 数据库与 Worker 域名，并调整 `wrangler.toml` 的生产绑定。新库结构见 [`src/server/schema.sql`](../src/server/schema.sql)，旧库变更见 [`migrations/`](../migrations/)；Release 工作流不会自动初始化或迁移数据库。
- GitHub 的 `production` 环境及工作流使用的 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。
- Cloudflare Access 应用与允许访问的用户策略，以及 Worker 中的 `CF_ACCESS_TEAM_DOMAIN`、`CF_ACCESS_AUD`。team domain 使用 `example.cloudflareaccess.com` 形式，不带协议前缀。生产不启用 `DEV_MODE`。
- 可用的 Resend 配置或 Cloudflare Email Routing 发送绑定。新建 Provider 后仍需在项目中选择它；使用旧版方式时配置 `RESEND_API_KEY`、`RESEND_FROM_DOMAIN`。

`GET /api/live` 检查 Worker 和 D1 连接。它不验证 Access 策略、数据库所有表或邮件真实送达，部署工作流的健康检查也不等同于投递测试。
