# Atlas as a FlightDeck master app

Status: proposed external-app contract. The FlightDeck SDK is not deployed; this document does not claim a supported manifest or live connection.

Atlas is a portfolio and action hub with dashboard/globe views, daily and weekly briefings, consultancy pilots, and an application access registry. Project storage and grants currently belong to Atlas. FlightDeck remains authoritative for its own workspace membership and sub-app permissions.

## Identity and authority

- One configured Super Admin grants/revokes Atlas access and creates roles. The account is bound to a trusted hosting identity through the secret `ATLAS_SUPERADMIN_EMAIL`, not a public signup rule or client-provided role. There is no first-user-wins elevation.
- Built-in **Admin** can create projects and edit/archive projects visible through project sharing. **Owner** can create projects and edit/archive their own, and can edit another project when explicitly granted its editor role. Project creators and the configured Super Admin manage project sharing; only the Super Admin grants Atlas admission or defines roles. New projects are private to their creator and the Super Admin. Existing projects retain their previous admitted-member visibility until changed.
- Custom roles select granular project, briefing and idea permissions. Access administration cannot be delegated through this UI. Role names confer no authority by themselves.
- Grants use sign-in email, bind to the authenticated subject on first use, and are checked on every API request. Revoked users are denied subsequent requests. Roles and audit events are stored in D1.
- The private Sites audience is a separate gate. Granting an Atlas role does not invite a user, add Sites sharing, or create an OS account. No invitation email is sent.
- The future SDK must provide a verified immutable subject plus explicit Atlas app entitlement. Do not trust unsigned URL parameters, client role flags, or OS display names. Map the configured Super Admin explicitly during identity migration; never automatically turn every OS admin into an Atlas Super Admin.
- Keep Atlas role administration distinct from OS governance: an Atlas custom role cannot widen FlightDeck workspace membership or Advantage approval permissions.

## Proposed registration

Use a stable app ID such as `flightdeck-atlas`, display name `Atlas`, and category `master-app`. These names are proposed registration metadata, not an existing SDK schema. Register the HTTPS origin, callbacks, permitted launch contexts and minimum SDK version once the host contract is published.

Supported Atlas views: `/?view=dashboard`, `/?view=globe`, `/?view=briefing`, `/?view=ideas`, `/?view=connection`, `/?view=access` (Super Admin only). The host must eventually pass a validated workspace/project context through its launch bridge; raw entity query parameters alone are insufficient.

Initial delegated capabilities requested: identity/session continuity, permitted workspace/project discovery, project read, Advantage readiness/portfolio summary read, and context-safe sub-app launch. Exact scope names and DTO versions remain an SDK decision. Plan separate, deliberate grants for later OS writes.

## TEOA Advantage

Add a typed SDK surface for:

- Readiness including connection, membership, instance/workspace/project enablement, schema state, and published framework availability.
- Project-scoped value streams, scorecards, improvement work, objectives, cycles, meeting summaries and escalation summaries. Portfolio use does not need full note bodies or attendee details by default.
- Workspace-scoped framework definitions, versions and explicitly labeled workspace totals.
- Stable `(workspaceId, projectId, appId, entityKind, entityId)` references, timestamp/revision markers, bounded reads, and context-aware deep links.
- Scorecard units, calendar/fiscal periods, framework versions, coverage and missing/exempt/out-of-scope states. Missing observations are not zero. Do not invent a single compliance percentage or combine incompatible units/calendars.

The current Advantage API depends on OS session context and enablement. Its standalone mode is not a general multi-project gateway. A host launch method must establish workspace/project context before opening a value stream, objective, cycle or meeting series.

Start with read/launch integration. Later write operations need explicit delegated authority, idempotency, optimistic concurrency, named-actor audit, and separate governance approvals for app enablement, framework publication, exemptions and tollgates. Atlas onboarding checklists and exported handoffs do not execute those operations.

## Acceptance checks

1. A grant to the verified user unlocks Atlas only after both host/site admission and Atlas authorization pass; revocation blocks subsequent API requests.
2. An Owner without a project editor grant cannot edit another creator's project; Admin cannot read an unshared private project or call user/role administration; no custom role can grant Super Admin authority.
3. OS project membership removal blocks its source records regardless of Atlas role.
4. Wrong, disabled or inaccessible context never falls back to another workspace/project.
5. An Advantage detail link opens in the intended context even when the OS shell last had a different project selected.
6. No source metrics, measurements, or success claims are fabricated to fill an empty portfolio panel.

## Project onboarding in both directions

See [PROJECT-BRIDGE-CONTRACT.md](PROJECT-BRIDGE-CONTRACT.md) for OS-to-Atlas import, Atlas-to-OS creation, instance-scoped references, durable idempotency, and the access controls required before enabling either flow. Draft preparation is available now; live discovery and creation await the SDK. This extends the initial read-only scope with separately authorized project creation.

## Collaboration and app ecosystem

See [COLLABORATION-AND-APPS.md](COLLABORATION-AND-APPS.md) for project roles, teams, discussions, reviews, file access, presentation snapshots, app registration and cross-app sign-in requirements.
