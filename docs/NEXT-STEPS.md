# What to build next

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
