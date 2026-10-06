# Atlas Compact Workspace — 5 October 2026

The owner approved implementation of the portfolio and project concepts,
continuing Compact Workspace throughout FlightDeck OS and standalone apps.
Code is on `feat/compact-workspace-2026-10-05`, based on the account/Admin
menu feature (`25f92c2`) after fetching all repository refs.

## Implemented

- 220px light sidebar, compact 52px desktop header, consistent TE orange,
  restrained surfaces and responsive navigation. Existing dark themes remain.
- Actual accessible project list, optional inspector and Open workspace;
  existing cards, board, globe and dashboard preferences remain supported.
- Task list beside the existing detail editor, preserved draft/revision checks
  and disabled competing mutations while editing, including timeline drags.
- Fresh profiles start with List and optional dashboard widgets off. Saved
  preferences retain their choices; optional tools remain available.
- Existing account menu and server-owned standalone Admin launch are included.
- Approved concepts and governance: `docs/DESIGN-COMPACT-WORKSPACE.md`.

## Validation

The final full local Playwright run passed **570 checks, 2 skipped** (572 total).
TypeScript, production build and full lint pass; lint retains 29 existing
warnings. Ten Compact Workspace cases cover actual records, keyboard focus,
read-only/draft save behavior, EN/DE at 390/1440 widths, timeline guards and
Globe/header geometry. Independent review findings were repaired and rechecked.

The OS app-directory and app-bridge fixtures are now copied byte for byte with
SHA256 pins after Maps 0.2.5 and KG 0.3.2 were released. The focused contract tests
passed 112 checks; the subsequent full suite includes this fixture update.
Atlas's full release-bridge reader (`apps-34`) remains pending. Added coverage
checks fixture provenance, matching directory metadata and the existing PageDoc
schema; it does not claim that reader is implemented.

Browser fixtures are synthetic and isolated. Private local D1 migrations,
`.env.local`, browser outputs and test databases are not committed.

## Other Mac or Claude Code Cloud

Fetch this repository and the paired OS repository before reading their newest
handovers. Preserve uncommitted work before switching or fast-forwarding.
Install dependencies from the committed lockfile with `npm run install:ci`.
Run TypeScript, `npm run lint`, `npm run build`, and the Playwright suite against
a separately owned local test server (set `ATLAS_BASE_URL` to its URL).

Restore private configuration through the existing OS integration setup; do
not copy fixture `.env.local` or fixture D1 into production. The OS-owned
workspace/project lists and saved launch context remain canonical.

The paired OS work is on `feat/compact-workspace-2026-10-05` in
`pallefar/project-contract`. Read its
`docs/HANDOVER-2026-10-05-COMPACT-WORKSPACE.md` and macOS migration companion
for final OS validation, current app versions and runtime migration steps.
Presentation Studio continues from the owner's existing Atlas/mini HTML
editor. The OS entry remains its existing introduction/download surface.
