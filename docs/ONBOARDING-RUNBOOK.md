# Onboarding brain — runbook

What to apply, what to switch on, and how to tell it is working. Everything
here is off by default; nothing in this lane changes an existing project until
someone opens its intake.

## Apply the migrations (once each, in order)

New with Atlas v1:

| Migration | What it creates |
|---|---|
| `0014_massive_whirlwind.sql` | `atlas_gate_events` — the append-only, hash-chained gate audit. |
| `0015_nifty_lord_tyger.sql` | `atlas_onboarding`, `atlas_evidence`, `atlas_reuse_checks`, `atlas_value`, `atlas_handoffs`. |

Local (the same incantation as the other migrations, from the repository root):

```sh
npm run build   # dist/server/wrangler.json is what the command points at
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB \
  --local --config dist/server/wrangler.json --persist-to .wrangler/state \
  --file drizzle/0014_massive_whirlwind.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB \
  --local --config dist/server/wrangler.json --persist-to .wrangler/state \
  --file drizzle/0015_nifty_lord_tyger.sql
```

Rollback: the two migrations only add tables. Dropping them removes the lane
and leaves every existing Atlas project untouched — but it also destroys the
audit chain, so take a snapshot first (`cp -R .wrangler/state …` locally, an
exported D1 backup in production).

## Permissions to grant

The lane is invisible until a role holds `onboarding.view`. Grant per person,
never to the built-in Owner role (it deliberately holds none of the gate
permissions, so a requester cannot approve their own project):

| Permission | Who needs it |
|---|---|
| `onboarding.view` | everyone who should see the pipeline |
| `onboarding.create` | requesters and builders starting an intake |
| `onboarding.triage` | builders: reuse check, intake and build gates |
| `onboarding.capture.review` | builders: attach and accept evidence |
| `onboarding.gate.process_owner` | process owners: as-is, value, to-be, live, retire |
| `onboarding.gate.teoa` + `onboarding.gate.vision` | alignment needs BOTH |
| `onboarding.value.edit` | whoever records value |
| `onboarding.handoff` | whoever sends work to KG / DiagramForge / Studio |

## What is wired and what is not

| Piece | State |
|---|---|
| Intake, reuse check, gates, evidence metadata, value records, audit chain | Built; API + web lane; tested over the real migrations |
| Governance scan (classification, PII/credential patterns, markings) | Built; runs server-side on evidence text |
| Hand-off outbox (KG, DiagramForge, Studio, Companion payloads) | Built: bodies + idempotency keys are reserved |
| Hand-off transport | **Not built.** No live OS/KG/Studio/Companion endpoint is called. Dispatch belongs to the repository that owns each contract. |
| Studio compliance record intake | Built (`POST /api/onboarding/:id/compliance`) |
| macOS client | Built: generated contract models, stage ladder, signed app shell. **Capture, transcription and sync are not built.** |
| Windows client | **Not built.** |
| Evidence bytes (upload to the OS docstore) | **Not built.** The lane records a hash and metadata; the file stays where it is. |
| Realized value (30/90 days) records | Built (records and basis); the telemetry ingest is **not built**. |
| Ask Atlas | **Not built.** |

## Verify a deployment

```sh
npx tsc --noEmit
npm run lint            # 0 errors expected
npm run build
npx playwright test     # needs a running dev server on :5173 and Chrome
node scripts/gen-swift.mjs --check
cd atlas/macos/Atlas && swift test && ./build.sh
```

In the app: open `?view=brain`, start an intake on a project, and check that
the project's chain reads "Audit chain verified (n events)". A gate the signed-in
person may not pass is disabled and says why; a gate whose requirements are
unmet is refused with the requirement codes, not a generic error.

## Known operational limits

- The pipeline list is capped at 500 rows and filters by project read rights
  per row. That is fine at the current portfolio size and will need a joined
  query before it reaches 1,000.
- Opening the intake for a project requires edit rights on that project; a
  viewer can read the brain but not start it.
- Evidence text passed as `scanText` is capped at 20,000 characters and is
  never stored.
- The hand-off outbox refuses a second open hand-off of the same kind for the
  same project (one bundle at a time), which is deliberate.
