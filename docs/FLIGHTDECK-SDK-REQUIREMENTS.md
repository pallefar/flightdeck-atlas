# Atlas integration handoff

Status: prepared for the forthcoming SDK. The owner confirmed on 2026-09-18 that FlightDeck login is moving to the existing self-hosted/local Supabase instance; Atlas must use that same identity provider. No live SSO or sync is claimed. Only the read-only workspace/project context below is live, locally.

## Live now: read-only workspace and project context (local only)

Added 2026-09-22 with the owner's approval. This is the only live FlightDeck connection. It is not SSO, not delegated identity and not project import.

- **OS routes** (inbound API route class, `Authorization: Bearer <inbound credential>` only, no cookies or `X-Workspace-Id`, scope `read:context`):
  - `GET /api/inbound/v1/context/workspaces` → `{ integrationId, workspaces: [{ id, label, enabled, isDefault }], generatedAt }`. Only workspaces listed in the OS admin setting `inbound.api.readWorkspaces`; empty means none.
  - `GET /api/inbound/v1/context/workspaces/:workspaceId/projects` → `{ workspaceId, projects: [{ id, label, enabled, isDefault }], generatedAt }`, disabled projects included and flagged. `404 { "error": "not found" }` for an unreadable or unknown workspace, `409 { "error": "workspace disabled", "code": "workspace_disabled" }` for a disabled one.
  - Refusals: the uniform `401`, the submissions route's missing-scope `403`, and `429` with `Retry-After`.
- **Atlas transport** (`lib/flightdeck/context-client.ts`, server-only): base URL and credential from `ATLAS_FLIGHTDECK_URL` and `ATLAS_FLIGHTDECK_INBOUND_TOKEN`. Plain HTTP is accepted only for loopback. Requests use a 5 s timeout, `cache: "no-store"`, no redirects, and no cookies. Responses are validated strictly against the DTOs above (`lib/flightdeck/context.ts`); an unknown field, duplicate id or response for another workspace is rejected. Outcomes map to typed states: `ok`, `not_configured`, `os_unreachable`, `unauthorized` (401/403), `rate_limited` (with `retryAfter`), `workspace_not_found` (404), `workspace_disabled` (409) and `invalid_response` (anything else, including an OS without these routes). Successful reads are reused for 10 s, and a rate limit is respected for all paths until it expires. This keeps Atlas within the OS's 30 requests per minute per credential.
- **Atlas route** `GET/PUT /api/flightdeck/context`: requires an Atlas sign-in (`projects.read`, as the catalog route). Because the OS credential is a machine credential that cannot filter per user, only the Atlas Super Admin receives lists; everyone else gets `not_permitted` and empty lists. `PUT` is same-origin only. It re-validates the selection against fresh OS lists, falls back to the workspace's default project for an unknown project, never switches workspace, and saves `flightdeckContext: { osWorkspaceId, osProjectId }` in the user's Atlas preferences. Responses never contain the credential.
- **UI**: `app/flightdeck-context-switcher.tsx` at the top of the sidebar and mobile menu. It mirrors the OS switchers: disabled workspaces are greyed and unselectable, disabled projects are hidden unless the viewer is Super Admin, the default project reads "General", and ambiguous labels show their id. Connections shows this context separately from import/onboarding, which stay disconnected (`503`).

This read-only path does not satisfy items 2–4 below: there is still no per-user OS identity or membership check, and OS lists must not be used to authorize Atlas data. Selecting a context changes nothing in the OS or in Atlas project records.

See [SUPABASE-IDENTITY-CONTRACT.md](SUPABASE-IDENTITY-CONTRACT.md) for the inspected repository state, shared-user target, identity migration, session requirements and local/hosted connectivity constraints.

Atlas provides a project dashboard, globe, local project enrichment, durable private storage, and a typed read adapter in `lib/flightdeck/adapter.ts`. The adapter is based on the current project-list contract, with an injected authenticated transport so the new SDK can replace that boundary without rewriting the UI. The detailed source audit is retained locally, outside the public source repository.

## What Atlas needs from the OS / SDK

1. **Registered app and origins.** A stable Atlas app ID, SDK package/version, HTTPS host URL, allowed launch/callback origins, development origins, and a documented return-to-app flow.
2. **Shared Supabase identity and delegated sign-in.** Use the existing self-hosted Supabase Auth instance and its verified immutable user UUID in both apps. Preserve Atlas admission as a separate Super Admin grant. For separate hosts, provide a standard authorization-code + PKCE or equivalent reviewed flow, one-use codes, state validation, audience and expiry checks, scoped server-side exchange, revocation and account switching. Existing host cookies cannot establish a session on a different hostname. Do not expose raw host session cookies, admin credentials, or database credentials to Atlas.
3. **Workspace-aware project reads.** Authenticated transport for current identity, workspace discovery, and project listing. Scopes such as `projects.read` are proposed SDK additions, not existing capabilities. Enforce membership server-side, including after membership removal. Define pagination, rate limits, errors, and an incremental change/deletion cursor.
4. **Stable source identity.** Preserve `(workspaceId, projectId)` across imports, updates, and deep links. Reject responses that resolve to an unexpected workspace. Include disabled/deleted state and an update revision.
5. **App-owned enrichment.** Atlas stores location, description, tasks, deadlines, and progress separately. The current OS project-list DTO does not provide these fields. Agree which fields remain Atlas-owned and which future SDK writes should update the OS. Project ownership metadata is not a substitute for workspace membership.
6. **Launch and navigation.** A versioned sub-app manifest or external app entry with dashboard/globe/project deep links, workspace/project context, theme events and session-change events. If embedded, validate postMessage source and origin and validate message schemas. Define CSP/frame rules and never transmit durable bearer tokens through URLs.
7. **Test environment.** A non-production API origin, normal/denied/pending accounts, two workspaces with identical local project IDs, project update/deletion events, and session expiry/logout fixtures.

## Acceptance checks before enabling the connection

- Signing into FlightDeck opens Atlas without another credential prompt; expiry, logout and account switching propagate.
- A user sees only permitted workspaces; membership removal immediately blocks subsequent reads.
- Projects import once using compound source IDs; repeated sync is idempotent and preserves Atlas enrichment.
- A workspace fallback never imports another workspace's projects.
- Disabled/deleted source projects reconcile explicitly; network failures preserve the last successful state and show freshness.
- A project opens in either app with the same workspace/project context.

The private Sites preview currently uses its platform sign-in. It is a preview identity boundary, not the proposed FlightDeck SSO implementation.

## Master app, users, and TEOA Advantage

See [MASTER-APP-CONTRACT.md](MASTER-APP-CONTRACT.md) for the proposed external master-app registration, Atlas role model, verified identity migration, Advantage portfolio data and context-aware launch requirements. Atlas roles must never expand permissions in FlightDeck or TEOA Advantage. Shared sign-in and external grants remain pending the SDK.

## Project onboarding in both directions

See [PROJECT-BRIDGE-CONTRACT.md](PROJECT-BRIDGE-CONTRACT.md) for OS-to-Atlas import, Atlas-to-OS creation, instance-scoped references, durable idempotency, and the access controls required before enabling either flow. Draft preparation is available now; live discovery and creation await the SDK. This extends the initial read-only scope with separately authorized project creation.

## Strategy, KPI and AI reviews

See [STRATEGY-AI-CONTRACT.md](STRATEGY-AI-CONTRACT.md). The user selected FlightDeck OS’s AI service. Atlas now stores manual goals, KPIs, task detail and separate plan dates; model reviews and source-owned metrics await permission-scoped SDK reads and an evidence-linked review contract.

## Collaboration, apps and presentations

See [COLLABORATION-AND-APPS.md](COLLABORATION-AND-APPS.md) for the implemented collaboration model, app registry, current presentation generation and required identity, membership, collaboration transport, AI and Microsoft 365 contracts.
