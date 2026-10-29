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
| `0016_unique_switch.sql` | `atlas_device_tokens` — hashed bearer credentials for the native clients. |
| `0017_messy_inhumans.sql` | `atlas_workspaces`, `atlas_workspace_members`, `atlas_project_roles`; `atlas_onboarding.workspace_id`. The migration also creates the `general` workspace and moves every existing intake into it. |

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

## Connecting the macOS app

The app speaks the same API as the web lane, so it needs a credential the web
lane does not: a **device token**. Mint one as the Super Admin and hand it to
the app once.

```sh
# With a signed-in Super Admin session (the dev browser flow, or a real one):
curl -sS -X POST "$ATLAS/api/access/device-tokens" \
  -H 'content-type: application/json' -H "origin: $ATLAS" \
  -b "session=$COOKIE" \
  -d '{"label":"Karsten macOS","email":"you@te.com","roleId":"admin"}'
# → {"id":"…","token":"<64 hex>","email":"…","roleId":"admin"}   (shown ONCE)
```

- Only the sha256 of the token is stored. There is no "show it again": mint a
  new one and revoke the old.
- A token never grants anything by itself. It resolves to an existing Atlas
  member grant (email + role); disabling the member or revoking the token
  denies the next request.
- `GET /api/access/device-tokens` lists them (no token, no hash) and
  `DELETE /api/access/device-tokens?id=…` revokes one. Both are Super Admin
  only.
- There is **no web UI** for minting yet; the API is the supported path.

In the app: **Settings → Base URL** (`http://localhost:5173` in development —
the dev server listens on IPv6 loopback, so a literal `127.0.0.1` is refused),
paste the token, **Save and test**. The token goes to the Keychain, never to
preferences.

For development only, a terminal launch can skip Settings:

```sh
ATLAS_BASE_URL=http://localhost:5173 ATLAS_DEVICE_TOKEN=<token> \
  "$HOME/Applications/Atlas.app/Contents/MacOS/Atlas"
```

A Finder/Dock launch never sees those variables, and the app stores nothing
from them.

### Check the app against a live Atlas

```sh
ATLAS_BASE_URL=http://localhost:5173 ATLAS_DEVICE_TOKEN=<token> ATLAS_SELFTEST=1 \
  "$HOME/Applications/Atlas.app/Contents/MacOS/Atlas"; echo "exit=$?"
```

It creates a project, saves the intake, records the reuse decision, passes the intake
gate and prints `selftest: project=… stage=reuse chain=2 workspace=…`, then exits
0 (non-zero on any failure, with the failing step on stderr). It leaves the project it
created behind, so delete it when you are done. Two real client bugs were caught this
way: Swift omits `nil` optionals (the project schema requires `latitude`/`longitude`
even when null) and `""` is not a valid `buildDecision`.

The app's `Info.plist` allows cleartext HTTP to **local** hosts only
(`NSAllowsLocalNetworking`), so a production deployment must use HTTPS.

## Workspaces, owners and the assignment step

Access has two halves, and both must hold:

| Half | Question | Where it lives |
|---|---|---|
| Permission | **What** may this person do? | Atlas role permissions (`onboarding.*`), granted by the Super Admin |
| Assignment | **Whose** project may they do it on? | Workspace membership + a role on the project |

**Workspaces.** A workspace is where an Admin creates projects. The migration creates
`general`; only the Super Admin creates more (`POST /api/workspaces`), and only the
Super Admin makes someone a workspace admin
(`POST /api/workspaces/:id/members` with `role: "admin"`).

| Actor | Creates a project | Edits a project | Passes a gate | Assigns roles |
|---|---|---|---|---|
| Super Admin | any workspace | any project | any gate | yes |
| Workspace admin | their workspace | project in their workspace | only the gate they hold **and** are assigned | yes |
| Project owner | — | their project | the intake/reuse/capture/build/retire gates | no |
| Assigned approver | — | — | that one gate | no |

Every project gets an `owner` the moment its intake opens: the person named in the
onboard form, or the admin who created it. `process_owner` falls back to the owner;
the two alignment approvers never fall back, because an approval needs a named person.

**The assignment step.** In the project's brain, a workspace admin or the Super Admin
assigns `owner`, `process_owner`, `teoa_approver` and `vision_approver`
(`POST /api/onboarding/:id/roles`). Stage 4 refuses until both approvers are assigned,
before it even looks at the facts — and one person cannot stand in for the other
approver's permission.

Rules as code: `lib/onboarding/access.ts`; as tests: `tests/brain-access.spec.ts`.

## The app's wizard and its links into Atlas

- The wizard opens by itself on a first run (until `atlas.wizardSeen` is stored) and
  from **Onboard a new project or process** (⌘N). Four steps: kind → workspace and
  owner → name and problem → review and create.
- **Open Atlas** (top of the Overview) opens `/?view=brain` in the browser: the whole
  portfolio with the pipeline, filters and every project.
- **Open in Atlas** (in a project's brain) opens `/?view=brain&project=<id>`, which
  lands on that project's brain inside the full lane.
- Both URLs come from `AtlasLink` (tested), so the app and the web cannot drift on
  what a link means.
