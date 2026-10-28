# Atlas onboarding contracts

The onboarding brain emits and consumes versioned contracts. This file is the index; the
authoritative definitions are the strict zod schemas in `lib/domain/contracts.ts`, mirrored to
JSON Schema in `schema/`, with recorded fixtures in `tests/fixtures/` and their `.sha256`.

Status legend: **built** (implemented + tested against a fixture), **planned**, **blocked**
(needs another repo).

## New in Atlas v1

| Contract | Direction | Status | Notes |
|---|---|---|---|
| `atlas-evidence/1` | Atlas internal + API | built | Evidence descriptor. Never carries file content, paths, or raw scan findings — only finding codes, hashes and classifications. |
| `atlas-gate-event/1` | Atlas API + audit chain | built | One gate decision or stage transition. Also the wire format of the hash-chained audit log. |
| `atlas-value/1` | Atlas API | built | A value record with an explicit basis (`estimate` / `measured` / `not-tracked`); `measured` requires a source reference. |
| `atlas-onboarding-record/1` | Atlas → macOS / Windows / web tests | built (web + macOS consume it) | Read projection of one project's onboarding state. One fixture, three consumers, so the clients cannot drift. |

## Consumed or emitted (existing shapes — do not redefine)

| Contract | Direction | Status | Owned by |
|---|---|---|---|
| project-onboarding proposal (`atlas-project-onboarding/1`) | Atlas → OS | built | Atlas (`lib/flightdeck/onboarding.ts`) |
| `vision-projection/1`, `vision-delivery/1` | OS ↔ Atlas | built | OS / Atlas |
| `cowork-handoff/1` | Atlas ↔ Cowork / Maps | built (Atlas emits the bundle; transport not wired) | Maps today; Atlas must emit + ingest |
| `.maps-steps.json` + Project step format | KG → DiagramForge | built (KG/Maps side) | OS KG |
| `signavio-map/1` / `diagramforge/1` | DiagramForge | built; web save-back missing | DiagramForge repo |
| `teoa-process/1` | DiagramForge → OS | built | OS |
| `atlas-studio-spec/1` | Atlas → Studio | built (body; transport not wired) | Atlas |
| `studio-compliance-record/1` | Studio → Atlas | built (strict intake, refuses an unpaved record) | Studio | Studio repo |
| Operator bundle | OS → Companion | built | OS |

## Rules that apply to every contract here

1. Strict parsing: an unknown key is a refusal, not a silently dropped field.
2. Versioned: the version is in the id, never inferred; an unknown version is refused.
3. No personal data in identifiers; actors may travel as a hash where the consumer does not need
   the person.
4. Additive change only inside a version. A breaking change is a new version and a new fixture.
5. Fixtures are recorded, hashed, and shared across TS and Swift so a drift fails a test.

## Hand-off bodies (built in `lib/onboarding/handoffs.ts`)

| Body | Schema id | Notes |
|---|---|---|
| KG extraction request | `atlas-maps-steps-request/1` | References + `meta.mapType` + step-format revision. No evidence content, no steps: KG extracts. |
| DiagramForge bundle | `cowork-handoff/1` | `meta.mapType` (`as-is`/`future`, the Maps handoff contract), evidence refs by id + sha256, `requiredAnswers`. A restricted classification is never referenced. |
| Studio spec | `atlas-studio-spec/1` | Decision, to-be map ref, process-manifest hash, objective/success measure, classification, and the two non-goals as constraints (`drawsMaps: false`, `runsProcessSteps: false`). |
| Companion request | `atlas-companion-request/1` | Asks the OS to register the shipped sub-app on the project; Atlas never creates OS data. |

Every one of them is reserved in `atlas_handoffs` with a v4 idempotency key
and the canonical body before anything is sent, and the body is cleared once
the hand-off is filed or refused. **No transport exists yet**: see
`docs/BLOCKERS.md`.
