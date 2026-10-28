# Atlas v1 — decisions taken while building the onboarding brain

Source: *Atlas — the project onboarding brain of FlightDeck OS*, Draft v0.1 (2026-10-28).
That PRD is **not approved**. Everything below is an **assumption made to keep building**,
not an owner decision. Each row names what would change if the owner answers differently.

Status of every row: **assumed, pending owner.**

| # | Question (PRD §14) | Assumption used for v1 | If the owner says otherwise |
|---|---|---|---|
| 1 | Windows: Electron or Tauri? | **Electron** shell serving the shared web build, plus a native capture helper. Tauri is deferred; the helper boundary is a process, not an Electron API, so a Tauri swap replaces the shell only. | Replace `atlas/windows` shell; the capture helper and the web build do not change. |
| 2 | Identity: Supabase federated to TE Entra, or local-only? | **Neither wired in v1.** Atlas keeps the current host identity and reaches it only through an `IdentityAdapter` interface in `lib/domain/identity.ts`. No Supabase client, no token handling, no IdP changes. | Implement a second adapter; no data migration, because nothing stores an identity provider. |
| 3 | Hosting: stay on Cloudflare Sites or move with the OS? | **Stay on Cloudflare Sites** for v1. GDPR / SCC / localisation and "is this an approved TE location" are recorded as open legal risks, not solved. | Move the Worker + D1; the app is hosting-agnostic except `cloudflare:workers` bindings. |
| 4 | "KG" scope: OS KG only, or a new enterprise knowledge graph? | **OS KG only.** The evidence and process-step schemas use plain entity references (project, process, system, role, site) so a later promotion to an enterprise graph does not need a rewrite. No second KG is built. | Add the graph; the references already carry the entity kinds. |
| 5 | Vision vs TEOA: is Vision alignment enough? | **Both, as separate evidence.** Vision alignment reads the existing approved projection; TEOA alignment is a checklist a human approver signs. No Star-Level automation, no inferred compliance score. | Drop the TEOA checklist gate or make it advisory; it is one gate row, not a data model. |
| 6 | Gate approvers per function? | **Role-based only** (`onboarding.gate.*` permissions granted by the Super Admin). No names are hardcoded, no function-to-person map exists in code. | Grant the permissions; nothing in the schema changes. |
| 7 | Value method: AI Jam tiers or new? | **AI Jam value-case tracker tiers**, held as an editable, versioned config (`lib/domain/value.ts`), not constants in components. | Replace the tier config; stored records keep `method` + `methodVersion`. |
| 8 | Interview fallback: Cowork only, or in-app agent? | **Cowork only** in v1: Atlas emits a `cowork-handoff/1` bundle and ingests the returned result. An in-app interview agent stays an interface behind `ATLAS_INTERVIEW_AGENT` (off). | Turn the flag on and implement the agent behind the same interface. |
| 9 | Retention for raw recordings and transcripts? | **Configurable per evidence type**; default raw recording deleted 30 days after as-is sign-off, keyframes kept with redaction. Deletion is an audited event, never silent. Marked **pending Legal/Privacy**. | Change the config values; no schema change. |
| 10 | Rollout order: HR Services EMEA first? | **Config + seed data**, not a code branch. The pipeline is function-agnostic; the first rollout is a list of projects and owners. | Add or reorder the list. |

## Standing rules that are not open questions

These are requirements from the PRD that this build treats as non-negotiable, and they are
enforced in code, not just documented:

1. **No orphans.** A project cannot pass stage 4 without exactly one OS project link and one
   TEOA scope reference (`lib/domain/stages.ts` prerequisites).
2. **Estimate ≠ measured.** Every value figure carries a basis; a `measured` record without a
   source reference is refused at the contract boundary.
3. **Restricted data never leaves.** Export Restricted / ITAR / CUI / customer PII are blocked from
   upload, storage and any model call by `lib/governance/scan.ts`.
4. **Statutory steps stay human.** No code path can pass a statutory or works-council gate; it can
   only record a human's decision with their name.
5. **Every transition is audited.** Append-only, hash-chained `atlas_gate_events`; a broken chain is
   detectable and reported, never repaired silently.

## Deliberate non-goals in this build

- Drawing or editing maps — DiagramForge owns that; Atlas stores a reference and a read-only preview.
- Generating code or workflows — Studio owns that; Atlas emits a spec and ingests the compliance record.
- Running process steps — Companion / OS runtime owns that; Atlas reads aggregate run data.
- Replacing Vision OS dashboards — Atlas shows only the approved projection.
- Live OS calls in tests — every OS interaction is tested against recorded fixtures (the existing
  Atlas pattern); a live verification is reported as **not performed**.
