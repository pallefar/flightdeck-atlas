# Atlas work management gauntlet — 20 September 2026

The reference is monday.com's published project-management workflow and product documentation, including actual workflow screenshots. This is a selected workflow comparison, not a claim of full product parity or a blind visual win against an authenticated monday workspace. Source ownership, Atlas permissions and its TE design are preserved.

| Workflow | Atlas coverage after this pass | Remaining difference |
| --- | --- | --- |
| Boards and groups | Portfolio cards/list/status board; task list/board/table; named task groups | No arbitrary custom column/formula builder or nested subitems |
| Saved filters | Shared named project views: text, group, owner, workflow, priority, open/overdue/mine, sorting, layout | No arbitrary nested Boolean filter expressions |
| Batch changes | Select visible task rows; change priority, workflow, member, due/planned date or group; revision and dependency validation | No bulk cross-project move or bulk archive |
| Scheduling | Start/finish timeline, 14/30/90-day windows, milestones, dependency names, blocking and schedule-conflict warnings; undated/invalid legacy rows remain discoverable | No dependency arrow graph, drag rescheduling, critical path, baselines, cross-project dependencies or FS/SS/FF/SF response modes |
| Time and costs | Attributed dated manual time sessions with explicit correction, actual/estimated effort, approved/forecast/actual cost and currency | No per-task stopwatch, billable rates, expense ledger or accounting integration |
| Automation | Opt-in final-prerequisite-completed → Doing; newly manually blocked → High priority; server applies on save and records outcomes. Existing recurrence and assignment notifications retained | No scheduled reminders, general condition builder, external actions, event jobs or integrations |
| Playbooks | Delivery, continuous improvement and launch starter tasks with phases/dependencies/milestone; explicit preview and insertion | No managed cross-project template propagation |
| Collaboration | Existing private sharing, teams, comments, mentions, meeting actions, decisions, review approvals, attachments and revision checks | No live coediting, external guest intake or threaded realtime chat |
| Intake | Existing quick capture, project creation, consultancy pilots and OS onboarding drafts | No standalone WorkForms-equivalent request inbox/approval-to-project workflow |
| Workload | Existing seven-day member capacity, leave, estimates and overload signals | No long-range drag-to-reassign resource optimizer |
| Reporting | Existing briefings, goals/KPIs, benefits and editable PowerPoint; new budget/time views and leadership briefs | No arbitrary dashboard widget/formula designer |
| AI / connected sources | Evidence-based advisor and role reviews work now | Live AI, OS strategy/KPIs, TEOA, shared Supabase sign-in and Outlook require the agreed FlightDeck services |

## Atlas-specific additions

- Think like a CEO, VP or Director: explicit evidence, missing-input disclosure, decision posture and role-specific questions. Current, weekly and stage-gate contexts. Never claims to know an individual's thoughts or to have consulted an AI provider.
- Convert a reviewed recommendation into a normal editable task. The same role/recommendation cannot be added twice while its task exists. Save dated source-revision snapshots and export decision briefs. History is bounded by both count and available project space; oldest reviews roll off with a disclosed retention rule.
- Eat the Frog: deliberate selection of one accessible, active, unblocked task per user per local day; a first step, start time and 5–90-minute focus block. Saved in private account preferences. Starting focus uses the existing real timer without replacing an active/paused timer. Completion updates the actual task through normal project authorization.
- Project Eye replaces the old map name in all UI labels and tests. Provider/reference attribution retains the original upstream project name.

## Quality bar and critique

Acceptance uses actual persisted workflows: save/reload compound views; bulk changes leave unselected tasks unchanged; a dependent task's readiness updates once; explicit date ranges and milestones render; bad dates and stale revisions fail safely; time corrections retain identity; differing leadership roles cite actual inputs and create reviewable actions; private daily plans survive reload and reserve time without double counting; mobile content stays within the dialog.

Independent criticism caught time-correction loss, stale task/budget drafts, invalid-date timeline failures and oversized leadership history. These were corrected before publication. All 38 automated scenarios passed, with the new mobile workflow checked again after accessibility refinements. Independent functional review passed. Visual review led to improved action contrast in both themes and a wider mobile timeline date area. Results are recorded in build progress. No inaccessible authenticated monday experience was invented as evidence.

## Official reference material

- [Project-management workflow](https://support.monday.com/hc/en-us/articles/360014437599-Project-management-with-monday-com)
- [Project boards](https://support.monday.com/hc/en-us/articles/22598441769746-Project-boards-on-monday-com)
- [Saved board filters](https://support.monday.com/hc/en-us/articles/360003624660-The-Board-Filters)
- [Batch actions](https://support.monday.com/hc/en-us/articles/115005335049-Batch-Actions)
- [Gantt chart](https://support.monday.com/hc/en-us/articles/360015643840-The-Gantt-Chart-View-and-Widget)
- [Automations](https://support.monday.com/hc/en-us/articles/360001222900-Get-started-with-monday-automations)
- [Time tracking](https://support.monday.com/hc/en-us/articles/360001143809-The-Time-Tracking-Column)
- [WorkForms intake](https://support.monday.com/hc/en-us/articles/360000358700-Get-started-with-WorkForms)
- [Workload](https://support.monday.com/hc/en-us/articles/360010699760-The-Workload-Widget)
