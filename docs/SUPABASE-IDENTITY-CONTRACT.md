# Shared Supabase identity for FlightDeck OS and Atlas

Decision recorded 2026-09-18: use the owner's existing self-hosted/local Supabase installation as the common identity provider. FlightDeck is moving login to Supabase Auth. Do not create a separate Supabase project or a second password directory for Atlas.

Status: migration target and implementation handoff. Supabase login is not active in Atlas. The running local instance, its reachable endpoint, deployed Auth version and the OS migration branch still need verification. No production identity, data or access-policy changes have been made for this handoff.

## What the repository currently establishes

Reviewed FlightDeck `main` at `60ae92b8573b666fa19ce3876810d22fde50feea` and the authentication-related files on `feat/subapp-platform` at `067a2168d18d38a47297c1c912af726735d2b665`. Those auth files match. This is repository evidence, not a claim about the owner's newer local checkout or running installation.

- The compose configuration includes self-hosted Postgres and GoTrue. Its pinned GoTrue image is `supabase/gotrue:v2.158.1`, with published ports bound to loopback. The running installation may differ.
- Current application login still uses the FlightDeck-owned `auth_users` and `auth_sessions` tables in the central `flightdeck_landlord` schema, plus the `flightdeck_session` cookie. These are distinct from Supabase Auth's managed `auth.users` and `auth.sessions`.
- The OS already separates instance roles, workspace membership and project/sub-app authorization. Its OIDC client resolves issuer/subject identities and keeps unknown users pending. Preserve those checks through the migration.
- Existing OS users are identified by username, with no email column in the inspected identity schema. Email-based automatic matching to Atlas would not be a valid migration.
- PostgREST and Kong are deliberately absent from this compose configuration. A standard hosted Supabase API base URL, exposed table API or recent OAuth server feature cannot be assumed to exist.
- Atlas currently authenticates through its private Sites host and stores Atlas grants and project data in D1. It has no independent password database. Its hosting user IDs are not Supabase IDs.

## Target ownership

| Concern | Authority |
| --- | --- |
| Sign-in, credentials, MFA, recovery, user UUID | Existing shared Supabase Auth instance |
| OS instance/workspace/project membership | FlightDeck authorization service |
| Admission to Atlas, custom Atlas roles | Explicit Atlas grants controlled by its Super Admin |
| Project sharing and collaboration | Atlas project policy, intersected with OS permissions for OS-sourced data |
| Session launch, refresh, logout and revocation transport | Agreed FlightDeck SDK/auth gateway contract |
| Atlas projects, decks and personal preferences | Atlas-owned storage; moving these records to Postgres is a separate data migration |

Both applications identify the same person by the verified Supabase `sub` / `auth.users.id`, namespaced by the configured provider instance/issuer. Display names and emails are contact attributes. A valid Supabase login grants no Atlas role by itself. Preserve the owner's explicit Super Admin assignment and the ability to add roles later.

## Shared users and shared sign-in are separate requirements

Using the same Auth instance gives both applications the same user identities. Separate browser origins still have separate cookies and storage. A Supabase client pointed at the same URL does not by itself make sign-in persist across both apps.

Preferred local implementation: serve the applications through one trusted FlightDeck gateway with a shared server-managed login. Atlas needs path/asset/API routing preparation if mounted below a prefix. Do not assume the existing application can simply be dropped under `/atlas/` without that work.

For separate origins, agree an authorization-code + PKCE launch flow with registered clients, exact callbacks, state/nonce validation, one-use codes, server-side exchange and account-switch/logout handling. A native Supabase OAuth/OIDC server is an option only after verifying support in the installed version and its configuration. Current Supabase documentation describes that capability; it does not establish that the old image pinned in this repository implements it. If unavailable, the OS team must provide a reviewed gateway flow or upgrade the shared instance before Atlas activation.

Do not pass refresh tokens or the OS session cookie through launch URLs, browser messages or app-link settings. Share the identity service, not one copied refresh token across independent apps.

## Required OS / SDK contract

Proposed fields below are requirements, not claims of existing endpoints:

- Identity: `providerInstanceId`, exact `issuer`, immutable `subject`, display name, optional verified email, approved/pending/disabled status.
- Session: session identifier, expiration, allowed audience/client, secure validation/refresh transport and an explicit active-session/revocation check where immediate logout is required.
- Atlas entitlement: app enabled, user admitted, grant revision, and explicit app role/permissions. These are server-owned records, never user-editable profile metadata.
- Context: permitted instance/workspace/project IDs, effective membership and source revision. No fallback to another workspace when the requested one is denied.
- Events: identity linked, user disabled/deleted, membership removed, Atlas grant revoked, sign-out and account switched. Cache invalidation must be defined.
- App registration: FlightDeck and Atlas origins, callback and logout URLs, development URLs, SDK version and transport contract version.

Atlas verifies identity server-side. Never authorize from a client-supplied user object or a decoded but unverified JWT. Validate signature or use the trusted Auth service, exact issuer, token purpose/audience, expiration and immutable subject. JWT signature validation alone does not prove the session is still active after logout; document and test the revocation policy. Service-role keys, database credentials and the Auth signing secret are not Atlas browser configuration.

## Migrate identities without losing ownership

1. Take recoverable snapshots and rehearse with a test account before cutover. Keep the current login usable until the complete replacement path passes acceptance checks.
2. The OS team creates an explicit mapping from each existing FlightDeck account to its Supabase user UUID, preserving membership and historical audit attribution. Use a supported account provisioning/recovery process; do not copy the old custom password hashes into Supabase internals.
3. Link the owner's existing Atlas principal to that same verified UUID through an explicit administrative migration. Do not auto-link by matching email or display name. Bind the Super Admin to the configured issuer and UUID.
4. Prefer an identity-link table retaining stable Atlas principal IDs: unique `(provider_instance, issuer, subject)` to `atlas_principal_id`, with a reviewed legacy mapping. That avoids replacing every project/deck owner and preferences key just to change the login provider.
5. Evolve current email-addressed member grants, team membership, project person grants, task assignees, reviewers and notification recipients toward immutable principal IDs. Preserve historical authors and email/name snapshots for display; never rewrite append-only audit events. Handle changed/reused emails without transferring access.
6. Preserve per-account personal settings and browser-only wellbeing data for the verified linked account. Do not copy wellness history into the shared directory or other users' accounts.
7. Reconcile disabled, pending and revoked users before activation. Do not infer Atlas admission from OS admin roles or from Supabase signup.

## Local and hosted connectivity

The owner's local Supabase host and URL are still required. No running Supabase container was found in this Mac's current Docker context; this does not establish where the existing installation is running.

A hosted Atlas server cannot reach another computer's `localhost`. Establish a deliberate HTTPS gateway/private connectivity route, or run Atlas beside FlightDeck locally. Keep Postgres and Studio private; Atlas needs the approved Auth/SDK HTTP interface, not a raw database port.

The current private Sites URL also has a hosting-owned ChatGPT sign-in gate. Supabase does not replace that gate automatically. Confirm a supported external-identity hosting path, or host Atlas with the FlightDeck gateway before promising a single-login experience. Do not change the Site audience or disable current authorization merely to remove the extra sign-in.

## Acceptance checks before cutover

- The same person resolves to the same Supabase UUID in both apps, with existing Atlas project/deck ownership intact.
- FlightDeck login launches Atlas without asking for credentials again in the chosen deployment topology.
- A valid Supabase user without an Atlas grant is denied; pending, disabled and revoked accounts cannot act.
- Wrong issuer/audience, expired tokens, tampered state, reused codes and unregistered callbacks are rejected.
- No role is accepted from browser flags or user-editable metadata. Only the configured Atlas Super Admin can grant Atlas access and define roles.
- Revoking a session or grant blocks subsequent protected operations according to the documented revocation policy. Account switching clears prior-user data.
- Workspace/project membership removal hides source content and blocks writes/export, even if the person remains an Atlas member.
- Failed migration or unavailable Auth service fails closed and has a tested rollback; no silent fallback to a weaker identity source.

## Source references

Repository source was inspected through the owner's GitHub connection; no runtime credentials were read or changed.

- FlightDeck: `flightdeck/docker-compose.supabase.yml`, `flightdeck/db/migrations/0001_landlord.sql`, `flightdeck/server/services/auth.ts`, `flightdeck/server/routes/auth.ts`, `flightdeck/server/lib/rbac.ts`, `flightdeck/server/services/oidc.ts` at the revisions above.
- [Supabase sessions](https://supabase.com/docs/guides/auth/sessions): token refresh and sign-out/revocation behavior.
- [Supabase OAuth server](https://supabase.com/docs/guides/auth/oauth-server) and [setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started): version-dependent option for separate-origin sign-in.
- [Supabase server-side auth guidance](https://supabase.com/docs/guides/auth/server-side/advanced-guide): server validation and session handling.
