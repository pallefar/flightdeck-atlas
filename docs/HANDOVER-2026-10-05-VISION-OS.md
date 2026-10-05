# Atlas ↔ Vision OS handover — 5 October 2026

Vision OS is a private standalone host app in the paired FlightDeck OS repository. Atlas shares only approved assessment status, required actions and approved goals, and synchronizes the status of a confirmed linked project. Atlas does not embed the private dashboard or copy its source library.

Both repositories use branch `feat/vision-os-2026-10-05`. The tested Atlas implementation is [`53aea1e89c67cef6c20dc5ac968e7fa7a79e7757`](https://github.com/pallefar/flightdeck-atlas/commit/53aea1e89c67cef6c20dc5ac968e7fa7a79e7757), paired with OS [`069f9dd016bf54b38879e10d88f31e963a730244`](https://github.com/pallefar/project-contract/commit/069f9dd016bf54b38879e10d88f31e963a730244). Branch heads include documentation-only handover commits after these code pins. Verify both fetched heads retain the pinned commits before migrating.

## Atlas implementation

- The reserved `vision-os` launcher is generated server-side for the two trusted authenticated owner email identities. Another administrator receives no card or private link; a forged stored card is discarded. OS checks its own real owner session again.
- `ATLAS_FLIGHTDECK_VISION_URL` configures the browser-facing standalone URL. It must use HTTPS, or loopback HTTP in local development, and contain no URL credentials. The fallback uses the validated OS server origin plus `/console/vision?standalone=1`. Configure a public browser URL separately when the server address is private.
- Project checks use the current active `atlas_project_links` tuple: installation, OS instance, workspace and OS project. Access to the Atlas project is checked before any remote lookup. Selecting a similarly named project never creates a binding.
- `GET /api/flightdeck/vision?project=<Atlas ID>` returns a strict approved projection with `Cache-Control: private, no-store`. Only the owner gets a standalone deep link. Private assessment answers, notes, evidence, source text, credentials and stored linkage tuples are omitted.
- New activation, forward readiness/delivery stages and material changes prepare a versioned OS review proposal before writing Atlas. Material review uses a SHA256 digest of explicit scope, success measure, objective/KPI definitions and onboarding facts; the digest crosses the boundary without their text.
- A winning Atlas project update queues its minimal committed event in the same D1 batch. An OS outage or refused acknowledgment keeps a durable pending marker and the project shows **Retry sync**. Acknowledging an older event cannot remove a newer queued event.
- A retry refreshes only the expected OS assessment/vision revisions. The saved Atlas revision, status, stage and material digest remain unchanged and still pass the current OS gate.
- Existing HR task work can continue while assessment is due at the next delivery stage. Safe Planning/On hold commits preserve current-work authority and never grant approval. Unlinked and unrelated Atlas projects keep existing behavior.

Main modules: `lib/flightdeck/vision*.ts`, `lib/flightdeck/context-client.ts`, `app/api/flightdeck/vision`, `app/api/projects/[id]/route.ts`, and the compact shared badge in `app/vision-project-status.tsx`.

## Paired OS API

Use the existing server-only Atlas inbound credential; do not use a private owner API or forward browser identity headers/cookies.

- GET `/api/inbound/v1/context/workspaces/:workspaceId/projects/:projectId/vision` requires `read:context`.
- POST the same path plus `/delivery` requires both `read:context` and `submit:proposal`.
- Strict versions are `vision-projection/1` and `vision-delivery/1`. POST uses `intent: prepare | commit`, the confirmed OS instance and Atlas project ID, the actual/prospective Atlas revision, expected assessment/vision revisions, stage, status, and optional material-change flag/digest. Unknown or private fields are refused.
- Prepare requests a review and does not claim Atlas saved a status. Commit follows the durable Atlas save. This is an outbox protocol across two stores, not a distributed atomic transaction.

Read the paired OS Vision handover for owner-account binding, landlord migration, private library staging, assessment evidence, two-phase activation and downloadable desktop bundles. Shared machine app catalogs never contain the private Vision app.

## Migration to another Mac or Claude Code Cloud

1. Preserve uncommitted work, fetch both repositories, and use the reviewed Vision branches/commits recorded in the root handover.
2. Install Atlas with `npm run install:ci`. Apply every missing migration in order, including generated `drizzle/0013_aberrant_moonstone.sql`, before running the updated app against an existing D1 database. Do not regenerate migrations on the destination.
3. Restore private integration configuration through the existing protected setup. Do not copy fixture `.env.local`, credentials, browser outputs or fixture D1 into production.
4. Apply the paired OS landlord/workspace migrations and configure both real owner-account usernames on the OS. Atlas uses the hosting provider's trusted authenticated email identity; OS account bindings are server configuration, not editable contact email.
5. Verify the confirmed link and inbound credential scopes. Test assessment denial, owner approval, activation, a forward stage change and status synchronization using disposable fixtures.
6. Run `npx tsc --noEmit`, `npm run lint`, `npm run build`, and local Playwright. Use `ATLAS_BASE_URL` for a separately owned local preview. If its persisted D1 path differs from `.wrangler/state`, set `ATLAS_D1_STATE_DIR` to that state directory so fixture cleanup and race tests use the same database.

## Validation and limits

The full local suite passed **593 checks, 2 skipped** (595 total). The final material-field extension was verified with **24/24 Vision checks**, TypeScript and a production rebuild; KPI current observations and objective status remain exempt from material review. Lint passes with 0 errors and the 29 existing warnings. New tests cover trusted owner identities, no administrator bypass, strict/private response rejection, confirmed project visibility/linkage, stale checks, scope/revocation behavior, stage/material review, atomic SQLite outbox writes, failed/racing acknowledgments, refreshed retry revisions, and EN desktop/DE mobile badge controls.

No live service or production database is migrated by this implementation. Real owner sign-in, private source import and installed desktop operation require the destination's protected configuration and runtime migration. Full bidirectional project import/sync and delegated OS SSO remain separate integration work. Numeric HR benefit targets, fiscal boundaries and approved TE policy remain owner configuration; the implementation does not invent them. Future Content and Newsletter apps must use explicitly approved audience-scoped derivatives, never the raw private Vision corpus.
