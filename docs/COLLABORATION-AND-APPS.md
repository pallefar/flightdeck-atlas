# Atlas collaboration and app ecosystem

## Available in Atlas

The nine-dot Apps launcher is available in Dashboard and God’s Eye. Super Admin manages names, icons (HTTPS or PNG/JPEG/WebP uploads), links, categories, order, enabled state, featured apps and audiences. Favourites and recent apps persist per account. FlightDeck starts with an explicit setup-pending entry. A destination link is not an SSO connection or a grant in that destination.

New Atlas projects are private by default, with the project and private policy inserted together. Existing projects without a sharing row keep their previous all-admitted-members visibility. Never delete a policy to privatise a project: missing policy means legacy visibility. The owner and Atlas Super Admin retain governance access. Admin edit-all permissions apply only to projects they can read. Owners or Super Admin may share with existing Atlas members and teams using viewer, commenter or editor roles. Team and Atlas revocation affect subsequent API checks. Atlas membership remains Super Admin-controlled and separate from private Sites admission.

Project collaboration includes task-linked comments and mentions, meetings with actions, decision records, named review requests, expected/realised benefit records, and attachments up to 10 MB. Review decisions are attributed to the authenticated named reviewer. Attachments use private R2 bytes plus D1 metadata, authenticated downloads and attachment disposition. Records use revision checks; project changes, notifications and access audit events commit together. Clients retain create IDs for retry reconciliation.

Task assignment can select a currently permitted member. Historical assignment/mention references do not prevent unrelated edits after revocation. Recurring tasks create one successor on completion, with fresh checklist state and a future date; they are not scheduled jobs. Dependencies are validated for existence/cycles and included in project risk/advisor checks. The 200-task bound applies after recurrence expansion.

The team hub provides an in-app notification inbox, daily/weekly grouping preferences, teams, capacity inputs and function onboarding playbooks. Hours/leave are private unless the user opts into sharing with members of common Atlas teams. Workload figures include only visible project tasks planned for the next seven days, and distinguish unestimated work. They are not a full calendar or wellness assessment. No email invitations or digests are sent by these features.

## Presentation studio

Templates cover leadership updates, project steering, strategy/KPIs, TEOA improvement and consultancy proposals. Select up to 15 projects, review/edit/reorder slides and speaker notes, save, present, and export editable PowerPoint. Decks store source references/revisions/timestamps. Export rechecks current source access. A deck is a snapshot, not automatic live refresh; stale source revisions are called out. TEOA template values are manual Atlas data until the source is connected.

Decks are private to their creator unless shared with members who have access to every source project. Only the creator edits a deck. Downloaded files are standalone copies. Source filtering is applied before serving saved deck content; access removal suppresses a deck requiring the removed source. Library and collaboration history offer pagination.

## Required FlightDeck work

1. Registered apps: stable IDs, approved origins/callbacks, icon metadata, app enablement, per-user entitlement and context-aware launch links.
2. Common identity: the owner's existing self-hosted Supabase Auth instance, with stable UUIDs and an agreed session/launch flow. See [SUPABASE-IDENTITY-CONTRACT.md](SUPABASE-IDENTITY-CONTRACT.md) for identity migration and delegated sign-in, expiry/revocation/logout/account-switch requirements. Atlas's Sites admission/sign-in gate must be addressed explicitly before claiming seamless SSO across hosts.
3. Membership: workspace, team and project discovery, current effective roles and changed/revoked membership events. Atlas custom roles never widen OS permissions.
4. Collaboration transport: agree ownership of tasks, comments, decisions and attachments before writeback. Stable IDs, scoped permissions, revisions, durable idempotency, audit actors and deletion events.
5. AI: the selected FlightDeck service supplies evidence-linked review and slide-outline drafts. Current templates are deterministic. Proposal inbox remains an honest disconnected state; proposals cannot silently mutate projects or send messages.
6. Microsoft 365: approved delegated Outlook/calendar and file storage connections. No mailbox data, meetings or SharePoint saves are active today. No personal wellness data enters shared views or AI payloads.

See the existing master-app, project-bridge and strategy/AI contracts for exact acceptance checks.
