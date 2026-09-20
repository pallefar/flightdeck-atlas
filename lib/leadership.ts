import { kpiProgress, taskBlocked, progress, type Project } from "./projects";
import { loggedMinutes, scheduleConflicts } from "./work-management";
const clip = (s: string, n = 900) =>
  s.length > n ? s.slice(0, n - 35) + "… (open project for full evidence)" : s;
export type LeadershipRole = "CEO" | "VP" | "Director";
export type ReviewHorizon = "now" | "week" | "gate";
export function leadershipReview(
  p: Project,
  role: LeadershipRole,
  horizon: ReviewHorizon,
  today: string,
) {
  const open = p.tasks.filter((t) => !t.archived && !t.done),
    blocked = open.filter((t) => taskBlocked(t, p)),
    late = open.filter((t) => t.dueDate && t.dueDate < today);
  const unowned = open.filter((t) => !t.assignee && !t.assigneeEmail),
    undated = open.filter((t) => !t.dueDate),
    goals = p.objectives || [],
    kpis = p.kpis || [];
  const b = p.budget,
    money = (n: number) => `${b?.currency || ""} ${n.toLocaleString()}`;
  const budgetRisk =
    b?.approved != null &&
    ((b.forecast != null && b.forecast > b.approved) ||
      (b.actual != null && b.actual > b.approved));
  const gaps = [
    !p.benefit && "Measurable outcome",
    !p.sponsor && "Sponsor",
    !goals.length && "Strategy goal",
    !kpis.length && "KPI baseline and target",
    b?.approved == null && "Approved budget",
    b?.forecast == null && "Forecast cost",
    !p.dueDate && "Project target date",
  ].filter(Boolean) as string[];
  const evidence = [
    `Status: ${p.status}; ${progress(p)}% of tasks complete (${p.tasks.length} total).`,
    `Delivery: ${open.length} open, ${blocked.length} waiting or blocked, ${late.length} overdue.`,
    `Outcome: ${p.benefit || "not recorded"}.`,
    `Sponsor: ${p.sponsor || "not recorded"}.`,
    `Strategy: ${goals.map((g) => `${g.title} (${g.status})`).join("; ") || "no goals recorded"}.`,
    ...kpis.map(
      (k) =>
        `KPI ${k.name}: ${k.current} ${k.unit}; baseline ${k.baseline}, target ${k.target} (${kpiProgress(k)}% of the change achieved).`,
    ),
    `Budget: approved ${b?.approved == null ? "unknown" : money(b.approved)}, forecast ${b?.forecast == null ? "unknown" : money(b.forecast)}, actual ${b?.actual == null ? "unknown" : money(b.actual)}.`,
    `Effort: ${p.tasks.reduce((n, t) => n + loggedMinutes(t), 0)} minutes logged; ${open.reduce((n, t) => n + (t.estimateMinutes || 0), 0)} estimated minutes on open work.`,
  ];
  const horizonPrompt =
    horizon === "week"
      ? "What must be different by the next weekly review?"
      : horizon === "gate"
        ? "What evidence is needed to approve the next stage?"
        : "What decision deserves attention today?";
  const items: {
    id: string;
    question: string;
    evidence: string;
    action: string;
    priority: "High" | "Normal";
  }[] = [];
  const add = (
    id: string,
    question: string,
    e: string,
    action: string,
    urgent = false,
  ) =>
    items.push({
      id,
      question,
      evidence: clip(e),
      action,
      priority: urgent ? "High" : "Normal",
    });
  if (role === "CEO") {
    add(
      "value",
      "Is this still the right investment?",
      p.benefit
        ? `Recorded outcome: ${p.benefit}. ${goals.length} strategy goals linked.`
        : "No measurable outcome recorded; investment value is unproven.",
      "Validate the strategic outcome and success measure with the sponsor",
      !p.benefit,
    );
    add(
      "funding",
      "Would I continue, constrain or redirect funding?",
      evidence.find((x) => x.startsWith("Budget:"))!,
      budgetRisk
        ? "Review the cost overrun and agree scope or funding options"
        : b?.approved == null
          ? "Confirm the approved budget and cost forecast"
          : "Review forecast cost against the expected outcome",
      !!budgetRisk,
    );
    add(
      "sponsorship",
      "Who owns the result and the difficult trade-offs?",
      `Sponsor: ${p.sponsor || "unassigned"}. ${blocked.length} blocked tasks${p.blocker ? `; ${p.blocker}` : ""}.`,
      p.sponsor
        ? "Agree the escalation decision and accountable sponsor"
        : "Nominate the sponsor accountable for the business outcome",
      !p.sponsor || !!p.blocker,
    );
  } else if (role === "VP") {
    add(
      "capacity",
      "Do we have the people and capacity to deliver?",
      `${unowned.length} open tasks lack an owner; ${open.filter((t) => !t.estimateMinutes).length} lack effort estimates. This review covers this project only.`,
      unowned.length
        ? "Assign accountable owners to unowned delivery tasks"
        : "Check this project’s commitments against the Team capacity view",
      !!unowned.length,
    );
    add(
      "alignment",
      "Which targets and benefits need intervention?",
      kpis.length
        ? kpis
            .map((k) => `${k.name}: ${kpiProgress(k)}% of target change`)
            .join("; ")
        : "No KPI measurements recorded. Progress cannot establish business impact.",
      kpis.length
        ? "Review KPI movement with functional owners and agree corrective actions"
        : "Agree KPI baselines and targets with functional owners",
      !kpis.length,
    );
    add(
      "handoffs",
      "Which handoffs should I escalate?",
      `${blocked.length} tasks waiting or blocked; ${scheduleConflicts(p).length} dependency schedule conflicts. ${p.blocker || ""}`,
      "Resolve the most important dependency and agree an escalation owner",
      !!blocked.length || !!p.blocker,
    );
  } else {
    add(
      "delivery",
      "What is most likely to miss the commitment?",
      late.length
        ? `Overdue: ${late
            .slice(0, 4)
            .map((t) => `${t.title} (${t.dueDate})`)
            .join("; ")}.`
        : `${undated.length} open tasks have no due date; project target ${p.dueDate || "not set"}.`,
      late.length
        ? "Agree a recovery plan for overdue tasks with their owners"
        : "Validate task dates against the project commitment",
      !!late.length,
    );
    add(
      "unblock",
      "What must I unblock before the team starts?",
      blocked.length
        ? blocked
            .slice(0, 4)
            .map(
              (t) =>
                `${t.title}: ${
                  (t.dependsOn || [])
                    .map((id) => p.tasks.find((x) => x.id === id)?.title)
                    .filter(Boolean)
                    .join(", ") || "manually blocked"
                }`,
            )
            .join("; ")
        : p.blocker || "No blocker is recorded. Confirm this with the team.",
      blocked.length || p.blocker
        ? "Resolve the first blocked handoff and record the next action"
        : "Confirm the next deliverable and its definition of done",
      !!blocked.length || !!p.blocker,
    );
    add(
      "ownership",
      "Does every next action have an owner and a finish line?",
      `${unowned.length} unowned and ${undated.length} undated open tasks.`,
      unowned.length
        ? "Assign owners and dates to the next delivery actions"
        : "Review acceptance criteria with the delivery owners",
      !!unowned.length,
    );
  }
  if (horizon === "week") {
    const end = new Date(`${today}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 7);
    const through = end.toISOString().slice(0, 10),
      upcoming = open.filter(
        (t) => t.dueDate && t.dueDate >= today && t.dueDate <= through,
      );
    add(
      "weekly",
      "What will we commit to before the next review?",
      `${upcoming.length} open tasks due through ${through}: ${
        upcoming
          .slice(0, 4)
          .map((t) => `${t.title} (${t.dueDate})`)
          .join("; ") || "none dated"
      }.`,
      "Agree the next seven days’ commitments and the evidence for review",
      upcoming.some((t) => taskBlocked(t, p)),
    );
  }
  if (p.status === "Completed")
    add(
      "closure",
      "Did the project deliver the intended benefit?",
      `${open.length} tasks remain open; ${kpis.length} KPI measurements recorded.`,
      "Verify realized benefits and capture the project lessons",
      !!open.length,
    );
  if (p.status === "On hold")
    add(
      "restart",
      "What would justify restarting this project?",
      `Project is on hold. ${p.blocker || "No restart condition recorded."}`,
      "Document the restart criteria and next review date",
      true,
    );
  if (horizon === "gate")
    add(
      "gate",
      "What is the go / no-go evidence?",
      `${p.tasks.filter((t) => t.milestone && !t.archived && !t.done).length} milestones still open; ${gaps.length} key inputs missing.`,
      "Prepare the stage-gate evidence and name the decision owner",
      gaps.length > 0,
    );
  const posture = p.archived
    ? "Archived project · retrospective"
    : p.status === "Completed"
      ? "Validate outcomes"
      : p.status === "On hold"
        ? "Agree restart conditions"
        : late.length || blocked.length || p.blocker || budgetRisk
          ? "Intervention to consider"
          : gaps.length
            ? "Fill the evidence gaps"
            : "Validate the next commitment";
  const text = [
    `# Think like a ${role}: ${p.name}`,
    `As of ${today} · source revision ${p.revision} · ${horizonPrompt}`,
    `Decision posture: ${posture}`,
    "Evidence-based prompts, not a prediction of any individual’s thoughts. FlightDeck AI is not connected.",
    "",
    ...items.flatMap((i) => [
      `## ${i.question}`,
      i.evidence,
      `Suggested action: ${i.action}`,
    ]),
    "",
    "## Evidence gaps",
    gaps.join("; ") ||
      "Core fields recorded; accuracy and freshness still need human review.",
    "",
    "## Source evidence",
    ...evidence.map((e) => `- ${e}`),
  ].join("\n");
  return {
    items,
    evidence,
    gaps,
    posture,
    horizonPrompt,
    text: clip(text, 11800),
  };
}
