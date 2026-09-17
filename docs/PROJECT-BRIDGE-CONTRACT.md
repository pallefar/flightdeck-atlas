# FlightDeck ↔ Atlas project onboarding

Status: proposed SDK contract, not a live OS integration. Atlas supports saved onboarding drafts now. Discovery, import and OS creation stay disabled until the delegated SDK and access enforcement below are available.

## User flows

**From FlightDeck:** list only accessible, enabled OS projects that do not already have an Atlas counterpart. Include workspace labels, search and pagination. The user chooses “Create in Atlas.” The server re-fetches the selected source under the current delegated identity, checks Atlas project creation authority, then atomically creates an Atlas project and its external link. Repeated imports return the existing counterpart without replacing Atlas enrichment. Archived counterparts remain linked and can be restored; they must not become new import candidates.

**To FlightDeck:** create and work on an Atlas project first. Save an onboarding draft with the proposed OS label and optional workspace hint. The hint is plain planning text, not an authorized workspace ID. Once connected, select an accessible destination workspace with project-creation permission, review the final label, and explicitly submit. On successful creation, bind the OS reference to the existing Atlas project. No second Atlas project is created. Draft exports and existing consultancy onboarding stages do not imply that an OS project exists.

Current UI: Connections → From FlightDeck / To FlightDeck. Drafts persist in project storage, use existing edit permissions and revision conflict protection, and record changes in project history. No draft is submitted automatically when an SDK connection is later enabled.

## SDK surface required

`lib/flightdeck/bridge.ts` defines the proposed normalized `ProjectOnboardingSdk` interface, catalog schema and reference keys. This is separate from the verified current OS read DTOs in `types.ts` and `adapter.ts`.

- Discover approved workspaces and per-project visibility, returning stable OS **instance**, workspace and project IDs, labels, pagination and explicit import eligibility.
- Re-fetch a project by its full reference, enforcing current identity, membership, enablement and app entitlement. Reject resolved context mismatches; never silently substitute a default workspace.
- Create a project in an explicit workspace with a server-verified create capability. Accept an immutable Atlas origin `(appId, installationId, projectId)` and an idempotency key. Return an operation ID and pending/failed/succeeded state with the confirmed source reference.
- Fetch an operation to reconcile timeouts, lost responses and asynchronous creation. The same origin/idempotency key must return the original result, even after retries.
- Existing OS `POST /api/projects` is insufficient by itself: durable origin/idempotency and delegated authority are required. Do not infer a link from a matching label or slug collision.

Only the reviewed name and origin metadata are proposed for the initial OS creation. Atlas descriptions, tasks, location, deadlines, owners and metrics are not silently copied into OS fields. TEOA Advantage enablement or governance approvals are separate operations.

## Required server persistence before enabling writes

Add authoritative, installation-scoped `project_links`, outside generic editable project JSON:

- Unique `(installation_id, os_instance_id, workspace_id, os_project_id)`.
- Unique `(installation_id, atlas_project_id)` for one primary OS counterpart per Atlas project.
- Confirmed source ref, link timestamp, named actor, source revision, last checked time and access/disabled state.
- `atlas_projects.source` remains creation provenance; an Atlas-origin project stays Atlas-origin after onboarding.

Add durable onboarding operations with the Atlas revision, destination, proposed label, origin, stable idempotency key, status and OS operation/reference. Reserve before the remote call. After a lost response, enter “Needs reconciliation” and query the existing operation; do not issue a fresh key. Store confirmed links only after verified success. Imported Atlas rows and their links must commit in one transaction; uniqueness must hold across users and concurrent requests.

## Access is a release gate

Current Atlas grants allow all authorized members to view local Atlas projects. Before importing any OS data, intersect all linked-project reads with current OS project access on every API request, including project lists, direct reads/writes, briefings, exports, globe content and AI inputs. Atlas Admin or Super Admin never bypasses OS membership. A project import must not expose its label or metadata to unrelated Atlas members.

Bind delegated credentials to verified immutable identities and instances on the server. A client ref, role, workspace name or `canImport` flag does not authorize an import. Revalidate at submission, not only during discovery. Revocation, account switching, missing credentials and authorization errors fail closed. Never remove confirmed links merely because a page, outage or revoked membership omits them.

The current `/api/flightdeck/catalog` returns an authenticated disconnected state. Import and onboard endpoints enforce Atlas authentication/origin checks and return `503 flightdeck_not_connected`; they perform no OS writes. They must be replaced together with server persistence and access filtering, not enabled by a client flag or a URL.

## Acceptance checks

1. Same label across workspaces/instances stays distinct; same confirmed ref imports once under concurrent requests.
2. Archived counterpart is excluded from candidates; partial pages never remove links.
3. Denied, pending, disabled and context-fallback records cannot import. Access removal blocks linked source content across every view/API.
4. OS create requires both Atlas edit authority and explicit OS create authority in the destination; an Atlas role cannot supply it.
5. Timeout after remote success reconciles to the one OS project; origin/slug collisions never attach an unrelated project.
6. Updating Atlas details cannot overwrite a source link. Repeated source refresh preserves Atlas-owned enrichment.
7. Empty source progress is labeled “Progress not tracked”; missing TEOA measures are not zero.
8. Errors preserve drafts; connecting never silently submits them. Only verified OS success displays “Linked.”
