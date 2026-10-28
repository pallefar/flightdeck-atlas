# Atlas onboarding contracts

The onboarding brain emits and consumes versioned contracts. This file is the index; the
authoritative definitions are the strict zod schemas in `lib/domain/contracts.ts`, mirrored to
JSON Schema in `schema/`, with recorded fixtures in `tests/fixtures/` and their `.sha256`.

Status legend: **built** (implemented + tested against a fixture), **planned**, **blocked**
(needs another repo).

## New in Atlas v1

| Contract | Direction | Status | Notes |
|---|---|---|---|
| `atlas-evidence/1` | Atlas internal + API | planned | Evidence descriptor. Never carries file content, paths, or raw scan findings — only finding codes, hashes and classifications. |
| `atlas-gate-event/1` | Atlas API + audit chain | planned | One gate decision or stage transition. Also the wire format of the hash-chained audit log. |
| `atlas-value/1` | Atlas API | planned | A value record with an explicit basis (`estimate` / `measured` / `not-tracked`); `measured` requires a source reference. |
| `atlas-onboarding-record/1` | Atlas → macOS / Windows / web tests | planned | Read projection of one project's onboarding state. One fixture, three consumers, so the clients cannot drift. |

## Consumed or emitted (existing shapes — do not redefine)

| Contract | Direction | Status | Owned by |
|---|---|---|---|
| project-onboarding proposal (`atlas-project-onboarding/1`) | Atlas → OS | built | Atlas (`lib/flightdeck/onboarding.ts`) |
| `vision-projection/1`, `vision-delivery/1` | OS ↔ Atlas | built | OS / Atlas |
| `cowork-handoff/1` | Atlas ↔ Cowork / Maps | planned (Atlas side) | Maps today; Atlas must emit + ingest |
| `.maps-steps.json` + Project step format | KG → DiagramForge | built (KG/Maps side) | OS KG |
| `signavio-map/1` / `diagramforge/1` | DiagramForge | built; web save-back missing | DiagramForge repo |
| `teoa-process/1` | DiagramForge → OS | built | OS |
| Studio spec + `studio-compliance-record/1` | Atlas → Studio → OS | Studio side built; Atlas emitter new | Studio repo |
| Operator bundle | OS → Companion | built | OS |

## Rules that apply to every contract here

1. Strict parsing: an unknown key is a refusal, not a silently dropped field.
2. Versioned: the version is in the id, never inferred; an unknown version is refused.
3. No personal data in identifiers; actors may travel as a hash where the consumer does not need
   the person.
4. Additive change only inside a version. A breaking change is a new version and a new fixture.
5. Fixtures are recorded, hashed, and shared across TS and Swift so a drift fails a test.
