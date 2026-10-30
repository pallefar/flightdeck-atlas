# Taking Atlas to the next level

Three promises, in the order they must be earned:

| Promise | What it means in practice | Today it is |
|---|---|---|
| **Anyone can use it** | a person with a TE account opens the app, is signed in, sees what is theirs, and is never asked for a token or a workspace id | **not true** — a device token must be minted by the Super Admin, and an empty workspace is a dead end |
| **Idea → workflow in minutes** | from "we keep retyping these invoices" to a draft workflow a person can test, in under 10 minutes, with everything Atlas needs to keep auditing it | **not true** — the app records and measures, but it does not turn a captured process into a workflow, and the shortest honest path is about a week |
| **Studio for the complex ones** | Atlas emits a Studio spec and takes the compliance record back; complex workflows never start from a blank page | **half-true** — `atlas-studio-spec/1` and the hand-off row exist, but no transport is wired and Studio is not available yet |

The plan below closes the first two, and designs the Studio seam so the third lands without a rewrite.

## Where we actually are (2026-10-30)

Built and tested, in the app and the lane:

- the four-step wizard for three kinds (project, process, workflow), roles and assignments,
  a ten-stage rail, six tabs, a pinned gate, readiness over seven facts (same number on the
  board, the card and the portfolio), a value chart, evidence metadata with a local hash,
  a hash-chained audit, map requests reserved to DiagramForge, feedback, an update verdict,
  and direct links into the Atlas lane.
- the contracts around it: `atlas-evidence/1`, `atlas-gate-event/1`, `atlas-value/1`,
  `atlas-onboarding-record/1`, `atlas-studio-spec/1` (builder only), `cowork-handoff/1` (builder only).

Not built: sign-in without a token, a demo workspace, capture (screen/voice), transcription,
evidence upload, the Studio transport, the Windows client, any workflow model, any run data.

## The gaps that block the promises

| # | Gap | Blocks | Size |
|---|---|---|---|
| 1 | The app needs a device token minted by a Super Admin | *anyone* | M |
| 2 | An empty workspace has nothing to look at, and no way to try without creating | *anyone* | S |
| 3 | The product's words are the CoE's words ("gate", "as-is", "TEOA scope") | *anyone* | M |
| 4 | No capture → no steps: a process must be typed in | *minutes* | L |
| 5 | No workflow model: nothing turns steps into something runnable | *minutes*, *Studio* | L |
| 6 | No "quick lane": the only path is all ten stages | *minutes* | M |
| 7 | No Studio transport, and Studio is not available | *complex workflows* | S now, L later |
| 8 | No run data: time saved is claimed, not shown | *the loop* | L |
| 9 | Accessibility is unverified beyond keyboard reachability | *anyone* | M |
| 10 | Windows, capture, transcription | *anyone, on their machine* | XL |

## Phase 0 — Anyone (2–3 weeks)

**Outcome:** a person with a TE account opens Atlas, is signed in by their system browser, sees
a workspace that already has two examples in it, and can create something in their first minute.

1. **Browser sign-in with a one-time code** (`M`). The app asks Atlas for a device code, opens the
   system browser at `…/device?code=…`, and polls; the web page (already signed in) approves it.
   The token minted that way is a normal `atlas_device_tokens` row, so revocation, roles and the
   audit are unchanged. No password ever enters the app, and the Keychain keeps the result.
2. **A demo workspace, seeded on first run** (`S`). Two guided examples — one process, one
   workflow — with real evidence metadata and a baseline, so the Analysis tab has something to say.
   Read-only until the person creates their own; a banner says what it is.
3. **Words** (`M`). A plain-language pass over the whole app and lane, EN and DE: *gate → sign-off*,
   *as-is → how it works today*, *to-be → how it should work*, *TEOA scope → improvement area*.
   The technical terms stay available behind a "show the formal terms" toggle, because auditors need them.
4. **Accessibility** (`M`). WCAG 2.2 AA on the lane (the tab order, focus rings, contrast, reduced
   motion, the dialog traps), VoiceOver names on the app's rail and tabs, and a Playwright axe pass
   on the lane's three screens.
5. **Empty and error states** (`S`). Every screen says what to do when it has nothing, and every
   failure says which thing failed and what to try.

**Exit criteria:** a new user, given only a URL, is signed in and has created a real project inside
five minutes without help; axe reports no serious issues on the lane; the demo workspace is clearly
labelled and deletable.

## Phase 1 — Idea to workflow in minutes (3–4 weeks)

**Outcome:** the five-minute script below works end to end, on macOS first, for a process with a
single repeatable step.

### The five-minute script

| Minute | What happens | What it needs |
|---|---|---|
| 0:00 | *What do you want to fix?* — one text box, plain words. Optionally: a Photo, a PDF, or a 60-second voice note. | nothing new |
| 0:30 | Atlas drafts **6–10 steps** from the text or the document, each with who does it and what it needs. The person edits them inline. | KG extraction behind a new Atlas call, or a local model when the document is restricted |
| 2:00 | *Which step do you want to stop doing by hand?* — one choice. | a step model |
| 2:30 | Atlas proposes a **workflow draft**: trigger, inputs, the step, the output, and who signs off. Every field is editable. | the workflow model (below) |
| 4:00 | *Test it with one real example* — the workflow runs once in **dry run**: it shows what it would read, decide and produce, and writes nothing. | a dry-run executor |
| 5:00 | The person saves it as a **draft workflow** at the *build* stage, with the quick lane recorded. | quick lane |

### What this phase adds

- **Capture without a capture engine first** (`M`): text, pasted documents and photos of a form go
  through the existing evidence path; on-device voice and screen capture stay Phase 3 work. A
  workflow draft must not wait for ScreenCaptureKit.
- **Step extraction** (`L`): a `process-steps/1` payload Atlas can produce and KG can produce. The
  `.maps-steps.json` shape already defines the step fields — reuse it rather than inventing another.
- **The workflow model** (`L`): a `workflow-draft/1` record Atlas owns (below).
- **The quick lane** (`M`): a documented, audited fast path (below).
- **A dry run** (`L`): the workflow executes against one example and writes nothing; the result is a
  report the person reads before anything is real.

### The quick lane — fast, not ungoverned

A project on the quick lane is created at **capture**, with its stages 0–2 recorded as passed by the
creator, and every skipped gate marked **deferred** with an owner and a due date. The chain records
`decision: pass, lane: quick, deferred: [as-is, aligned, value]`. The project's card says *quick lane ·
3 sign-offs deferred*, and the Analysis panel counts them as risks. Nothing is hidden, nothing is
claimed, and nothing blocks the first workflow.

**Exit criteria:** ten people with no training each take a one-paragraph idea to a tested workflow
draft in under ten minutes; every quick-lane project shows its deferred sign-offs and an owner.

## Phase 2 — The workflow layer, and Studio (4–6 weeks)

**Atlas owns the workflow's meaning; Studio owns the complex implementation.**

| `workflow-draft/1` field | Why it exists |
|---|---|
| `trigger` | when it runs (a new case, a form, a schedule, on demand) |
| `inputs[]` | what it reads, with a classification per input |
| `steps[]` | the ordered actions, each with an actor and a data source |
| `decisions[]` | the branch points a person must be able to see |
| `signOff` | who approves it before it runs for real |
| `complexity` | `simple` (Atlas can build it) or `studio` (hand off) |
| `testReport` | the dry run's result, kept with the draft |

1. **Simple workflows** (`L`): one trigger, one to three steps, no branch that needs a person
   mid-flight. Atlas compiles these into a **skill draft** in the OS skill shape
   (`skills/<id>/SKILL.md`), which Companion and Cowork already know how to pick up.
2. **Complex workflows** (`L`, blocked on Studio): Atlas stops at the spec — it emits
   `atlas-studio-spec/1` with the to-be map reference and the process manifest hash, shows the
   hand-off as *reserved*, and never claims a build. When Studio is available, the transport is one
   module: reserve → POST → observe, exactly as the outbox is designed.
3. **Run data back** (`L`): the Companion reports aggregate runs (count, minutes saved per run,
   failures) against the workflow, and Atlas shows *measured* value with the source named. This is
   what turns "estimate" into "measured" without anyone typing a number.
4. **Reuse across the portfolio** (`M`): the reuse check queries the workflow drafts too, so the
   second person with the same exception finds the first person's workflow before building.

**Exit criteria:** a simple workflow runs on one real case and returns a measured result; a complex
one reaches Studio as a spec with no false claim; the portfolio shows which workflows are reused.

## Phase 3 — Trust and reach (ongoing)

- Hosting and legal: where TE data may live, retention, cross-border (owner decisions 3 and 9).
- Capture: ScreenCaptureKit + on-device transcription + keyframes, per the Maps ground truth.
- Windows: Electron shell over the same web build, same contract fixtures.
- Telemetry and gate latency; a monthly read of the metrics below.

## Decisions I need from you

| # | Decision | Default if you say nothing |
|---|---|---|
| 1 | Sign-in: browser device-code approve, or TE Entra SSO directly? | device-code, because it needs no IdP work |
| 2 | May a non-admin create a quick-lane project without a workspace admin? | yes, inside a workspace they belong to, with the deferred-gate record |
| 3 | Is a "simple workflow" allowed to run unattended, or always with a person clicking? | always with a person, until run data exists |
| 4 | Who signs off a workflow before its first real run? | the process owner, and the workspace admin for the quick lane |
| 5 | Which of the ten stages may the quick lane skip? | capture's map and alignment's sign-offs; never the data classification |
| 6 | Studio: which repo owns the transport, and when? | Atlas owns the outbox, Studio owns the endpoint |
| 7 | May Atlas hold run data with a person's name in it? | no — aggregate counts only |
| 8 | Do the demo examples ship inside the app or the workspace? | the workspace, so they are deletable |

## Metrics we will read

| Metric | Why | Target |
|---|---|---|
| Time from first open to a created project | *anyone* | under 5 minutes, median |
| Time from idea to a tested workflow draft | *minutes* | under 10 minutes, median |
| Share of projects on the quick lane | is the fast path real? | > 50% after 30 days |
| Deferred sign-offs closed within 14 days | is the fast path honest? | > 90% |
| Reuse decisions before build | duplicates avoided | 100% recorded, > 30% reused |
| Measured value with a named source | the loop closing | 80% of live workflows at 90 days |

## Risks

- **The fast path erodes the audit.** Mitigated by deferred-gate records with owners and dates, and
  by the Analysis panel counting them as risks. If deferred sign-offs stay open, the lane is a lie.
- **"Anyone" without training produces bad processes.** Mitigated by the five-minute script, the
  demo workspace and the dry run.
- **Studio timing.** The workflow layer must be useful for simple cases even if Studio slips; that is
  why Phase 2 positions simple workflows as the default and complex as the exception.
- **Voice and screen capture are the hard part.** They are Phase 3 on purpose; the five-minute
  script does not depend on them.

## First two weeks, concretely

1. Device-code sign-in: the route pair, the browser page, the poll, the tests. (`M`)
2. Demo workspace seeding, read-only, labelled, deletable. (`S`)
3. Plain-language pass over the app's strings and the lane's EN/DE copy, with the formal-terms toggle. (`M`)
4. axe checks on the lane's three screens, and the fixes they find. (`S`)
5. `process-steps/1` and `workflow-draft/1` schemas, as contracts with fixtures, before any UI. (`M`)
6. The quick lane in the domain rules and the audit event, with the deferred-gate record. (`M`)

## Not in this plan

Drawing maps (DiagramForge), building complex apps (Studio), running work (Companion/OS),
statutory automation (never), and process mining from logs (Phase 3 or later).
