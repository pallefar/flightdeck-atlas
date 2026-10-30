# The onboarding journey — what it is, and what the UX pass changed

Written after walking both surfaces end to end (2026-10-30). The intent is to
name the journey once, so a change can be judged against it rather than against
a screen.

## The journey

| Step | Web (`?view=brain`) | macOS app |
|---|---|---|
| 1. Front door | **Start the wizard** on the lane | Overview, or the wizard by itself on a first run |
| 2. What | two illustrated cards: a project / a process | same two cards, drawn in SwiftUI |
| 3. Where | workspace (radio) and owner | workspace picker and owner |
| 4. Details | name and problem | name and problem |
| 5. Review | every choice, then create | same |
| 6. The brain opens | board card + project panel | sheet |
| 7. Readiness | **Analysis**: checklist score, counts, risks, next actions | same |
| 8. Do the work | intake → reuse → evidence → value → roles → gate → timeline | same order |
| 9. Go wider | **Open in Atlas** (`?view=brain&project=<id>`) | same link |

## What the audit found, and what changed

| Finding | Change |
|---|---|
| The web lane had no readiness view at all — the app did | `lib/domain/analysis.ts` + `app/brain-analysis.tsx`: same checklist score, counts, risks and next actions, translated (EN/DE) and with an anchor per action |
| The web panel's sections were in an arbitrary order (roles before requirements, gate before intake) | reordered to the journey: requirements → analysis → intake → reuse → evidence → value → roles → gate → timeline |
| Two ways to start, unexplained ("Onboard a new project or process" and "Start an intake") | the second is now **Start an intake on an existing project**, with a line saying a new project or process goes through the wizard |
| "This stage's requirements are met" sat next to a readiness score that said 2 of 8 | a line under the requirement list says what it is: what *this gate* needs, versus the broader checklist |
| The app's next actions were prose bullets | they are buttons that scroll to the section that does them (`ScrollViewReader` + `.id` per section) |
| An app error or notice stayed on screen until the next action | the banner has a dismiss button |
| A next-action anchor could silently point at nothing | `tests/swift-models.spec.ts` fails when an `AnalysisAnchor` has no matching `.id`; the web test clicks an action and asserts the section is marked |

## Still open (not changed here)

- The wizard cannot be reopened with a project prefilled; it is only for new ones.
- Board cards show stage and revision, not readiness — a dot per card would need
  the list API to carry the facts (it carries only name/stage/revision).
- Feedback is reachable from the Overview header and a project's brain, not from
  the wizard.
- The in-app keyboard map (⌘N for the wizard) is not shown anywhere in the UI.
- German copy is still marked `needs native review`.
