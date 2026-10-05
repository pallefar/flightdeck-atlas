# Atlas handover — 2026-10-05: account menu and the live OS link

Branch `feat/atlas-account-menu` (not merged, no PR opened). The cross-repository picture, the OS
side and everything outside this repo are in `pallefar/project-contract`,
`docs/HANDOVER-2026-10-05-ADMIN-KG-ROLES-ATLAS.md` (branch `integration/unified-2026-09-22`).

## What the branch does

The signed-in person in the sidebar is now a menu (`app/account-menu.tsx`, Radix dropdown; styles
`.profile-button` and `.profile-chevron` in `app/globals.css`; EN and DE strings `account.menu.aria`
and `account.menu.admin`). Its **Admin app** entry adds no rule of its own: it shows the server's
reserved FlightDeck Admin launcher card (`flightdeck-admin`, `lib/flightdeck/admin-card.ts`) and is
absent when `/api/workspace` does not include that card. Who sees the card is unchanged and is
described in the README ("The FlightDeck Admin card"): the Atlas Super Admin and roles listed in
`ATLAS_FLIGHTDECK_ADMIN_ROLES`, and only when `ATLAS_FLIGHTDECK_ADMIN_URL` is a valid https (or
loopback http) address without credentials. FlightDeck checks access again on arrival.

## Local configuration (gitignored `.env.local`, mode 600)

| Variable | Local value / note |
| --- | --- |
| `ATLAS_FLIGHTDECK_URL` | `http://127.0.0.1:4173`. Must stay loopback http: Atlas refuses any other http origin (`not_configured`). The Atlas launcher forwards 127.0.0.1:4173 inside the `atlas-dev` container to `host.docker.internal:4173`. |
| `ATLAS_FLIGHTDECK_INBOUND_TOKEN` | The inbound credential. **Expires 2026-10-08.** Never print or commit it. |
| `ATLAS_FLIGHTDECK_ADMIN_URL` | `http://127.0.0.1:4173/console/admin` (the standalone window adds `?standalone=1`). Without it the Admin entry is absent. |

Renewing the token: OS Admin › Inbound API, or `POST /api/inbound/tokens` on the OS with
`{integrationId:"atlas", scopes:["submit:proposal","read:context"]}`. The mint answers 201 and shows
the token once. Put it in `.env.local` and restart Atlas.

## State of the link

Connected on 2026-10-01: `GET /api/flightdeck/connection` answers `ok`, scopes `read:context` and
`submit:proposal`, workspace `te-ops` readable, project-onboarding proposals enabled. Still **not**
built: shared sign-in, user sync and any per-user OS identity; they wait on the FlightDeck SDK and an
authorization flow (see `FLIGHTDECK-SDK-REQUIREMENTS.md` and `SUPABASE-IDENTITY-CONTRACT.md`).
Locally, Atlas signs in as its development Super Admin, which is unrelated to any OS account.

## Next

1. Renew the token before 2026-10-08.
2. Decide on a pull request and merge for this branch.
3. After a merge, anyone running Atlas needs the three variables above for the menu's Admin entry and
   the live link to work.
