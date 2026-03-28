# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
