export const functions = [
  "Operations / TEOA",
  "Engineering",
  "Quality",
  "Supply Chain",
  "HR",
];
export type Opportunity = {
  id: string;
  area: string;
  title: string;
  problem: string;
  pilot: string;
  measure: string;
  discovery: string;
  effort: string;
};
export const opportunities: Opportunity[] = [
  {
    id: "teoa-actions",
    area: "Operations / TEOA",
    title: "Turn tier meetings into closed actions",
    problem:
      "Decisions and escalations can get separated from the improvement work they trigger.",
    pilot:
      "Pilot a meeting-to-action workflow for one value stream, with a human confirming every owner and due date.",
    measure:
      "Baseline action closure time, overdue count, and meeting preparation time; agree a target after two weeks.",
    discovery:
      "Meet the TEOA lead and choose one value stream with recurring tier meetings.",
    effort: "2-week discovery + pilot",
  },
  {
    id: "quality-evidence",
    area: "Quality",
    title: "Make evidence easier to find",
    problem:
      "Teams spend time locating the right procedure, test record, or past corrective action.",
    pilot:
      "Trial a cited search assistant over an approved, versioned document set. Keep quality decisions with the accountable reviewer.",
    measure:
      "Compare time to locate evidence and reviewer acceptance against the current process.",
    discovery:
      "Ask a Quality owner for ten common evidence questions and an approved source set.",
    effort: "Small document pilot",
  },
  {
    id: "engineering-knowledge",
    area: "Engineering",
    title: "Recover knowledge from past projects",
    problem:
      "Design decisions and lessons learned are hard to reuse across teams.",
    pilot:
      "Create a searchable decision log for one engineering team, linking each answer to the originating project and document.",
    measure:
      "Track time to answer repeat questions, citation accuracy, and reused lessons.",
    discovery:
      "Choose one recurring engineering question and identify the authoritative project records.",
    effort: "One-team pilot",
  },
  {
    id: "supply-exceptions",
    area: "Supply Chain",
    title: "Make exception follow-up visible",
    problem:
      "Supply exceptions can move between spreadsheets, meetings, and inboxes without a clear next owner.",
    pilot:
      "Build a shared exception queue with next actions, due dates, and escalation rules for one planning group.",
    measure:
      "Measure exception age, owner coverage, and time spent preparing follow-ups.",
    discovery:
      "Meet a planner and map one exception from detection to closure.",
    effort: "One-process pilot",
  },
  {
    id: "hr-onboarding",
    area: "HR",
    title: "Guide functional onboarding",
    problem:
      "New users need a clear path through tools, responsibilities, and approved ways of working.",
    pilot:
      "Create a role-based onboarding checklist with links to approved guidance and a named human support owner.",
    measure:
      "Measure completion time, unresolved questions, and first successful workflow completion.",
    discovery: "Agree one onboarding cohort with HR and the function lead.",
    effort: "One-cohort pilot",
  },
  {
    id: "teoa-scorecards",
    area: "Operations / TEOA",
    title: "Connect scorecards to improvement work",
    problem:
      "A performance gap is visible in a scorecard but may not lead to a tracked improvement cycle.",
    pilot:
      "Link one approved KPI gap to its objective, cycle, owner, and next tollgate in TEOA Advantage.",
    measure:
      "Track the share of reviewed gaps with an owner and current action; preserve missing and exempt measurements.",
    discovery:
      "Review one value stream scorecard with its owner and confirm the KPI definition and fiscal period.",
    effort: "One-scorecard pilot",
  },
];
export function onboardingTasks(idea: Opportunity) {
  return [
    idea.discovery,
    "Confirm the sponsor, process owner, and current baseline",
    "Agree a measurable pilot outcome and review date",
    "Map approved data sources and minimum access",
    "Register the function and project in FlightDeck when the SDK is ready",
    "Run the pilot with human review and record results",
    "Train users, name the support owner, and decide whether to scale",
  ].map((title) => ({
    id: crypto.randomUUID(),
    title,
    done: false,
    priority: "Normal" as const,
  }));
}
