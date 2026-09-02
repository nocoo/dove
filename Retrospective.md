# Retrospective

Accident narratives for this repo.

Routing: narrative stays here. A project-specific rule that will recur may become one line in `CLAUDE.md`. Cross-project lessons go to nmem or a global rule. If it can be checked by a machine, add a hook or test instead of prose.

## 2026-03-30: Port migration missed gitignored .env.test

- **What:** Global port rename (7046→7032) missed `.env.test` because it is gitignored.
- **Why:** Project-wide config greps that only search tracked files skip env/secrets.
- **Follow-up:** CLAUDE.md rule: when changing ports, URLs, or keys, grep ignored files too.

## 2026-04-21: Shared type extraction during cleanup

- **What:** Deleting old `src/lib/db/` broke `sanitize.ts`, `render.ts`, and `provider.ts`, which imported types from there.
- **Why:** Type-only imports were not traced before deletion.
- **Follow-up:** none (one-time cleanup miss).
