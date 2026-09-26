// English, the source language. Every key lives under its lane's namespace
// (onb.*, apps.*, pages.*, crm.*); a lane adds its own keys here and in de.ts
// in the same change. Placeholders are {name}; t() fills them.
export const en = {
  // Onboarding (To FlightDeck): stage names shared by the form, the
  // timeline and the Connections list.
  "onb.stage.not-confirmed": "Not confirmed",
  "onb.stage.submitted": "Submitted",
  "onb.stage.linked": "Linked",
  "onb.stage.setup-in-progress": "Setup in progress",
  "onb.stage.setup-complete": "Setup complete",
  "onb.stage.needs-more-info": "Needs more info",
  "onb.stage.rejected": "Declined",
  "onb.stage.not-sent": "Not sent",
  "onb.stage.closed": "Send closed",
  "onb.timeline.aria": "FlightDeck status",
  "onb.tab.basics": "Basics",
  "onb.tab.details": "FlightDeck details",
  "onb.tab.review": "Review & send",
  "onb.step.aria": "Onboarding steps",
  "onb.step.apps": "Apps (optional)",
  "onb.step.agents": "AI agents (locked)",
  "onb.step.apps.note":
    "Choosing apps for this project is not available yet. It is optional and never counted as a required detail.",
  "onb.step.agents.note":
    "AI agents are locked: they cannot be requested yet. Nothing on this step is sent or counted.",
  // AI agents prerequisites (onb-aiagents-locked-atlas). OWNER REVIEW: this
  // wording is a draft until the owner reviews it
  // (AI_AGENTS_COPY_REVIEW_STATUS in lib/flightdeck/onboarding.ts).
  "onb.agents.heading": "What must be in place before AI agents can be requested",
  "onb.agents.status.open": "Open",
  "onb.agents.ownerLabel": "Owner: {owner}",
  "onb.agents.cap.bedrock": "Use Bedrock at all",
  "onb.agents.cap.employeeData": "Agents touching employee data",
  "onb.agents.cap.studio": "Agents defined in Studio",
  "onb.agents.cap.cowork": "Agents run by Cowork",
  "onb.agents.pre.providerDpaRegion":
    "AWS approved as provider, the data processing agreement and cross-border approval, and the Bedrock region",
  "onb.agents.pre.aiHold":
    "The hold on AI features (roadmap phase 56) answered, or agents carved out of it",
  "onb.agents.pre.iam":
    "The AWS IAM role or keys set up with least privilege",
  "onb.agents.pre.worksCouncil":
    "The works council's decision for agents that process employee data (§87(1) Nr. 6 BetrVG)",
  "onb.agents.pre.retention":
    "Legal's ruling on retention and cross-border handling of what is sent to agents (D-033 decision 6)",
  "onb.agents.pre.ruling8":
    "Studio ruling 8: approval of the agent assistant template",
  "onb.agents.pre.promptWording":
    "A human-approved change to the Cowork project-setup prompt wording",
  "onb.agents.owner.owner": "Owner",
  "onb.agents.owner.ownerAndDpo": "Owner and Legal / data protection officer",
  "onb.agents.owner.legal": "Legal",
  "onb.agents.owner.operator": "Operator",
  "onb.agents.owner.worksCouncil": "Works council",
  "onb.step.back": "Back",
  "onb.step.next": "Next",
  "onb.step.position": "Step {n} of {total}: {name}",
  "onb.meter.forYou": "{done} of {total} for you",
  "onb.meter.required": "{done} of {total} required",
  "onb.note.title": "Reviewer's note",
  "onb.note.fields": "Fields to check",
  "onb.step.flagged": "needs a fix",
  "onb.errors.title": "Complete these details before going on:",
  "onb.check.last": "Last checked with FlightDeck: {when}",
  "onb.check.never": "Not checked with FlightDeck yet",
  "onb.check.note":
    "Atlas checks FlightDeck only while the Atlas Super Admin has Atlas open.",
  "onb.reason.os_unreachable": "FlightDeck could not be reached.",
  "onb.reason.invalid_response": "FlightDeck answered unexpectedly.",
  "onb.reason.rate_limited": "FlightDeck was busy.",
  "onb.reason.already_submitted":
    "FlightDeck already holds a request for this project.",
  "onb.reason.invalid_submission": "FlightDeck rejected the request format.",
  "onb.reason.unauthorized": "FlightDeck refused Atlas's credential.",
  "onb.reason.refused":
    "Project onboarding is not enabled for Atlas in FlightDeck, or Atlas's credential lacks submit:proposal.",
  "onb.reason.invalid_payload": "Some details were not in the agreed format.",
  "onb.reason.project_not_visible":
    "FlightDeck accepted it and is creating the project; Atlas is waiting to see it listed.",
  "onb.reason.destination_not_shared":
    "FlightDeck accepted it into a workspace that is not shared with Atlas, so Atlas cannot confirm it.",
  "onb.reason.credential_scope":
    "FlightDeck accepted it, but Atlas's credential lacks read:context, so Atlas cannot see the outcome.",
  "onb.reason.lock_unreadable":
    "FlightDeck needs an operator to inspect this request's lock.",
  "onb.reason.idempotency_key_conflict":
    "FlightDeck holds this request's key for a different Atlas project, so nothing was filed.",
  "onb.reason.instance_unknown":
    "FlightDeck does not publish its instance id yet, so Atlas cannot record the link.",
  "onb.reason.link_conflict":
    "That FlightDeck project is already linked elsewhere, so Atlas did not link it.",
  "onb.reason.submission_not_found": "FlightDeck does not know this request.",
  // An editor's view of a send FlightDeck holds but has not yet linked.
  "onb.reason.waiting_to_be_filed": "Sent, waiting for FlightDeck to file it.",
  "onb.reason.abandoned":
    "The Atlas Super Admin closed it before FlightDeck confirmed it.",
  "onb.reason.duplicate": "It duplicates another request.",
  "onb.reason.out-of-scope": "It is out of scope for FlightDeck.",
  "onb.reason.other": "No reason code was given.",
  "onb.headcount.<50": "Fewer than 50",
  "onb.headcount.50-249": "50 to 249",
  "onb.headcount.250+": "250 or more",
  "onb.headcount.unknown": "Unknown",
  // The dashboard card.
  "onb.summary.none":
    "Onboarding: no project sent yet. Prepare one in To FlightDeck.",
  "onb.summary.line": "Onboarding: {parts}.",
  "onb.summary.sent": "{n} sent to FlightDeck",
  "onb.summary.linked": "{n} linked",
  "onb.summary.moreInfo": "{n} need more info",
  "onb.summary.declined": "{n} declined",
  "onb.summary.awaiting": "{n} awaiting confirmation",
  "onb.summary.notSent": "{n} not sent",
  "onb.summary.closed": "{n} closed before FlightDeck confirmed",
  "onb.promo.unavailable": "Onboarding status is unavailable right now.",
  "onb.promo.checking": "Checking onboarding status…",
  "onb.promo.open": "FlightDeck connection",
  "onb.promo.import": "Import from FlightDeck: not enabled",
  // The Connections view: its one connection line, from the credential's
  // whoami (onb-atlas-connection-clarity).
  "onb.conn.checking": "Checking the FlightDeck connection…",
  "onb.conn.readSubmit": "Connected: can read context and send onboarding requests",
  "onb.conn.readOnly": "Connected: read only",
  "onb.conn.submitOnly": "Connected: can send onboarding requests, cannot read context",
  "onb.conn.notConnected": "Not connected ({reason})",
  "onb.conn.reason.not_configured": "FlightDeck is not configured in Atlas",
  "onb.conn.reason.unauthorized": "FlightDeck refused Atlas's credential",
  "onb.conn.reason.os_unreachable": "FlightDeck could not be reached",
  "onb.conn.reason.rate_limited": "FlightDeck asked Atlas to wait; try again shortly",
  "onb.conn.reason.invalid_response": "FlightDeck sent an unexpected answer",
  "onb.conn.reason.no_scope": "the credential carries no Atlas scope",
  "onb.conn.reason.check_failed": "Atlas could not check the connection",
  // The Connections list row, before a project has a stage.
  "onb.row.draftPrepared": "Draft prepared",
  "onb.row.notPrepared": "Not prepared",
  // The onboarding autosave (onb-atlas-save-ux): pill, leave guard, conflict.
  "onb.autosave.label": "Autosave",
  "onb.autosave.idle": "All changes saved (revision {revision})",
  "onb.autosave.pending": "Changes not saved yet",
  "onb.autosave.saving": "Saving…",
  "onb.autosave.saved": "Saved {time} (revision {revision})",
  "onb.autosave.retrying": "Not saved, retrying in {seconds} s",
  "onb.autosave.conflict": "Not saved: someone else saved this draft",
  "onb.autosave.locked":
    "Not saved: FlightDeck may hold this draft, so it stays as it was sent",
  "onb.autosave.refused": "Not saved: {error}",
  "onb.autosave.basics": "Basics not saved yet: use Save now",
  "onb.autosave.saveNow": "Save now",
  "onb.autosave.leave":
    "Some onboarding changes are not saved yet. Leave anyway and lose them?",
  "onb.conflict.title": "Someone else saved revision {revision}",
  "onb.conflict.recoveredTitle": "Unsaved changes from before the reload",
  "onb.conflict.loading": "Loading the other version…",
  "onb.conflict.unavailable":
    "The other version could not be loaded. Your changes are kept here; Atlas tries again when you choose.",
  "onb.conflict.intro":
    "Your changes are kept in this browser tab until you choose. Keep mine puts your values back on top of revision {revision} and saves them; Use theirs discards your changes.",
  "onb.conflict.field": "Field",
  "onb.conflict.yours": "Yours",
  "onb.conflict.theirs": "Theirs",
  "onb.conflict.empty": "(empty)",
  "onb.conflict.same": "Both versions hold the same values.",
  "onb.conflict.keepMine": "Keep mine (re-apply on top)",
  "onb.conflict.useTheirs": "Use theirs",
  // The project page: the local readiness field (was "Onboarding stage"),
  // and the FlightDeck card (plan 2026-09-25 J1).
  "onb.readiness.label": "Readiness stage",
  "onb.card.title": "FlightDeck",
  "onb.card.prepare": "Prepare FlightDeck request",
  "onb.card.prepare.text":
    "Prepare a request to set this project up in FlightDeck. An OS admin decides; nothing is created automatically.",
  "onb.card.continue": "Continue draft ({done} of {total} for you)",
  "onb.card.continue.text":
    "Your draft is saved in Atlas. Only the Atlas Super Admin sends it to FlightDeck.",
  "onb.card.lastStage": "Last send: {stage}",
  "onb.card.waitingSuperAdmin": "Waiting for Super Admin",
  "onb.card.waitingSuperAdmin.text":
    "FlightDeck has not confirmed the send yet. The Atlas Super Admin retries or closes it.",
  "onb.card.waitingFlightDeck": "Waiting for FlightDeck review",
  "onb.card.waitingFlightDeck.text":
    "An OS admin decides; nothing is created automatically.",
  "onb.card.fix": "Fix request",
  "onb.card.fix.text":
    "FlightDeck asked for more information. Update the draft; the Atlas Super Admin sends it again.",
  "onb.card.created": "Project created",
  "onb.card.created.text": "FlightDeck holds this project now.",
  "onb.card.open": "Open in FlightDeck",
  "onb.card.view": "View status",
  "onb.card.close": "Close",
  "onb.prefill.checklist": "Suggested from the onboarding checklist",
  "onb.prefill.atlas-project": "Taken from the Atlas project",
  "onb.prefill.starter": "From starter {id}, version {version}",
  // Starter choice (onb-starter-choice-machinery): shown only once the owner
  // approves a starter; the shipped list is empty.
  "onb.starter.title": "Start from",
  "onb.starter.blank": "Start blank",
  "onb.starter.meta": "{owner} · version {version} · approved {date}",
  "onb.starter.preview": "Applying fills these fields:",
  "onb.starter.nothing":
    "Every field this starter fills already has a value, so nothing changes.",
  "onb.starter.apply": "Apply starter",
  "onb.starter.applied": "Applied starter {name}, version {version}.",
  "onb.starter.undo": "Undo",
  "onb.card.rowLink": "FlightDeck card",
  // Ask and send (onb-atlas-request-ui, plan 2026-09-25 J3).
  "onb.ask.button": "Ask Super Admin to send revision {revision}",
  "onb.ask.waiting": "Waiting for Super Admin (revision {revision})",
  "onb.ask.waiting.text":
    "You asked the Atlas Super Admin to send revision {revision}. They choose the destination and send it; nothing is sent until they do.",
  "onb.ask.changed": "Changed since you asked: ask again",
  "onb.ask.changed.text":
    "The draft changed after you asked for revision {revision}. Ask again so the Super Admin sends what you see now.",
  "onb.ask.withdraw": "Withdraw the request",
  "onb.ask.theirs.text":
    "{by} asked the Atlas Super Admin to send revision {revision}. Only {by} or the Super Admin can withdraw the request; nothing is sent until the Super Admin sends it.",
  "onb.ask.theirs.changed": "Changed since {by} asked: ask again",
  "onb.ask.theirs.changed.text":
    "The draft changed after {by} asked for revision {revision}. Ask again so the Super Admin sends what you see now.",
  "onb.ask.asked":
    "Asked the Super Admin to send revision {revision}. Nothing has been sent to FlightDeck.",
  "onb.ask.withdrawn":
    "Request withdrawn. Nothing was sent to FlightDeck.",
  "onb.ask.saveFirst":
    "Save the draft first: the Super Admin sends the saved revision.",
  "onb.ask.notReady":
    "Complete your details first ({done} of {total} for you).",
  "onb.ask.failed": "The request could not be saved. Try again.",
  "onb.waiting.title": "Waiting for you ({count})",
  "onb.waiting.row": "{by} asked to send revision {revision}",
  "onb.waiting.changed": "Changed since asked",
  "onb.waiting.review": "Review and send",
  "onb.waiting.card": "Waiting for you: send revision {revision}",
  "onb.diff.title": "Changed since revision {revision}",
  "onb.diff.field": "Field",
  "onb.diff.asked": "Asked (revision {revision})",
  "onb.diff.now": "Now (revision {current})",
  "onb.diff.none":
    "No sent field differs from the asked revision; only the revision number moved.",
  "onb.diff.unknown":
    "Atlas kept no copy of revision {revision}, so it cannot list the changes. Review every field in What will be sent.",
  "onb.diff.empty": "(empty)",
  // The waiting view (onb-atlas-status-timeline, plan 2026-09-25 J4).
  "onb.observed.aria": "What Atlas saw",
  "onb.observed.row": "{stage}: {seen}",
  "onb.observed.seen": "seen {when}",
  "onb.observed.before": "before tracking",
  "onb.history.title": "Earlier sends",
  "onb.history.revision": "Revision {n}",
  "onb.history.adopted": "FlightDeck's earlier request",
  "onb.history.row": "{send}: {stage} ({seen}).",
  "onb.history.again": "Sent again as revision {n}.",
  "onb.history.againAdopted": "Sent again.",
  "onb.outage": "Could not reach FlightDeck since {when}.",
  "onb.eta.one": "Usually answered within 1 working day.",
  "onb.eta.many": "Usually answered within {n} working days.",
  "onb.check.seen": "Last update seen {when}",
  "onb.check.seenNever": "No update seen yet",
  "onb.next.not-confirmed":
    "Next: the Atlas Super Admin retries the send or closes it.",
  "onb.next.submitted": "Next: an OS admin reviews the request in FlightDeck.",
  "onb.next.linked": "Next: FlightDeck sets the project up.",
  "onb.next.setup-in-progress":
    "Next: FlightDeck finishes setting the project up.",
  "onb.next.setup-complete": "Next: work in the project in FlightDeck.",
  "onb.next.needs-more-info":
    "Next: update the draft and ask for it to be sent again.",
  "onb.next.rejected":
    "Next: nothing is pending. Update the draft if you want to send it again.",
  "onb.next.not-sent": "Next: fix what FlightDeck refused, then send again.",
  "onb.next.closed": "Next: the draft is open again and can be sent again.",
  // Pages (pages-atlas-mirror-contract): what Atlas says instead of a PageDoc
  // it cannot read (lib/pagedoc-atlas.ts).
  "pages.doc.tooNew": "This page needs an Atlas update",
  "pages.doc.unreadable": "This page cannot be shown",
  // Presentations (deck-atlas-export): the owner-only export for the
  // FlightDeck import.
  "decks.export.button": "Export my presentations for FlightDeck",
  "decks.export.hint":
    "The file holds only presentations you own whose source projects you can still open.",
  "decks.export.done": "Exported {count} presentations.",
  "decks.export.withheld":
    "{count} not exported: a source project is no longer available to you, the presentation could not be read, or the file limit was reached. They are listed under \"withheld\" in the file.",
  "decks.export.failed": "The export failed. Try again.",
} as const;

export type MessageKey = keyof typeof en;
