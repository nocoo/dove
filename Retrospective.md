# Retrospective

Accident narratives for this repo.

Routing: narrative stays here. A project-specific rule that will recur may become one line in `AGENTS.md`. Cross-project lessons go to nmem or a global rule. If it can be checked by a machine, add a hook or test instead of prose.

## 2026-03-30: Port migration missed gitignored .env.test

- **What:** Global port rename (7046→7032) missed `.env.test` because it is gitignored.
- **Why:** Project-wide config greps that only search tracked files skip env/secrets.
- **Follow-up:** AGENTS.md rule: when changing ports, URLs, or keys, grep ignored files too.

## 2026-04-21: Shared type extraction during cleanup

- **What:** Deleting old `src/lib/db/` broke `sanitize.ts`, `render.ts`, and `provider.ts`, which imported types from there.
- **Why:** Type-only imports were not traced before deletion.
- **Follow-up:** none (one-time cleanup miss).

## 2026-09-23: Lock workspace snapshot drift in dependency upgrades

- **What:** Manual single-line `bun.lock` package-entry edits for #602/#603 left the `workspaces` manifest snapshot stale; `--frozen-lockfile --lockfile-only` passed anyway and was mistaken for installed-code evidence; commit subjects omitted issue refs.
- **Why:** `bun add --registry <mirror>` rewrites all 405 lock URLs to the mirror (uncommit-table), so entries were hand-edited instead of regenerating; frozen-lockfile does not diff the snapshot, and lock-only resolve never touches `node_modules`.
- **Follow-up:** After any hand-edited lock change, sync the `workspaces` snapshot lines in the same commit; verify upgrades by reading installed `node_modules/<pkg>/package.json` versions, not lock-only success; dependency commits reference their issue (`#602`, `#603`, `#604`).

## 2026-10-03 — Verify L2 ownership before database writes

The dependency duty found that the API runner used a shared port and persistence directory, accepted remote test hostnames, and initialized the full schema before checking a static marker. No API suite was run against that unsafe configuration. The runner now uses an owned temporary local configuration, fresh persistence, an allocated port and a random database run marker. Read-only ownership verification precedes schema or fixture writes; credential and mail dry-run guards fail closed. Cleanup rechecks ownership. Regression tests cover remote targets, inherited credentials, stale markers and redirected directories.

Focused verification also exposed native-config warnings from ESM syntax in `.ts` config files without package ESM metadata. The Vite/Vitest configs now use `.mts` and `import.meta.dirname`; the compiler includes those files. Warning suppression was not used.

The first pre-execution review caught two remaining lifecycle defects: stopping only the direct child could leave workerd alive, and setup after temporary-directory creation was outside the protected lifecycle. A real parent/descendant regression failed against that implementation before the cleanup was corrected. The runner now waits for the entire owned process group, escalates only that group within a bounded timeout, and protects setup as well as execution. No API runner was started before these review findings were addressed.

Candidate review found that the release workflow still pinned the old Wrangler CLI after the manifest and lock upgrade. The release pin is now synchronized to 4.145.0. Dependency acceptance must inspect executable tool pins across workflows as well as package manifests; no PR was published with the inconsistent candidate.
