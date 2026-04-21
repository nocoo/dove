# Dove

Self-hosted email relay service. Personal projects send emails via webhook; Dove manages templates, recipients, quotas, and logs, forwarding via configurable email providers (Resend, Cloudflare Email Routing).

## Tech Stack

| Component | Choice |
|---|---|
| Runtime | Cloudflare Workers |
| API Framework | Hono |
| Language | TypeScript (strict mode, `exactOptionalPropertyTypes`) |
| Database | Cloudflare D1 (native binding) |
| Session Store | Cloudflare KV |
| Auth | Google OAuth (manual flow) + KV sessions + email whitelist |
| Frontend | React 19 SPA (Vite + React Router) |
| UI | Tailwind CSS v4 + shadcn/ui (basalt design system) |
| Charts | Recharts |
| Validation | Zod v4 |
| Email | Resend API / Cloudflare Email Routing |
| Dev Runtime | Bun |
| Deployment | `wrangler deploy` (single command) |

## Project Structure

```
src/
  server/
    index.ts               # Hono app entry (all route mounts + middleware)
    env.ts                  # Env type definitions (D1, KV, secrets)
    middleware/
      auth-session.ts       # Cookie-based session auth (KV lookup)
      auth-bearer.ts        # Bearer token auth (webhook endpoints)
    routes/
      auth.ts               # Google OAuth flow + session management
      projects.ts           # Project CRUD
      recipients.ts         # Recipient CRUD (per-project whitelist)
      templates.ts          # Template CRUD + preview
      providers.ts          # Email provider CRUD
      send-logs.ts          # Paginated send log viewer
      webhook-logs.ts       # Paginated webhook log viewer
      stats.ts              # Dashboard totals + chart data
      webhook.ts            # Bearer token endpoints (health, send, templates)
      db-init.ts            # D1 schema init (localhost only)
    lib/
      db/
        d1.ts               # D1 native binding helpers (query, queryOne, execute)
        projects.ts          # Project DB operations
        recipients.ts        # Recipient DB operations
        templates.ts         # Template DB operations
        send-logs.ts         # Send log DB operations
        webhook-logs.ts      # Webhook log DB operations
        email-providers.ts   # Email provider DB operations
      email/
        provider.ts          # Provider factory + health check
        providers/
          resend.ts          # Resend API provider
          cloudflare.ts      # Cloudflare Email Routing provider
        quota.ts             # Daily/monthly quota checking (D1 native)
        render.ts            # Markdown → HTML + variable substitution
      session.ts             # KV session CRUD
      sanitize.ts            # Strip secrets from API responses
      pagination.ts          # Cursor pagination helpers
      id.ts                  # nanoid generators
      version.ts             # Version from package.json
    __tests__/               # Server unit tests (bun:test)
  client/
    main.tsx                 # React Router SPA entry
    lib/
      api.ts                 # Typed fetch wrapper (apiGet, apiPost, apiPut, apiDelete)
      auth.ts                # Auth helpers (fetchUser, signOut)
    components/
      auth-provider.tsx      # React auth context + unauthenticated redirect
      layout/
        app-shell.tsx        # Main layout shell
        sidebar.tsx          # Navigation sidebar
        breadcrumbs.tsx      # Breadcrumb navigation
        sidebar-context.ts   # Sidebar state
    routes/
      login.tsx              # Google sign-in page (no auth required)
      index.tsx              # Dashboard
      projects/              # Project list, new, detail
      templates/             # Template list, new, detail
      providers/             # Provider list, new, detail
      send-logs.tsx          # Send log viewer
      webhook-logs.tsx       # Webhook log viewer
  lib/
    types/
      project.ts             # Project type (shared between server & client)
      email-provider.ts      # EmailProviderRecord + EmailProviderType
      template.ts            # TemplateVariable type
    email/
      provider.ts            # Provider interface + factory
      provider-schema.ts     # Provider config Zod schemas
      providers/
        resend.ts            # Resend provider implementation
        cloudflare.ts        # Cloudflare provider implementation
      render.ts              # Template rendering pipeline
      resend.ts              # Legacy Resend client
    id.ts                    # nanoid generators (21-char ID, 48-char webhook token)
    hosts.ts                 # Host allowlist + buildBaseUrl()
    sanitize.ts              # Strip webhook_token / mask api_key
    pagination.ts            # Pagination utilities
    version.ts               # Version reader
    utils.ts                 # cn() tailwind merge
  components/
    layout/                  # Shared layout components
    charts/                  # Dashboard charts (Recharts)
    ui/                      # shadcn/ui primitives
  hooks/
    use-mobile.ts            # Mobile detection hook
  __tests__/                 # Shared lib unit tests (bun:test)
scripts/
  check-coverage.ts          # 90% coverage gate
  run-e2e.ts                 # L2 server lifecycle
  gate-security.ts           # G2: osv-scanner + gitleaks
  release.ts                 # SemVer + CHANGELOG + GitHub release
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
| Dev server | 7034 |
| L2 API E2E | 17034 |
| L3 BDD E2E | 27034 |

## Common Commands

```bash
bun dev                # Dev server (7034)
bun run build          # Production build
bun test               # Unit tests
bun run test:coverage  # Unit tests + 90% coverage gate
bun run typecheck      # TypeScript type check
bun run lint           # ESLint
bun run lint:staged    # ESLint on staged files only
bun run gate:security  # Security scan (osv-scanner + gitleaks)
bun run test:e2e:api   # L2 API E2E (port 17034)
bun run test:e2e:bdd   # L3 Playwright BDD E2E (port 27034)
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

- **2026-03-30 Port migration miss**: Global port rename (7046→7032) missed `.env.test` because it's in `.gitignore`. Lesson: when doing project-wide config changes (ports, URLs, keys), always grep untracked/ignored files too (`git ls-files --others --ignored --exclude-standard | xargs grep`).
- **2026-04-21 Shared type extraction during cleanup**: Deleting old `src/lib/db/` broke `sanitize.ts`, `render.ts`, `provider.ts` which imported types from there. Lesson: when deleting modules, trace all type-only imports first — shared types need extraction before deletion.
