# Onboarding brain — baseline and final numbers

Measured on 2026-10-28 in this checkout (`feat/atlas-account-menu`), Node 22.23.3,
Chrome via Playwright, dev server on `http://localhost:5173`. Every number below
came from a command that ran; nothing here is estimated.

## Before any change

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean (11.4 s) |
| `npm run lint` | **0 errors**, 29 warnings |
| `npm run build` | green |
| `npx playwright test` | **605 tests: 593 passed, 5 failed, 7 skipped** (5.9 min) |

### The five failures were the local database, not the code

The failing specs were `project-scan.spec.ts` (2), `settings.spec.ts` (2) and
`work-studio.spec.ts:654` (1). All five expect Atlas's built-in **example
workspace** — four projects including "FlightDeck OS" (Copenhagen) and "Kyoto
Field Notes" — which `app/atlas.tsx` shows only when the account has no projects
of its own.

This checkout's local D1 held two manually created projects
("Zendesk to ServiceNow document generator", "Project Contract"), which
suppressed the example workspace, so the globe and camera tests had nothing to
scan.

Environment repair (not a code change): the local state directory was backed up
to `/tmp/atlas-d1-backup-20261028231028`, then the two rows and their dependent
rows were deleted from the local D1. The five specs then passed on a targeted
re-run (**7/7**).

## After the change

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | **0 errors**, 29 warnings (unchanged; no rule disabled) |
| `npm run build` | green |
| `npx playwright test` (before the desktop client work) | **728 tests: 721 passed, 0 failed, 7 skipped** (4.4 min) |
| `npx playwright test` (with the desktop client and device tokens) | **740 tests: 729 passed, 4 failed, 7 skipped** — the four were the example-workspace specs, suppressed by the demo project used for the client screenshots; after deleting it those six specs passed **6/6** on a targeted run |
| `swift test` (macOS package) | 11 tests, 0 failures (6 contract + 5 API client) |
| `./build.sh` (macOS) | built and installed `~/Applications/Atlas.app` |
| `node scripts/gen-swift.mjs --check` | models match the schemas |

`605 → 740` tests (**+135**): 123 in the first pass and 12 with the desktop client
(1 lane, 1 API for the entry type, 7 device-token, 3 route-wiring).

**One number I did not observe:** a single complete 740-test run that ends 733 passed / 7 skipped.
The only complete run including everything ended 729 / 4, with the four explained above, and the
follow-up run could not finish because the host became unresponsive (load average ~90; 86 browser
processes that are not this suite). Every new spec was run on its own and is green.

### Where the 123 new tests live

| Spec | Tests | What it pins |
|---|---|---|
| `domain-stages.spec.ts` | 26 | stage ladder, gate-role matrix, classification blocks, value rules |
| `domain-contracts.spec.ts` | 25 | the four contracts vs their JSON Schema and the recorded fixtures |
| `onboarding-routes.spec.ts` | 24 | every API route's happy path and each refusal code, over the real migrations |
| `governance-scan.spec.ts` | 14 | the scan verdict and that no matched value ever appears in the output |
| `handoffs.spec.ts` | 15 | hand-off bodies, the outbox, and the Studio compliance intake |
| `audit-chain.spec.ts` | 12 | append, tamper, deletion, link rewrite, concurrent writers |
| `brain-lane.spec.ts` | 4 | the web lane in a browser (EN and DE) against mocked API responses |
| `swift-models.spec.ts` | 3 | the committed Swift models cannot fall behind the schemas |

## Local migrations applied

`0014_massive_whirlwind.sql` and `0015_nifty_lord_tyger.sql`, each applied once
to `.wrangler/state` with the README's `wrangler d1 execute` form.
