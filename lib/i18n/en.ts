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
  // The Connections view: the FlightDeck context line.
  "onb.context.ok.chip": "Connected (read-only)",
  "onb.context.ok.text":
    "connected (read-only). The sidebar mirrors your FlightDeck OS workspace and project lists through the OS inbound API.",
  "onb.context.workspace_not_found.text":
    "connected (read-only). Your saved workspace is no longer shared with Atlas; choose another in the sidebar.",
  "onb.context.workspace_disabled.text":
    "connected (read-only). The selected workspace is disabled in FlightDeck.",
  "onb.context.checking.chip": "Checking",
  "onb.context.checking.text": "checking the FlightDeck inbound API.",
  "onb.context.not_configured.chip": "Not configured",
  "onb.context.not_configured.text":
    "not configured. Set the FlightDeck URL and inbound credential in Atlas server configuration.",
  "onb.context.not_permitted.chip": "Super Admin only",
  "onb.context.not_permitted.text":
    "read-only lists are shown to the Atlas Super Admin because they use one shared OS machine credential.",
  "onb.context.os_unreachable.chip": "Unreachable",
  "onb.context.os_unreachable.text":
    "FlightDeck OS could not be reached. The last confirmed lists stay visible.",
  "onb.context.rate_limited.chip": "Busy",
  "onb.context.rate_limited.text":
    "FlightDeck asked Atlas to wait before reading again.",
  "onb.context.invalid_response.chip": "Unexpected response",
  "onb.context.invalid_response.text":
    "FlightDeck answered, but not with the agreed context contract.",
  "onb.context.check_failed.chip": "Unavailable",
  "onb.context.check_failed.text":
    "Atlas could not check the context right now.",
  "onb.context.unauthorized.chip": "Refused",
  "onb.context.unauthorized.text":
    "FlightDeck refused Atlas's inbound credential. Nothing is shown.",
  // The Connections list row, before a project has a stage.
  "onb.row.draftPrepared": "Draft prepared",
  "onb.row.notPrepared": "Not prepared",
} as const;

export type MessageKey = keyof typeof en;
