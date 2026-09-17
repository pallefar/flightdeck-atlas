# Atlas integration handoff

Status: prepared for the forthcoming SDK. FlightDeck is not deployed yet. No live SSO or sync is claimed.

Atlas provides a project dashboard, globe, local project enrichment, durable private storage, and a typed read adapter in `lib/flightdeck/adapter.ts`. The adapter is based on the current project-list contract, with an injected authenticated transport so the new SDK can replace that boundary without rewriting the UI. The detailed source audit is retained locally, outside the public source repository.

## What Atlas needs from the OS / SDK

1. **Registered app and origins.** A stable Atlas app ID, SDK package/version, HTTPS host URL, allowed launch/callback origins, development origins, and a documented return-to-app flow.
2. **Delegated sign-in for separate hosts.** A standard authorization-code + PKCE or equivalent reviewed flow, one-use codes, state validation, audience and expiry checks, scoped server-side exchange, revocation and account switching. Existing host cookies cannot establish a session on a different hostname. Do not expose raw host session cookies, admin credentials, or database credentials to Atlas.
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
