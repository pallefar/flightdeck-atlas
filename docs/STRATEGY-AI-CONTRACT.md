# Strategy, KPIs and FlightDeck AI

Status: proposed SDK requirements, not deployed OS capabilities. The user selected FlightDeck OS's AI service; Atlas must not silently substitute an external AI provider.

## Available in Atlas now

Projects store manual strategy goals and KPI measurements alongside tasks in the existing durable project record, protected by the same edit permissions and revision checks. Goals have a title, outcome, owner, target date and status. KPIs have a unit, baseline, current value, target and optional goal link. A target below baseline measures a reduction. Progress is clamped to 0–100 and equal baseline/target is rejected. These measurements are labeled **Atlas / manual**, never OS data or an inferred trend.

Task work states are To do, Doing, Blocked and Done. `done` remains the authoritative completion flag; `workflow` categorizes unfinished work. `plannedDate` records the intended workday separately from `dueDate`. Descriptions, estimates and checklists remain Atlas enrichment until field ownership is agreed.

Today & advisor uses deterministic checks against currently visible Atlas data: blockers (including blocked tasks), overdue work, missing owners, stale updates, missing next actions and measurements moving away from their baseline. Suggested priorities explain their ordering. Missing estimates receive an explicitly labeled 30-minute allowance in the focus budget. This is not AI inference, a calendar schedule, or a guarantee that deadlines can be met.

## Required strategy and KPI SDK reads

Extend the stable OS instance/workspace/project reference in PROJECT-BRIDGE-CONTRACT.md. Provide project-to-strategy goal links, goal hierarchy, accountable owner, period, target date and source status. KPI records need stable IDs, goal/project links, display name, unit, direction/target semantics, baseline/current/target, observation date, reporting period, source revision, freshness and coverage/missing-state flags. Targets, ratios, thresholds and binary indicators must declare their type; do not force all metrics into Atlas's simple baseline-to-target formula.

Return series with timestamps when trend charts are supported; a single observation is not a trend. Preserve actual vs forecast and fiscal vs calendar periods. TEOA Advantage measures must include framework/version, site/value-stream context, applicable/exempt/missing states and source deep links. Missing values are not zero and unlike units must not be averaged.

Source-owned records stay separate from editable Atlas goals/KPIs. Agree a mapping and authority model before implementing any writeback. All source reads, cached results, exports and AI inputs must intersect current Atlas access with delegated OS project membership; Super Admin does not bypass OS access. Revocation must invalidate content and AI results.

## Required AI service contract

Provide a documented, delegated server-to-server review operation and capability discovery. The SDK chooses the provider/model and enforces company policy. Atlas needs service/version, authorized scopes, retention rules, request and token limits, timeout/cancellation, rate-limit/retry semantics, billing attribution, and a test environment. No raw host cookies or administrator credentials.

Proposed operations (names to be agreed): portfolio review, project review, prioritize actions, break down a task, and review goal/KPI watch-outs. Request inputs must be a bounded, server-authorized snapshot with immutable record IDs and revisions, requested operation, user instruction, locale and timezone. Project descriptions, task notes and imported documents are untrusted content, not model instructions. Exclude personal wellness, mailbox bodies and unrelated projects by default.

Return a request ID, generated timestamp, source snapshot/version, covered project IDs, missing-context warnings, summary, prioritized observations, evidence references and optional **draft** actions. Each observation references authorized project/task/goal/KPI IDs. Evidence links must resolve through Atlas's authorized records rather than arbitrary model URLs. Unsupported or inaccessible references are rejected. Distinguish observed facts from model judgment and preserve service failure states rather than substituting invented results.

Draft actions may suggest a task, owner, priority, estimate or plan date. They cannot grant access, change roles, send messages or execute tools. Show the current value and proposed change; the user selects and confirms the changes. Re-fetch permissions and source revisions before applying through existing mutation routes. Stale or revoked snapshots require a new review. Track applied proposal IDs to prevent duplicate tasks on retry and retain who accepted each change. AI requests never automatically write to the OS.

## Release checks

1. Missing or revoked membership prevents source and AI disclosure across views.
2. Every AI claim/action points to authorized evidence, and unknown IDs are rejected.
3. Prompt-like project notes cannot change tool access or trigger unreviewed writes.
4. Timeouts, rate limits and model failures retain an explicit unavailable state.
5. Applying a draft rejects changed revisions, validates field bounds and is idempotent.
6. Manual Atlas metrics and OS metrics keep distinct provenance after synchronization.
7. No wellness or mailbox data enters the AI payload unless separately requested and authorized.
