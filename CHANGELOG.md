# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
