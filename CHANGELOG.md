# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## v0.4.5

### Changed
- Bump pinned react/react-dom 19.2.4 → 19.2.7 + vite 8.0.10 → 8.0.16
- Batch bump minor/patch (18 packages)
- Upgrade lucide-react 1.11 → 1.17.0
- Upgrade marked 15 → 18.0.5
- Upgrade lint-staged 16 → 17.0.7
- Upgrade eslint 9 → 10.4.1 + typescript-eslint 8.60.1
- Upgrade typescript 5.9 → 6.0.3
- Add --ignore-scripts to custom workflows (Shai-Hulud defense)
- Update test references from bun test to vitest

### Fixed
- Bump hono, react-router, ws, brace-expansion (CVE)
- Upgrade hono to fix CVEs (GHSA-69xw, GHSA-9vqf)
- Replace bg-input with bg-secondary in switch component
- Remove pink color bleed from avatar and status badges

## v0.4.4

### Added
- Per-address rate limiting + recipient mode UI toggle
- Per-project allow_unknown_recipients flag (default off)
- Constant-time webhook bearer-token comparison + 500 message-leak fix
- Block javascript:/data:/vbscript: + protocol-relative URLs in markdown renderer

### Changed
- Align coverage config with pew best practices
- Session log + ideas backlog
- Comprehensive test-suite hardening (1.59 -> 4.61 expects/test, +190%)
- Bench-tests.ts with 5 hard quality gates + audit-test-quality.ts
- Switch to forks pool + fake timers (9.86s -> 500ms, -94.9%)
- Unify HTML title to "dove - Self-Hosted Email Relay"
- Consolidate L2/L3 into base-ci workflow
- Align with zhe CI config standards
- Add comprehensive email provider coverage
- Migrate from bun:test to vitest
- Parallelize pre-commit hook stages
- Upgrade vite to 8.0.10
- Upgrade base-ci to v2026.1
- Auto-deploy to Cloudflare on main after CI passes
- Bump postcss to 8.5.10 to fix GHSA-qx2v-qp2m-jg93
- Add release workflow for tag-triggered Cloudflare Worker deploy

### Fixed
- Correct lock release semantics for rate limiting
- Add .wrangler/** to eslint globalIgnores
- Strip line comments before splitting db-init SCHEMA_SQL
- Sync db-init.ts SCHEMA_SQL with allow_unknown_recipients
- Block ASCII control char insertion bypass (java&Tab;script:)
- Named entity bypass + full coverage gate alignment
- HTML entity-encoded URL scheme bypass + coverage gate alignment
- Correct logo path in README
- Anchor collapsed sidebar logo to prevent jitter
- Allow localhost as a self-identifying test instance

### Removed
- Remove dead code modules
- Remove unused dove-test worker config

## v0.4.3

### Changed
- Make provider test domains unique to avoid UNIQUE constraint failure
- Add _test_marker safety net for E2E DB isolation
- Gate L3 page coverage and add page-coverage smoke spec
- Gate L2 route coverage and backfill providers/auth/test-send
- Move gitleaks to pre-commit, keep osv on pre-push
- Raise threshold to 95% and parse stderr correctly
- Build and deploy after tag push

## v0.4.2

### Added
- Add copy buttons for webhook URL and project ID

### Fixed
- Confirm recipient removal before destructive action
- Mount Toaster so toast calls are visible

## v0.4.1

### Fixed
- Import EmailMessage from cloudflare:email

### Removed
- Remove interactive confirmation from release script

## v0.4.0

### Changed
- Add src/server/lib/version.ts to release version targets
- Fix L3 project/template create-view assertions
- Fix CI E2E env: inject RESEND_FROM_DOMAIN + .env.test for L3
- Add L2 API E2E and L3 browser E2E jobs
- Fix E2E test infrastructure for CF Access auth migration
- Switch auth from Google OAuth to Cloudflare Access JWT
- Clean repo-level Next.js remnants
- Rewrite README for Cloudflare Workers, archive old Next.js docs
- Fix static asset paths for Vite directory layout
- Fix components.json for Vite: rsc false, correct CSS path
- Rename NEXT_PUBLIC_APP_VERSION to __APP_VERSION__
- Replace next dev with wrangler dev in E2E infrastructure
- Use sonner Toaster directly with explicit position and richColors
- Move Toaster inside App component tree and restore toast calls
- Guard res.json() parse failure in test send handler
- Replace toast with inline feedback for test send results
- Fix toast visibility and EmailMessage crash in dev
- Mount Toaster component so toast notifications actually render
- Fix test-send and preview to merge all declared variables with defaults
- Add top-level error logging to test-send endpoint
- Add test send endpoint and UI to template detail page
- Inject app version into Vite build via define
- Fix sidebar logo and connect dev to remote D1/KV
- Fix dev port to 7034 matching Caddy config
- Fix idempotency retry race, From RFC 2047, and DEV_MODE bypass
- Fix failed-slot reclaim race and From header RFC 2047 encoding
- Fix CloudflareProvider idempotency retry and MIME encoding
- Fix webhook test suite isolation and Happy DOM interference
- Add L3 passive send_logs health probe to provider health endpoint
- Fix localhost /api/auth/me cookie-gating deadlock
- Add Layer 2 idempotency to CloudflareProvider via D1
- Update CLAUDE.md for login page and auth-provider changes
- Fix webhook waitUntil, error passthrough, and hash ordering
- Rewrite CloudflareProvider to use env.EMAIL binding
- Add login page and auth guard redirect
- Update plan doc with completion status for all C001-C076 steps
- Mark quality-upgrade doc as partially superseded by 03
- Update CLAUDE.md for Cloudflare Workers architecture
- Add db-init route for local schema initialization
- Integrate all client routes into React Router config
- C045-C056: Port all Next.js pages to React Router SPA route components
- C041-C044: Add client API fetch wrapper
- C039-C040: Port layout components to React Router SPA
- C037-C038: Add client auth module and AuthProvider context
- Integrate all routes into server index with session middleware
- Add webhook send route with 12-step pipeline
- Add server-side Cloudflare provider (re-export from shared)
- Add server-side Resend provider (re-export from shared)
- Add server-side provider interface + factory
- Add server-side quota check with D1 binding
- Add server-side template render (re-export from shared)
- Mark C022-C029 API routes as complete
- Add Stats dashboard + charts API routes with Hono
- Add Webhook-logs paginated query API route with Hono
- Add Send-logs paginated query API route with Hono
- Add Providers CRUD + health API routes with Hono
- Add Templates CRUD + preview API routes with Hono
- Add Recipients CRUD API routes with Hono
- Add Projects CRUD API routes with Hono
- C019-C021: Add server utility functions
- Add bearer auth middleware
- Add Google OAuth routes
- Add session auth middleware
- Add KV session utilities
- Add test env secrets and fix field name inconsistency
- Fix 3 remaining inconsistencies in 03-cloudflare-rewrite
- Address 3 review findings in 03-cloudflare-rewrite
- Enrich 03-cloudflare-rewrite with edge deployment details from bat
- Add complete D1 schema.sql
- Add EmailProviders CRUD with native D1 binding
- Add WebhookLogs CRUD with native D1 binding
- Add SendLogs CRUD with native D1 binding
- Add Templates CRUD with native D1 binding
- Add Recipients CRUD with native D1 binding
- Add Projects CRUD with native D1 binding
- Add D1 native binding wrapper
- Fix send_email binding format in wrangler.toml
- Configure React Router v7 with layout and dashboard
- Vite + React 19 skeleton
- Src/server/index.ts + lib/version.ts
- Wrangler.toml + src/server/env.ts
- Add missing /new routes for templates and providers
- Fix 5 implementation gaps in rewrite plan
- Simplify implementation plan for main branch rebuild
- Add atomic commit steps C001-C092 and worker naming
- Fix idempotency_payload_mismatch status code 409→422
- Fix status field, request/response shape, and CloudflareProvider migration
- Fix contract-breaking issues, preserve existing webhook semantics
- Add 03-cloudflare-rewrite design document

### Fixed
- Add RESEND_API_KEY placeholder for L2 webhook send test
- Add DEV_MODE=true for CI L2/L3 schema initialization
- Add Playwright global setup to initialize D1 schema
- Initialize D1 schema before L2 tests in run-e2e.ts
- Add missing typescript-eslint dependency
- Use wrangler --env test for L3 Playwright config

### Removed
- Remove "use client" directives from all components
- Delete dead Next.js layout components
- Remove non-functional Toaster, use inline feedback only for test send
- Fix ResendProvider crash on Workers: remove process.env reference
- Remove dead test-send UI card from provider detail page
- Remove eslint-config-next from ESLint config
- Fix package.json scripts and remove Next.js dependencies
- C072-C073: Remove old Next.js, Railway, and Worker code

## v0.3.0

### Changed
- Add src/server/lib/version.ts to release version targets
- Fix L3 project/template create-view assertions
- Fix CI E2E env: inject RESEND_FROM_DOMAIN + .env.test for L3
- Add L2 API E2E and L3 browser E2E jobs
- Fix E2E test infrastructure for CF Access auth migration
- Switch auth from Google OAuth to Cloudflare Access JWT
- Clean repo-level Next.js remnants
- Rewrite README for Cloudflare Workers, archive old Next.js docs
- Fix static asset paths for Vite directory layout
- Fix components.json for Vite: rsc false, correct CSS path
- Rename NEXT_PUBLIC_APP_VERSION to __APP_VERSION__
- Replace next dev with wrangler dev in E2E infrastructure
- Use sonner Toaster directly with explicit position and richColors
- Move Toaster inside App component tree and restore toast calls
- Guard res.json() parse failure in test send handler
- Replace toast with inline feedback for test send results
- Fix toast visibility and EmailMessage crash in dev
- Mount Toaster component so toast notifications actually render
- Fix test-send and preview to merge all declared variables with defaults
- Add top-level error logging to test-send endpoint
- Add test send endpoint and UI to template detail page
- Inject app version into Vite build via define
- Fix sidebar logo and connect dev to remote D1/KV
- Fix dev port to 7034 matching Caddy config
- Fix idempotency retry race, From RFC 2047, and DEV_MODE bypass
- Fix failed-slot reclaim race and From header RFC 2047 encoding
- Fix CloudflareProvider idempotency retry and MIME encoding
- Fix webhook test suite isolation and Happy DOM interference
- Add L3 passive send_logs health probe to provider health endpoint
- Fix localhost /api/auth/me cookie-gating deadlock
- Add Layer 2 idempotency to CloudflareProvider via D1
- Update CLAUDE.md for login page and auth-provider changes
- Fix webhook waitUntil, error passthrough, and hash ordering
- Rewrite CloudflareProvider to use env.EMAIL binding
- Add login page and auth guard redirect
- Update plan doc with completion status for all C001-C076 steps
- Mark quality-upgrade doc as partially superseded by 03
- Update CLAUDE.md for Cloudflare Workers architecture
- Add db-init route for local schema initialization
- Integrate all client routes into React Router config
- C045-C056: Port all Next.js pages to React Router SPA route components
- C041-C044: Add client API fetch wrapper
- C039-C040: Port layout components to React Router SPA
- C037-C038: Add client auth module and AuthProvider context
- Integrate all routes into server index with session middleware
- Add webhook send route with 12-step pipeline
- Add server-side Cloudflare provider (re-export from shared)
- Add server-side Resend provider (re-export from shared)
- Add server-side provider interface + factory
- Add server-side quota check with D1 binding
- Add server-side template render (re-export from shared)
- Mark C022-C029 API routes as complete
- Add Stats dashboard + charts API routes with Hono
- Add Webhook-logs paginated query API route with Hono
- Add Send-logs paginated query API route with Hono
- Add Providers CRUD + health API routes with Hono
- Add Templates CRUD + preview API routes with Hono
- Add Recipients CRUD API routes with Hono
- Add Projects CRUD API routes with Hono
- C019-C021: Add server utility functions
- Add bearer auth middleware
- Add Google OAuth routes
- Add session auth middleware
- Add KV session utilities
- Add test env secrets and fix field name inconsistency
- Fix 3 remaining inconsistencies in 03-cloudflare-rewrite
- Address 3 review findings in 03-cloudflare-rewrite
- Enrich 03-cloudflare-rewrite with edge deployment details from bat
- Add complete D1 schema.sql
- Add EmailProviders CRUD with native D1 binding
- Add WebhookLogs CRUD with native D1 binding
- Add SendLogs CRUD with native D1 binding
- Add Templates CRUD with native D1 binding
- Add Recipients CRUD with native D1 binding
- Add Projects CRUD with native D1 binding
- Add D1 native binding wrapper
- Fix send_email binding format in wrangler.toml
- Configure React Router v7 with layout and dashboard
- Vite + React 19 skeleton
- Src/server/index.ts + lib/version.ts
- Wrangler.toml + src/server/env.ts
- Add missing /new routes for templates and providers
- Fix 5 implementation gaps in rewrite plan
- Simplify implementation plan for main branch rebuild
- Add atomic commit steps C001-C092 and worker naming
- Fix idempotency_payload_mismatch status code 409→422
- Fix status field, request/response shape, and CloudflareProvider migration
- Fix contract-breaking issues, preserve existing webhook semantics
- Add 03-cloudflare-rewrite design document

### Fixed
- Add RESEND_API_KEY placeholder for L2 webhook send test
- Add DEV_MODE=true for CI L2/L3 schema initialization
- Add Playwright global setup to initialize D1 schema
- Initialize D1 schema before L2 tests in run-e2e.ts
- Add missing typescript-eslint dependency
- Use wrangler --env test for L3 Playwright config

### Removed
- Remove "use client" directives from all components
- Delete dead Next.js layout components
- Remove non-functional Toaster, use inline feedback only for test send
- Fix ResendProvider crash on Workers: remove process.env reference
- Remove dead test-send UI card from provider detail page
- Remove eslint-config-next from ESLint config
- Fix package.json scripts and remove Next.js dependencies
- C072-C073: Remove old Next.js, Railway, and Worker code

## v0.2.0

### Added
- Admin test-send button on provider edit page
- Project-level provider switcher
- Provider create and edit pages
- Providers list page with health badges
- POST /api/providers/[id]/test-send
- GET /api/providers/[id]/health for config sanity
- CF Email Worker with D1-atomic idempotency
- Accept provider_id on project create/update
- Provider CRUD endpoints (/api/providers)
- Provider dispatch, dry-run toggle, richer response
- SanitizeProvider() + SanitizedProvider type
- Provider abstraction — ResendProvider + CloudflareProvider
- Provider CRUD + provider_id/provider_type on projects & send-logs
- Add email_providers table and schema migration helper

### Changed
- Page-level regression tests for provider + project selector flows
- Record dashboard UI phase (C9–C14) in progress table

### Fixed
- Gate Happy DOM preload on ENABLE_DOM_TESTS env
- Provider edit form — key replace vs append, allow blank test recipient
- Enable nodejs_compat for mimetext build
- Normalize + validate provider domain at the API boundary
- Re-validate stored config on provider type change
- Backfill provider_type='legacy' for all pre-migration rows
- Scope RESEND_DRY_RUN legacy alias to resend/legacy only
- Validate provider-specific config at the API boundary

## v0.1.11

### Changed
- Migrate to nocoo/base-ci@v2026
- Add GitHub Actions CI workflow
- Change dev port from 7032 to 7033
- Add osv-scanner config for false positive suppression
- Upgrade Next.js 16.1.7 → 16.2.2
- Migrate ports 7046/17046/27046 → 7032/17032/27032

### Fixed
- Revert template preview sticky top to top-0
- Use spec-compliant aria-modal value on mobile drawer
- Use opacity for project card arrow hover transition
- Replace direct avatar logout with dropdown menu in sidebar
- Unify card padding and AppShell layout spacing
- Improve login page accessibility
- Add missing transition animations and fix performance
- Add ARIA table roles and fix button>div semantic markup in send logs
- Fix dark mode color warmth and hardcoded color values
- Replace remaining non-standard font sizes
- Improve chart title and template group heading styles
- Replace non-standard font sizes with Tailwind defaults
- Add responsive text-2xl to all page h1 headings
- 迁移到 base-ci@v2026，禁用 L2 E2E
- Update next to fix CVE
- Correct dark mode --input token to B-5 specification

### Removed
- Remove unused next-themes dependency

## v0.1.10

### Changed
- Migrate to nocoo/base-ci@v2026
- Add GitHub Actions CI workflow
- Change dev port from 7032 to 7033
- Add osv-scanner config for false positive suppression
- Upgrade Next.js 16.1.7 → 16.2.2
- Migrate ports 7046/17046/27046 → 7032/17032/27032

### Fixed
- Revert template preview sticky top to top-0
- Use spec-compliant aria-modal value on mobile drawer
- Use opacity for project card arrow hover transition
- Replace direct avatar logout with dropdown menu in sidebar
- Unify card padding and AppShell layout spacing
- Improve login page accessibility
- Add missing transition animations and fix performance
- Add ARIA table roles and fix button>div semantic markup in send logs
- Fix dark mode color warmth and hardcoded color values
- Replace remaining non-standard font sizes
- Improve chart title and template group heading styles
- Replace non-standard font sizes with Tailwind defaults
- Add responsive text-2xl to all page h1 headings
- 迁移到 base-ci@v2026，禁用 L2 E2E
- Update next to fix CVE
- Correct dark mode --input token to B-5 specification

### Removed
- Remove unused next-themes dependency

## v0.1.9

### Added
- Add fade-up entry animation with staggered delays on stat cards
- Add DM Sans font-display system for titles and stat values
- Add SortHeader component with interactive column sorting

### Fixed
- Update Card component from border+shadow to bg-secondary L2 layer
- Remove ghost logo-288 and use logo-80 per basalt B-3 spec
- Dashboard tooltip, avatar, and version badge per basalt B-2 spec
- Login page aspect ratio and callbackUrl validation

## v0.1.4

### Added
- Sakura pink theme, compact cards, unified skeleton loading

### Changed
- Replace inline GitHub SVGs with shared GithubIcon component

### Fixed
- Use PCRE2 lookbehind for stale version check

## v0.1.3

### Added
- Sakura pink theme, compact cards, unified skeleton loading

### Changed
- Replace inline GitHub SVGs with shared GithubIcon component

### Fixed
- Use PCRE2 lookbehind for stale version check

## v0.1.2

### Added
- Add send log filter and webhook log expand specs
- Add template edit and preview BDD spec
- Add logs viewer BDD specs
- Add template CRUD BDD spec
- Add project CRUD BDD spec
- Add dashboard and navigation BDD specs
- Add Playwright config
- Rewrite run-e2e.ts with full server lifecycle
- Deploy test Worker and add _test_marker verification
- Add logo assets pipeline and apply to all surfaces
- Add automated release script
- Add skeleton loading for all pages
- Add L2 API E2E tests covering all 18 REST endpoints
- Add Husky hooks, security gate, and fix lint errors
- Add L1 unit tests with 92%+ function coverage
- Add webhook logs page with project filter and expandable rows
- Add send logs page with filters, pagination, and expandable rows
- Add template pages (list, create, editor with live preview)
- Add projects pages (list, create, detail)
- Add dashboard page with stats cards and sends chart
- Add webhook routes, health check, and db init endpoint
- Add log and stats API routes
- Add template API routes (CRUD + preview)
- Add recipient API routes (CRUD)
- Add project API routes (CRUD + token regeneration)
- Add quota checking (daily + monthly soft limits)
- Add Resend API client with retry and idempotency
- Add template rendering engine
- Add webhook logs queries (fire-and-forget)
- Add send logs queries with quota counting
- Add templates CRUD with variable schema
- Add recipients CRUD with email normalization
- Add projects CRUD and sanitization
- Add database schema for all 5 tables
- Create AppShell layout with sidebar and theme toggle
- Set up Tailwind v4 + shadcn/ui base components
- Set up NextAuth v5 with Google OAuth
- Add ID generation, host validation, and utils
- Add D1 proxy client
- Add Cloudflare Worker D1 proxy
- Initialize project scaffold

### Changed
- Gitignore .claude and .superset tool directories
- Update L3 coverage to match actual specs
- Update quality upgrade verification checklist with results
- Wire test:e2e:bdd to Playwright CLI
- Mark Step 3 and Step 4 complete in quality upgrade plan
- Rewrite webhook test for real HTTP
- Rewrite templates + logs-stats tests for real HTTP
- Rewrite projects + recipients tests for real HTTP
- Rewrite health + db-init tests for real HTTP
- Rewrite e2e/api/helpers.ts for real HTTP
- Require exporting SCHEMA_SQL and PARTIAL_INDEX_SQL from schema.ts
- Change deploy-test-worker from .sh to .ts for schema import
- Require full schema replay (tables + indexes) in test Worker bootstrap
- Fix test Worker bootstrap to seed schema via Worker /query directly
- Fix auth bypass guard, L2 hard-fail, and L3 script wiring
- Fix 5 review issues + add backy-derived D1 isolation safeguards
- Add project README and resize logo to 128x128
- Add quality system upgrade plan (Tier B+ → S)
- Fill CHANGELOG.md with complete v0.1.0 history
- Centralize APP_VERSION constant with tests
- Align card styling with basalt design system
- Add gitleaks allowlist for test fixture tokens
- Align login page and sidebar with pew design system
- Deploy Dove worker to Cloudflare with custom domain
- Initial commit

### Fixed
- Use word-boundary matching in release stale-version check
- Strengthen dashboard, send-log filter, and webhook-log expand specs
- Use inherited stdio for dev server in L2 runner
- Add RESEND_DRY_RUN to prevent real email sends in E2E
- Use 288px logo on login page for Retina clarity
- Increase template detail load timeout for D1 cold start
- Handle async data loading in dashboard and project detail
- Add D1 warmup step and 15s default timeout
- Align BDD spec selectors with actual page snapshots
- Return 400 for D1 UNIQUE constraint violations instead of 500
- Guard E2E auth bypass with NODE_ENV !== production
- Fail hard when security tools are not installed
- Mock APP_VERSION in health E2E test

## v0.1.1

### Added
- Add send log filter and webhook log expand specs
- Add template edit and preview BDD spec
- Add logs viewer BDD specs
- Add template CRUD BDD spec
- Add project CRUD BDD spec
- Add dashboard and navigation BDD specs
- Add Playwright config
- Rewrite run-e2e.ts with full server lifecycle
- Deploy test Worker and add _test_marker verification
- Add logo assets pipeline and apply to all surfaces
- Add automated release script
- Add skeleton loading for all pages
- Add L2 API E2E tests covering all 18 REST endpoints
- Add Husky hooks, security gate, and fix lint errors
- Add L1 unit tests with 92%+ function coverage
- Add webhook logs page with project filter and expandable rows
- Add send logs page with filters, pagination, and expandable rows
- Add template pages (list, create, editor with live preview)
- Add projects pages (list, create, detail)
- Add dashboard page with stats cards and sends chart
- Add webhook routes, health check, and db init endpoint
- Add log and stats API routes
- Add template API routes (CRUD + preview)
- Add recipient API routes (CRUD)
- Add project API routes (CRUD + token regeneration)
- Add quota checking (daily + monthly soft limits)
- Add Resend API client with retry and idempotency
- Add template rendering engine
- Add webhook logs queries (fire-and-forget)
- Add send logs queries with quota counting
- Add templates CRUD with variable schema
- Add recipients CRUD with email normalization
- Add projects CRUD and sanitization
- Add database schema for all 5 tables
- Create AppShell layout with sidebar and theme toggle
- Set up Tailwind v4 + shadcn/ui base components
- Set up NextAuth v5 with Google OAuth
- Add ID generation, host validation, and utils
- Add D1 proxy client
- Add Cloudflare Worker D1 proxy
- Initialize project scaffold

### Changed
- Gitignore .claude and .superset tool directories
- Update L3 coverage to match actual specs
- Update quality upgrade verification checklist with results
- Wire test:e2e:bdd to Playwright CLI
- Mark Step 3 and Step 4 complete in quality upgrade plan
- Rewrite webhook test for real HTTP
- Rewrite templates + logs-stats tests for real HTTP
- Rewrite projects + recipients tests for real HTTP
- Rewrite health + db-init tests for real HTTP
- Rewrite e2e/api/helpers.ts for real HTTP
- Require exporting SCHEMA_SQL and PARTIAL_INDEX_SQL from schema.ts
- Change deploy-test-worker from .sh to .ts for schema import
- Require full schema replay (tables + indexes) in test Worker bootstrap
- Fix test Worker bootstrap to seed schema via Worker /query directly
- Fix auth bypass guard, L2 hard-fail, and L3 script wiring
- Fix 5 review issues + add backy-derived D1 isolation safeguards
- Add project README and resize logo to 128x128
- Add quality system upgrade plan (Tier B+ → S)
- Fill CHANGELOG.md with complete v0.1.0 history
- Centralize APP_VERSION constant with tests
- Align card styling with basalt design system
- Add gitleaks allowlist for test fixture tokens
- Align login page and sidebar with pew design system
- Deploy Dove worker to Cloudflare with custom domain
- Initial commit

### Fixed
- Use word-boundary matching in release stale-version check
- Strengthen dashboard, send-log filter, and webhook-log expand specs
- Use inherited stdio for dev server in L2 runner
- Add RESEND_DRY_RUN to prevent real email sends in E2E
- Use 288px logo on login page for Retina clarity
- Increase template detail load timeout for D1 cold start
- Handle async data loading in dashboard and project detail
- Add D1 warmup step and 15s default timeout
- Align BDD spec selectors with actual page snapshots
- Return 400 for D1 UNIQUE constraint violations instead of 500
- Guard E2E auth bypass with NODE_ENV !== production
- Fail hard when security tools are not installed
- Mock APP_VERSION in health E2E test

## v0.1.0

### Added

- Project scaffold (Next.js 16, Bun, TypeScript strict, Tailwind v4, shadcn/ui)
- Cloudflare Worker D1 proxy for database access
- D1 proxy client with HTTPS transport
- ID generation (nanoid 21-char IDs, 48-char webhook tokens) and host validation
- NextAuth v5 with Google OAuth (email whitelist)
- Tailwind CSS v4 + shadcn/ui basalt design system base components
- AppShell layout with collapsible sidebar, breadcrumbs, and theme toggle
- Database schema for projects, recipients, templates, send_logs, webhook_logs
- Projects CRUD with webhook token sanitization
- Recipients CRUD with email normalization
- Templates CRUD with Zod variable schema validation
- Send logs queries with daily/monthly quota counting
- Webhook logs queries (fire-and-forget pattern)
- Template rendering engine (Markdown → HTML + variable substitution)
- Resend API client with retry logic and idempotency support
- Quota checking (daily + monthly soft limits per project)
- Project API routes (CRUD + token regeneration)
- Recipient API routes (CRUD per-project whitelist)
- Template API routes (CRUD + live preview)
- Log and stats API routes (dashboard totals + chart data)
- Webhook routes (health check, send endpoint, template listing)
- DB init endpoint (session-auth + non-production only)
- Dashboard page with stats cards and sends chart (Recharts)
- Projects pages (list with cards, create form, detail view)
- Template pages (list grouped by project, create/edit with live Markdown preview)
- Send logs page with project/status filters, pagination, and expandable rows
- Webhook logs page with project filter and expandable detail rows
- L1 unit tests with 92%+ function coverage (123 tests)
- Husky pre-commit/pre-push hooks with G1 static analysis gate
- L2 API E2E tests covering all 18 REST endpoints
- Security gate (osv-scanner + gitleaks)
- Gitleaks allowlist for test fixture tokens
- Skeleton loading components for all pages (dashboard, projects, templates, logs)
- Centralized APP_VERSION constant (lib/version.ts) with tests
- Automated release script (scripts/release.ts) with 5-phase pipeline

### Changed

- Login page redesigned with pew badge card design (box-shadow, punch hole, barcode)
- Sidebar width aligned to 260px (from 240px) matching pew design
- Card styling aligned with basalt design system (bg-secondary, no borders/shadows)
- Replaced initial-load spinners with page-specific skeleton placeholders
- Worker deployed to Cloudflare with custom domain
