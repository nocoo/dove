# Dove

Self-hosted email relay service. Personal projects send emails via webhook; Dove manages templates, recipients, quotas, and logs, forwarding to Resend API.

## Tech Stack

| Component | Choice |
|---|---|
| Runtime | Bun |
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict mode) |
| UI | Tailwind CSS v4 + shadcn/ui (basalt design system) |
| Charts | Recharts |
| Validation | Zod v4 |
| Auth | NextAuth v5 + Google OAuth (whitelist) |
| Database | Cloudflare D1 via Worker proxy |
| Email | Resend API |
| Deployment | Railway (app) + Cloudflare (worker), port 7046 |

## Project Structure

```
src/
  app/
    api/
      auth/              # NextAuth v5 handler (Google OAuth)
      projects/          # CRUD + token regeneration
      recipients/        # CRUD (per-project whitelist)
      templates/         # CRUD + preview
      send-logs/         # Paginated log viewer
      webhook-logs/      # Paginated log viewer
      stats/             # Dashboard totals + chart data
      webhook/           # Bearer token endpoints (health, send, templates)
      db/init/           # D1 schema init (session auth + non-production only)
      live/              # Health check (D1 ping + version)
    page.tsx             # Dashboard (stats, quota gauges, charts)
    layout.tsx           # Root layout
    login/               # Google OAuth login page
    projects/            # Project list + detail pages
    templates/           # Template list + editor pages
    send-logs/           # Send log viewer page
    webhook-logs/        # Webhook log viewer page
  auth.ts                # NextAuth v5 config (Google OAuth, email whitelist)
  proxy.ts               # Auth proxy (Next.js 16)
  components/
    layout/              # AppShell, sidebar, breadcrumbs, theme toggle
    charts/              # Dashboard charts
    ui/                  # shadcn/ui primitives
    template-editor.tsx  # Markdown editor + preview
  hooks/
    use-is-mobile.ts
  lib/
    db/
      d1-client.ts       # D1 proxy client (HTTPS → Worker)
      schema.ts           # CREATE TABLE + migrations
      projects.ts         # Project CRUD
      recipients.ts       # Recipient CRUD
      templates.ts        # Template CRUD
      send-logs.ts        # Send log queries
      webhook-logs.ts     # Webhook log queries
    email/
      resend.ts           # Resend API client
      render.ts           # Markdown → HTML + variable substitution
      quota.ts            # Daily/monthly quota checking
    id.ts                 # nanoid generators (21-char ID, 48-char webhook token)
    hosts.ts              # x-forwarded-host allowlist + buildBaseUrl()
    sanitize.ts           # Strip webhook_token from responses
    utils.ts              # cn() tailwind merge
worker/                  # Cloudflare Worker (D1 proxy)
  src/index.ts           # Worker entry point
  wrangler.toml          # D1 binding + env config
  package.json
  tsconfig.json
scripts/
  check-coverage.ts      # 90% gate
  run-e2e.ts             # L2 server lifecycle
  gate-security.ts       # G2: osv-scanner + gitleaks
  release.ts             # SemVer + CHANGELOG + GitHub release
```

## Quality System (3 Test Layers + 2 Gates)

| Layer | Tool | Script | Trigger | Requirement |
|---|---|---|---|---|
| L1 Unit | bun test | `bun run test:coverage` | pre-commit | 90%+ coverage |
| L2 Integration/API | Custom BDD runner | `bun run test:e2e:api` | pre-push | All route/method combos |
| L3 System/E2E | Playwright (Chromium) | `bun run test:e2e:bdd` | on-demand | Core user flow specs |
| G1 Static Analysis | tsc + ESLint | `bun run typecheck && bun run lint:staged` | pre-commit | 0 errors, 0 warnings |
| G2 Security | osv-scanner + gitleaks | `bun run gate:security` | pre-push | 0 vulnerabilities, 0 leaked secrets |

### Hooks Mapping

| Hook | Budget | Runs |
|---|---|---|
| pre-commit | <30s | G1 → L1 (sequential) |
| pre-push | <3min | L2 ‖ G2 (parallel) |
| on-demand | — | L3 |

### Port Convention

| Purpose | Port |
|---|---|
| Dev server | 7046 |
| L2 API E2E | 17046 |
| L3 BDD E2E | 27046 |

## Common Commands

```bash
bun dev                # Dev server (7046)
bun run build          # Production build
bun test               # Unit tests
bun run test:coverage  # Unit tests + 90% coverage gate
bun run typecheck      # TypeScript type check
bun run lint           # ESLint
bun run lint:staged    # ESLint on staged files only
bun run gate:security  # Security scan (osv-scanner + gitleaks)
bun run test:e2e:api   # L2 API E2E (port 17046)
bun run test:e2e:bdd   # L3 Playwright BDD E2E (port 27046)
```

## Release

Version is managed in `package.json` (single source of truth). Versioning follows SemVer.

```bash
bun run release              # Z+1 patch (default)
bun run release -- minor     # Y+1 minor
bun run release -- major     # X+1 major
bun run release -- --dry-run # preview without side effects
```

## Retrospective

(none yet)
