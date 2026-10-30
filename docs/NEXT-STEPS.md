# What to build next

**Every batch follows [the loop rules](LOOP-RULES.md):** walk the web version first, move at least
one OS/suite integration, never invent a URL, verify both surfaces, stop after five.



Written after implementing the first slices of [the plan](PLAN-NEXT-LEVEL.md):
the two workflow contracts and the quick lane.

## Done in this slice

- `atlas-process-steps/1` and `atlas-workflow-draft/1`: TS contract, JSON Schema,
  fixture with a sha256, generated Swift models, and refusals that matter — a test
  run may not have written anything, and a three-step workflow may not claim Studio.
- The **quick lane** end to end on the web: create starts at capture, records three
  opening passes and the deferred sign-offs (`as-is`, `aligned`, `value`) in the hash
  chain with an owner and a 14-day date; passing a deferred gate pays that sign-off
  off and writes the remaining debt into the event. Analysis counts the debt as a
  risk (never as a score), cards show `quick · 3 deferred`, and the wizard offers
  the fast start.

## The loop, batch 1 (five improvements per batch)

1. ~~The wizard shows what the quick lane defers, in the review step, on both surfaces~~ — done, with a browser test.
2. ~~An overdue deferred sign-off is a risk of its own (`deferred_overdue`), not only a debt~~ — done, with a domain test that also proves the score does not move.
3. ~~Browser device-code sign-in~~ — done: a code, an approve page, one-time collection, and a
   **Sign in with the browser** button in Settings. The app no longer needs a typed token.
4. ~~`workflow-draft/1` gets a home~~ — done: `PUT /api/onboarding/:id/workflow`, stored in the
   brain only when it matches the contract, and a Workflow section in the lane that shows the
   trigger, the step count, who builds it and whether its test run wrote anything.
5. ~~`process-steps/1` gets a producer route~~ — done: `PUT /api/onboarding/:id/steps`, one
   contract for KG extraction and for a person typing the steps.

## Batch 3 (in progress: 3 of 5)

Done: the editor's browser test (it caught `open()` wiping the notice), the suite registry and
`GET /api/suite`, and the Suite section in the lane plus Studio and Vision in the app.

Next, in order:

1. **Attest a test run in the app.** Attempted and reverted: `[String: Any]` is not `Sendable`, so
   Swift 6 refuses to hand it to the client's detached call. The fix is an `Encodable` body type in
   `AtlasDomain` (`WorkflowAttestation`), not a `@unchecked` escape.
2. **Build a workflow in the app**, not only read it — the same body type serves both.
3. The deferred-signoff digest, or measured value arriving from workflow runs.

## Batch 2 (five improvements)

1. ~~A workflow editor in the lane~~ — name, trigger and steps, saved as a contract body.
2. ~~A dry-run attestation~~ — "I tested it, nothing was written" records the test report; Atlas never invents one.
3. ~~An overdue banner~~ — a deferred sign-off past its date shouts at the top of the project.
4. ~~The app's readiness card lists the debt~~ — "Quick lane: N sign-off(s) deferred", red when late.
5. ~~The app gains a Workflow tab~~ — name, trigger, steps, who builds it, and the test run.

Still open: the editor and attestation are **not covered by a browser test**, and the app's tab is
read-only — a draft is built in the lane, not in the app.

## Not yet done (in order)

1. **The app's wizard and cards do not offer the quick lane yet.** The API accepts
   it and the web uses it; the Swift client still always sends `governed`. One
   toggle, one badge, one test. `S`
2. **The wizard's quick hint has no consequence shown before creating.** Show what
   will be deferred, with the due date and the owner, in the review step. `S`
3. **The workflow has a home but no editor.** A route stores a draft and the lane shows
   it; nobody can yet build one in the app, and the **app** has no workflow tab. `L`
4. **Device-code sign-in.** Still the biggest block on "anyone can use it": the app
   needs a token minted by a Super Admin. Routes + browser approve page + app poll,
   then the app has a Sign in button instead of a token field. `M`
5. **Deferred debt needs a deadline that bites.** Today a due date is written and
   never read. Add a weekly digest to the workspace admin and a red badge past due. `S`
6. **`process-steps/1` needs a producer.** The contract is ready; nothing extracts
   steps from a document yet. A KG call, or the local model for restricted
   documents, behind an Atlas endpoint. `L`

## The order I would take

1 → 2 (a day), then 4 (sign-in, the promise blocker), then 3 (workflow draft with a
home), then 6 (extraction), then 5 (the deadline) — because until 3 exists, the
workflow cannot be tested by anyone but the person who wrote it.
