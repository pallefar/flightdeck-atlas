# FlightDeck Atlas

A TE Connectivity themed portfolio and action hub, with a dashboard, Project Eye globe, daily/weekly briefings, consultancy pilots, and Super Admin-controlled access.

## Included

- Project creation and editing, task completion, progress and location metadata.
- Durable project records in D1, protected server-side by authenticated user identity.
- Dashboard and Project Eye tabs with shared project state, keyboard navigation, and a reversible laptop → office → sky camera journey. View transitions can be cinematic, quick or instant.
- Soft card shadows, button/visual hover effects and keyboard focus feedback, respecting reduced-motion settings.
- Globe → building → stylized 3D room → laptop → project journey, with skip, cancel and reduced-motion support.
- Light and dark themes with a remembered device preference.
- FlightDeck DTO validation, an injectable SDK transport, and an integration handoff. Read-only FlightDeck workspace/project context is live locally for the Super Admin, and the Super Admin can send a prepared project to FlightDeck as a proposal for OS review (see below). **Live FlightDeck SSO, import and sync are pending the new SDK.**
- A clearly labeled example workspace until you add your own projects.

## Work studio

Open a project and choose **Work studio** for custom fields/formulas, dependency scheduling and baselines, event rules, task stopwatch and billable costs, request intake/approval, shared notes, resource planning, reports and versioned playbooks. Task views include nested tasks, archive/restore and guarded cross-project transfers. Saved report widgets appear on the dashboard; **Team workspace → Planner** shows the portfolio resource grid. Project/tool links now survive sign-in and reload.

Scheduled reminders appear in the Atlas inbox at their stored time. Shared notes refresh automatically and reject conflicting same-block edits. Form links require existing Atlas/project access; publishing this update does not open the private Site to external guests. FlightDeck AI, shared identity, Outlook and external/background actions remain pending the agreed OS services. See the [work-management coverage and limits](docs/MONDAY-WORK-MANAGEMENT-AUDIT.md).

## Run locally

Use Node.js 22.13 or newer.

```sh
npm ci
npm run db:generate # only if the schema changes
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_brave_vector.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_past_blue_shield.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_lowly_thing.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_dazzling_blue_blade.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_silly_speedball.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0005_romantic_titania.sql
npm run dev
```

Before starting development, create an ignored `.env.local` containing `ATLAS_SUPERADMIN_EMAIL=seedy@sites.test` for the loopback fixture. Keep `.env.local` readable only by you (`chmod 600 .env.local`): it can hold the FlightDeck inbound credential, and `npm run dev` prints a warning when group or others can access it. Apply each migration once per local database. `npm run dev` prints the local URL. The bundled local sign-in flow supplies a development-only identity on loopback. Production identity comes from the private hosting dispatcher; do not expose a bare Worker that trusts arbitrary identity headers.

```sh
npx tsc --noEmit
npm run lint
npx playwright test
```

`npm run lint` must report no errors; warnings are listed but do not fail it. `tests/lint.spec.ts` runs the same script, so `npx playwright test` also fails on a lint error. Do not disable a rule or add an `eslint-disable` comment to get it green. The browser tests use an already running local server at port 5173 and Chrome. They create and remove temporary projects and access fixtures in the local database. The SDK adapter, context and onboarding tests use fixtures (`tests/fixtures/os-project-onboarding.json` records the OS onboarding contract) and never contact FlightDeck.

## FlightDeck integration

See [SDK requirements](docs/FLIGHTDECK-SDK-REQUIREMENTS.md).

**Live (local only, read-only): workspace and project context.** The top of the sidebar and the mobile menu show **FlightDeck workspace** and **FlightDeck project** selects that mirror the FlightDeck OS sidebar switchers. Atlas reads them server-side from the OS inbound API (`GET /api/inbound/v1/context/workspaces` and `GET /api/inbound/v1/context/workspaces/:workspaceId/projects`, scope `read:context`) through its own `/api/flightdeck/context` route. The browser never contacts the OS and never receives the credential.

- One OS machine credential is used for everyone, so it cannot filter per user. The lists are shown only to the Atlas Super Admin (the role that administers Apps & connections); other members see nothing.
- The OS decides which workspaces are readable (`inbound.api.readWorkspaces`; empty means none). Disabled workspaces are listed but cannot be selected. Disabled projects are shown, unselectable, to the Super Admin only.
- The choice is saved per Atlas user in preferences (`flightdeckContext` with `osWorkspaceId` and `osProjectId`, deliberately distinct from Atlas's `?workspace=` project id) after re-checking fresh OS lists. An unknown project falls back to that workspace's default project; Atlas never switches the workspace on its own.
- Lists refresh on window focus and every minute. An unreachable OS keeps the last confirmed lists with their check time; a refused credential or missing configuration clears them. Choosing a context changes nothing in the OS or in Atlas projects.

Configure it in the ignored `.env.local` for development (or as deployment secrets): `ATLAS_FLIGHTDECK_URL`, for example `http://127.0.0.1:4173` (plain HTTP is accepted only for a loopback address), and `ATLAS_FLIGHTDECK_INBOUND_TOKEN`, an OS inbound credential with the `read:context` scope. Never commit or print the credential. Restart `npm run dev` after changing either value. A hosted Atlas cannot reach an OS running on another computer's loopback address, so this connection is local only.

**Built, not yet proven end to end against the OS: sending a project to FlightDeck for review.** In Connections → To FlightDeck, a project's onboarding form has three tabs: **Basics** (prefilled from the project), **FlightDeck details** (country, works-council relevance, owner role titles, data sources, access requested and more, with one-click prefill from a pilot's checklist) and **Review & send**, which lists every field that will be sent and everything that never is. A readiness meter counts the nine required items and links to each missing one. Only the Atlas Super Admin can press **Send to FlightDeck**, and only for a saved, complete draft, after choosing the destination workspace in that tab.

- Sending files a *request* (kind `project-onboarding`) through the OS inbound API with the same server-side credential. An OS admin reviews it; nothing is created automatically. The sponsor, task assignees and their emails are never sent, and owners travel as role titles. Atlas refuses to send an email address or phone number in any field except the summary and success measure. Those two are free text and travel as written: the form warns on an `@` or a phone number, but Atlas cannot recognise a person's name typed there (owner decision 5).
- Atlas records each send in D1 (`atlas_flightdeck_operations`, migrations 0004 and 0005) with its key and exact request body before contacting the OS. A lost reply is retried with the same key and the same bytes, so it can never file twice, and Atlas never records a revision FlightDeck did not get: a retry resends the revision first sent, even if the project was edited since. The body is kept only until FlightDeck files or refuses the request, or until the Super Admin closes the send. Deleting the project is refused while a send is still unconfirmed, so the body can never outlive the project it belongs to; once the send is resolved, deleting the project takes its send records and its FlightDeck link with it. A refusal of a retry keeps the reservation, because the earlier attempt may already have been filed. A retry skips the destination check (it was made when the key was reserved), so it still reaches FlightDeck after the workspace is disabled or unshared.
- When a retry keeps being refused, or FlightDeck says it does not know a filed request, the Super Admin can **Close this unconfirmed send** in Review & send. Nothing is sent; the draft opens again and the project shows "Send closed". The next send uses a fresh key. If FlightDeck did file the earlier attempt, it answers that key with the request it holds (`409 already_submitted`), and Atlas follows that request instead of filing a second one.
- The form, the To FlightDeck list and the dashboard card show the status: Submitted → Linked → Setup in progress → Setup complete. "Needs more info" from the OS reopens the draft. "Linked" appears only after FlightDeck confirms the project through `read:context`; the link is kept in `atlas_project_links`.
- **Atlas has no background job: it checks FlightDeck only while the Atlas Super Admin has Atlas open**, because only the Super Admin's view may use the shared machine credential. The Super Admin's open form checks its send at most once a minute. Their To FlightDeck list and dashboard card check up to two other sends a minute, each at most every five minutes, and stop when FlightDeck is busy or unreachable. Everyone else sees the stored status, reloaded every minute, and each sent project says when it was last checked with FlightDeck. All of this shares the credential's 30 requests a minute with the context reads.
- The OS's `project-onboarding` kind (plan workstream W1) is shipped on the OS integration line and enabled locally (decision 11, D-035 item 6), but not yet exercised end to end against the live OS. The OS enables it with both `INBOUND_PROJECT_ONBOARDING_ENABLED=true` and `inbound.api.integrationKinds=atlas:project-onboarding`, and the Atlas credential needs the `submit:proposal` scope. Where either is missing a send is refused and nothing is filed. Atlas's side is tested against a recorded contract fixture, not a running OS.
- Optional `ATLAS_INSTALLATION_ID` (a lowercase slug) scopes the link records; unset means `atlas-local`. Set it once, before the first send.

**Still disconnected:** FlightDeck SSO and delegated per-user identity, per-user OS membership filtering, import from FlightDeck (`/api/flightdeck/import` returns `503 flightdeck_not_connected`), sync and AI. The private preview’s platform identity is not FlightDeck SSO.

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

Connections has **From FlightDeck** and **To FlightDeck** flows. Atlas onboarding drafts persist with proposed OS names, workspace planning notes and FlightDeck details; users can edit, remove and export them. The Super Admin can send a saved, complete draft to FlightDeck as a proposal (above); nothing is sent automatically. Import from FlightDeck stays disconnected until delegated identity and project-level access exist with the SDK. See [the bridge contract](docs/PROJECT-BRIDGE-CONTRACT.md).

## Wellbeing and personal overview

- Account-specific browser storage for daily mood, rest/energy/clarity check-ins, a transparent self-reported readiness score, habits and original daily reflections. No check-in enters shared project APIs or AI feeds.
- Configurable Pomodoro with wall-clock persistence, pause/resume/reset, a longer break after four daily focus sessions, and in-app break reminders. Sessions start only when chosen.
- A compact dashboard widget, full Wellbeing page, running timer indicator, reduced-motion support and a dashboard visibility toggle.
- Outlook summary and calendar panels are explicitly disconnected pending Microsoft 365 app registration and delegated sign-in. No email/calendar data is fetched. See [personal hub requirements](docs/PERSONAL-HUB-CONTRACT.md).

## Immersive Project Eye

Dashboard/Project Eye tabs sit inside the top navigation. Project Eye hides the sidebar and exposes a labeled settings control. Its saved Explore/Scan preference, imagery, labels, terrain, building layers and optional sunlight/shadows are available there.

Cinematic scan searches actual active Atlas project fields and task text, with accent-insensitive token matching, attention/high-priority/completed filters, animated index channels and a cancellable reveal. It does not query cameras, people, external tracking feeds or the disconnected OS. Example data is explicitly labeled. Unmapped results open the project for editing instead of inventing coordinates.

Tour locations visits mapped results and stops on manual interaction, workspace entry, Stop or Escape. `/` opens search; reduced motion skips scan travel. Map markers enlarge on hover and show project tooltips. Panels can be hidden to explore the globe unobstructed.

## Productivity workspace

Today & advisor combines quick capture, planned work dates, a prioritized action queue, a focus-time budget and explicit rule-based watch-outs. Project workspaces include a task list/board, owners, due dates, estimates, checklists, notes, manual goals and goal-linked KPI measurements. All product records persist through the authorized project API and revision checks. Dashboard cards/list/status board, a collapsible deadline planner and a cross-view command menu make these tools reachable.

Project Eye adds circular flight targeting, smooth zoom controls, project orbit and risk marker colors; manual control and Escape stop motion. Reduced motion and the circular-lens setting are respected.

FlightDeck is the chosen future AI provider. Live AI, OS strategy/KPI feeds, TEOA and Outlook remain disconnected. See [research and selected roadmap](docs/PRODUCTIVITY-RESEARCH.md) and [strategy/AI SDK contract](docs/STRATEGY-AI-CONTRACT.md).

## Collaboration, apps, presentations and expanded globe

The Apps launcher and Super Admin catalog now support icons, links, audiences, favourites and recent apps. New projects are private, with explicit people/team sharing; older projects retain their previous visibility. Project collaboration adds discussions, mentions, meeting actions, decisions, reviews, benefits and private attachments. Teams, in-app notifications, capacity planning and onboarding playbooks are available. Tasks support permitted-member assignment, dependencies and completion-driven recurrence.

Presentation Studio provides five TE templates, saved/editable slides, notes, presentation mode and editable PowerPoint export. Globe settings now include seven simulated visual looks, HUD/scope, bloom/sharpening, camera controls, private scenes/annotations, and reported USGS earthquakes. Workspace animations use improved real-time 3D lighting and camera paths.

Apply migration 0002 and enable logical R2 binding BUCKET for attachments. No external service keys are included. Shared SSO, live FlightDeck AI/data, Microsoft 365 and additional globe feeds remain pending their service integrations. See [collaboration/app contract](docs/COLLABORATION-AND-APPS.md) and [Globe reference audit](docs/GODS-EYE-FEATURE-AUDIT.md).

## Work management and leadership reviews

Project workspaces now include task tables, shared compound saved views, selected-visible-task bulk edits, dated timelines with milestones and dependency conflicts, attributed manual time records, approved/forecast/actual budgets, three task playbooks, and two optional on-save automation recipes. Task and budget drafts retain the source revision to prevent overwriting concurrent edits. Dates are real-calendar validated.

Think like a leader offers CEO, VP and Director perspectives for the current moment, next weekly review or stage gate, grounded in saved project evidence. Reviewed actions can be added without duplicating the same role recommendation; source snapshots and Markdown briefs preserve review context. Snapshot history retains up to 20 reviews within the project payload budget, with an export alternative and explicit deletion. This is deterministic decision support; live AI remains reserved for FlightDeck OS.

Today includes Eat the Frog: one private account-saved daily task choice, concrete first step, personal time reservation, actual focus timer and task completion. Frog blocks are included in the focus budget without double-counting an existing task allocation. They do not book an external calendar.

The map is now called Project Eye; existing globe URLs and preferences are compatible. See [monday.com feature comparison and remaining gaps](docs/MONDAY-WORK-MANAGEMENT-AUDIT.md).
