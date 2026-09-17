# FlightDeck Atlas

A TE Connectivity themed portfolio and action hub, with a dashboard, God’s Eye globe, daily/weekly briefings, consultancy pilots, and Super Admin-controlled access.

## Included

- Project creation and editing, task completion, progress and location metadata.
- Durable project records in D1, protected server-side by authenticated user identity.
- Dashboard and God’s Eye tabs with shared project state, keyboard navigation, and a reversible laptop → office → sky camera journey. View transitions can be cinematic, quick or instant.
- Soft card shadows, button/visual hover effects and keyboard focus feedback, respecting reduced-motion settings.
- Globe → building → stylized 3D room → laptop → project journey, with skip, cancel and reduced-motion support.
- Light and dark themes with a remembered device preference.
- FlightDeck DTO validation, an injectable SDK transport, and an integration handoff. **Live FlightDeck SSO and sync are pending the new SDK.**
- A clearly labeled example workspace until you add your own projects.

## Run locally

Use Node.js 22.13 or newer.

```sh
npm ci
npm run db:generate # only if the schema changes
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_brave_vector.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_past_blue_shield.sql
npm run dev
```

Before starting development, create an ignored `.env.local` containing `ATLAS_SUPERADMIN_EMAIL=seedy@sites.test` for the loopback fixture. Apply each migration once per local database. `npm run dev` prints the local URL. The bundled local sign-in flow supplies a development-only identity on loopback. Production identity comes from the private hosting dispatcher; do not expose a bare Worker that trusts arbitrary identity headers.

```sh
npx tsc --noEmit
npx playwright test
```

The browser tests use an already running local server at port 5173 and Chrome. They create and remove temporary projects and access fixtures in the local database. The SDK adapter tests use fixtures and do not contact FlightDeck.

## FlightDeck integration

See [SDK requirements](docs/FLIGHTDECK-SDK-REQUIREMENTS.md). The live connection is intentionally disabled until the new SDK provides delegated identity and authorized project transport. The private preview’s platform identity is not FlightDeck SSO.

## Map and motion

The globe uses Cesium, Esri satellite imagery, Re:Earth terrain, and community building footprints. These are external services with best-effort availability; a street-map fallback is provided. Building footprints are not photographic facades. Room interiors are a stylized Three.js scene, not real building interiors. Coordinates are supplied by the project author.

Cesium runtime assets are copied from the locked package into `public/cesium` before development/build and are not committed. Keep map provider attributions visible. The globe/camera approach follows God’s Eye View; the unrelated intelligence feeds and reference footage are not bundled.

TE branding uses the TE Connectivity logo already present in FlightDeck OS. The theme uses TE Orange (#E98300), Dark Teal (#2E4957), and complementary brand colors from TE’s published guidelines. See [third-party notices](THIRD_PARTY_NOTICES.md).

## Personal action hub and access

- Dashboard and globe settings are validated and saved in browser storage. Direct view links take precedence over the saved start view.
- Tasks have due dates, priorities and owner labels. Project updates and server-stamped completion activity power daily/weekly briefings and Markdown exports. Archiving is reversible.
- AI radar reads public official RSS feeds with source links, dates, timeouts and an in-memory 30-minute cache. It never sends project data to a model. Consultancy playbooks are suggested hypotheses, not generated findings or verified savings.
- A pilot creates an editable onboarding checklist and exportable handoff. It does not create OS accounts or mutate FlightDeck.
- Set `ATLAS_SUPERADMIN_EMAIL` as a production secret to the trusted sign-in email. The deployment in this task is configured for the Site owner. No user can self-register as Super Admin. For loopback development only, an ignored `.env.local` can bind it to `seedy@sites.test`.
- Apply each generated D1 migration once. The second migration adds role grants, members, and the access audit. Project enrichment remains in the existing JSON column. Use `--persist-to .wrangler/state` for the local database.
- Additional users require both private-site admission and an Atlas role. The access UI never silently changes hosting audience or sends email invitations.

The future SDK/master-app/TEOA contract is in [docs/MASTER-APP-CONTRACT.md](docs/MASTER-APP-CONTRACT.md).

## Project onboarding bridge

Connections has **From FlightDeck** and **To FlightDeck** flows. Atlas onboarding drafts persist with proposed OS names and workspace planning notes; users can edit, remove and export them. The OS intake list and creation endpoints stay explicitly disconnected until delegated identity, project-level access, durable external links and idempotent creation are implemented with the SDK. No draft sends data to the OS or submits automatically. See [the bridge contract](docs/PROJECT-BRIDGE-CONTRACT.md).

## Wellbeing and personal overview

- Account-specific browser storage for daily mood, rest/energy/clarity check-ins, a transparent self-reported readiness score, habits and original daily reflections. No check-in enters shared project APIs or AI feeds.
- Configurable Pomodoro with wall-clock persistence, pause/resume/reset, a longer break after four daily focus sessions, and in-app break reminders. Sessions start only when chosen.
- A compact dashboard widget, full Wellbeing page, running timer indicator, reduced-motion support and a dashboard visibility toggle.
- Outlook summary and calendar panels are explicitly disconnected pending Microsoft 365 app registration and delegated sign-in. No email/calendar data is fetched. See [personal hub requirements](docs/PERSONAL-HUB-CONTRACT.md).

## Immersive God’s Eye

Dashboard/God’s Eye tabs sit inside the top navigation. God’s Eye hides the sidebar and exposes a labeled settings control. Its saved Explore/Scan preference, imagery, labels, terrain, building layers and optional sunlight/shadows are available there.

Cinematic scan searches actual active Atlas project fields and task text, with accent-insensitive token matching, attention/high-priority/completed filters, animated index channels and a cancellable reveal. It does not query cameras, people, external tracking feeds or the disconnected OS. Example data is explicitly labeled. Unmapped results open the project for editing instead of inventing coordinates.

Tour locations visits mapped results and stops on manual interaction, workspace entry, Stop or Escape. `/` opens search; reduced motion skips scan travel. Map markers enlarge on hover and show project tooltips. Panels can be hidden to explore the globe unobstructed.

## Productivity workspace

Today & advisor combines quick capture, planned work dates, a prioritized action queue, a focus-time budget and explicit rule-based watch-outs. Project workspaces include a task list/board, owners, due dates, estimates, checklists, notes, manual goals and goal-linked KPI measurements. All product records persist through the authorized project API and revision checks. Dashboard cards/list/status board, a collapsible deadline planner and a cross-view command menu make these tools reachable.

God’s Eye adds circular flight targeting, smooth zoom controls, project orbit and risk marker colors; manual control and Escape stop motion. Reduced motion and the circular-lens setting are respected.

FlightDeck is the chosen future AI provider. Live AI, OS strategy/KPI feeds, TEOA and Outlook remain disconnected. See [research and selected roadmap](docs/PRODUCTIVITY-RESEARCH.md) and [strategy/AI SDK contract](docs/STRATEGY-AI-CONTRACT.md).
