<p align="center">
  <img src="../assets/brand/icon-rounded.png" width="128" height="128" alt="Dove Logo" />
</p>
<h1 align="center">Dove</h1>
<p align="center">Manage email templates for personal projects, send notifications through webhooks, and inspect their records.</p>
<p align="center">
  <a href="https://dove.hexly.ai">Website</a> ·
  <a href="../README.md">简体中文</a>
</p>

## What it does

Dove is a self-hosted email relay. Applications, scripts, and scheduled jobs submit a template name, recipient, and variables. Dove validates the request, calls Resend or Cloudflare Email Routing during that request, and records the result.

The dashboard and API run in one Cloudflare Worker. D1 stores projects, templates, recipients, and logs. Cloudflare Access protects dashboard access, while each project has its own Bearer token for webhook calls. An administrator must grant access to the hosted instance.

## Features

- **Projects and providers**: configure sender names, address prefixes, providers, and daily / monthly allowances per project; generate or rotate webhook tokens.
- **Templates**: write Markdown bodies with `{{variable}}` placeholders, define variable types, required fields, and defaults, then preview or send a test message.
- **Recipient rules**: send to the project whitelist by default, or enable “Accept any email address” when the calling application verifies its recipients.
- **Webhook sending controls**: validate variables, check quotas, apply a five-minute cooldown per project and recipient address, and accept idempotency keys.
- **Logs and statistics**: inspect send logs and webhook request logs separately, filter by project, and view dashboard summaries and recent sending trends.
- **Two sending backends**: select the Resend API or Cloudflare's `EMAIL` binding for a project. Projects without a selected provider use the legacy Resend environment configuration.

## Usage

1. Open the dashboard through Cloudflare Access and configure a provider and sending domain under **Providers**. Resend requires a valid API key. Cloudflare requires a working Email Routing send binding and addresses that meet its sending rules.
2. Create a project, choose its provider, sender name, address prefix, and quotas, and save the webhook token returned at creation. Rotate the token from the project detail page when a new one is needed.
3. Add a recipient and a template to the project. For example, create a template with slug `welcome`, declare a string variable named `name`, and use `{{name}}` in its body.
4. Make a request with the project ID and token. Replace the placeholders below with your configuration. `template` is the template slug, and every value in `variables` is a string.

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

In whitelist mode, `to` accepts a registered email address or recipient ID. With any-address mode enabled, it accepts email addresses only and does not save them to the whitelist. HTTP 200 with `status: "sent"` means the provider call succeeded; it does not confirm inbox delivery or that the message was read.

Retrying the same content and idempotency key within a project returns the existing result after a successful send. An in-progress request returns 409; reusing the key with different content returns 422. Quotas and address cooldowns return 429. Address cooldown responses also include `Retry-After` and `error.retry_after_seconds`.

## Development

Install dependencies with Bun; CI uses Bun 1.3.11. The `npx` commands used by HTTP and browser tests also require Node.js / npm.

**The default `bun dev` connects to production D1. For an initial local setup, explicitly use `--env test`; do not initialize or migrate the database through the default environment.**

```bash
git clone https://github.com/nocoo/dove.git
cd dove
bun install --frozen-lockfile
bun run build
bun run scripts/setup-ci-env.ts
bunx wrangler dev --env test --env-file .env.test --port 7034
```

`setup-ci-env.ts` generates placeholder configuration only when `.env.test` does not exist. For an existing file, confirm `EMAIL_DRY_RUN=true` and `RESEND_DRY_RUN=true`, and check the other test values in the [local development guide](04-development.md). Once the Worker starts, initialize the local test database in another terminal and open `http://localhost:7034`:

```bash
curl --fail-with-body -X POST http://localhost:7034/api/db/init
```

Localhost automatically uses the development identity. The UI is served from `dist/client`; run `bun run build` again after frontend changes.

For local sending exercises, leave the project's provider unselected and use the placeholder Resend configuration. The current dry-run switches apply only to this legacy path. Selected Resend providers and Cloudflare providers are not protected by these switches. Template test sends have the same limitation.

| Path / command | Purpose |
| --- | --- |
| `src/server/` | Hono API, Access verification, D1 queries, and sending flow |
| `src/client/` | Vite / React dashboard |
| `src/lib/` | Shared types, email templates, and provider implementations |
| `bun run build` | Build the dashboard into `dist/client` |
| `bun run typecheck` | TypeScript checks |
| `bun run lint` | Biome checks |

After CI succeeds on `main`, the GitHub Release workflow builds and deploys the Worker automatically. Version tags have a deployment path as well. See the [development and deployment guide](04-development.md) for D1, Access, and email prerequisites. This repository deploys through GitHub CD.

## Tests

```bash
bun run test
bun run test:webhook
```

Vitest checks server code and shared libraries. `test:webhook` runs the isolated webhook, template test-send, and Access verification tests.

Build the static assets and prepare the test configuration before running HTTP and browser tests:

```bash
bun run build
bun run scripts/setup-ci-env.ts
bun run test:e2e:api
bunx playwright install chromium
bun run test:e2e:bdd
```

The HTTP runner starts its own Worker on port 17034, initializes local D1, and verifies its test marker. Playwright uses port 27034 and covers the dashboard, project and template operations, logs, and page loading. Both use `--env test` and `.env.test`, sharing the checkout's local test database, so run them sequentially. Use the generated placeholder configuration and keep both test ports free.

## Stack

| Technology | Purpose |
| --- | --- |
| TypeScript, Bun | Application code, dependencies, and development scripts |
| Cloudflare Workers, Hono | API runtime, routing, and static asset hosting |
| Cloudflare D1 | Projects, templates, providers, logs, and rate-limit state |
| React, Vite, React Router | Dashboard and frontend build |
| Tailwind CSS, shadcn/ui, Recharts | Components, styling, and charts |
| Cloudflare Access, jose | Dashboard authentication and JWT verification |
| Zod, Marked | Request / variable validation and Markdown email rendering |
| Resend, Cloudflare Email Routing | Email sending |
| Vitest, Playwright | Server and browser tests |

## Documentation

- [Documentation index](README.md): current guides and historical designs.
- [Local development and deployment](04-development.md) (Chinese): test environment, sending configuration, data, and deployment prerequisites.
- [Changelog](../CHANGELOG.md): release history.

## License

[MIT](../LICENSE) © 2026 Zheng Li.
