export const workTools = [
  {
    id: "overview",
    title: "Project overview",
    group: "Project",
    help: "See this project’s outcome, progress, sponsor and next action. Use the project menus for tasks, planning, leadership and work tools. Back to all projects returns to your portfolio.",
  },
  {
    id: "collaboration",
    title: "Collaborate & share",
    group: "Project",
    help: "Manage discussions, files and access for this project. Atlas access must first be granted by the Super Admin; a project link alone does not grant access.",
  },
  {
    id: "updates",
    title: "Project updates",
    group: "Project",
    help: "Record decisions, progress and results for this project. Its activity history also records saved changes.",
  },
  {
    id: "slides",
    title: "Project presentations",
    group: "Project",
    help: "Create, edit and export a presentation using this project’s data. Review the slides before sharing them.",
  },
  {
    id: "projects",
    title: "All projects",
    group: "Project management",
    help: "Browse your portfolio and open a project. Use the project selector to keep the same project while moving between task views, planning and leadership reviews.",
  },
  {
    id: "kanban",
    title: "Kanban board",
    group: "Project management",
    help: "Move this project’s tasks through To do, Doing, Blocked and Done. Drag a card into a column or use its status menu on a keyboard or phone. Changes save immediately; dependencies and permissions still apply. The portfolio has a separate board for project statuses.",
  },
  {
    id: "list",
    title: "Tasks & subtasks",
    group: "Project management",
    help: "Capture work, assign owners and due dates, add nested subtasks and checklists. Open a task to edit dependencies, time entries and custom fields.",
  },
  {
    id: "table",
    title: "Task table",
    group: "Project management",
    help: "Compare work in rows, select tasks for bulk edits, and refine or save a filtered view. Saved views belong to the selected project.",
  },
  {
    id: "timeline",
    title: "Timeline",
    group: "Project management",
    help: "See tasks against their dates. Drag a scheduled task to propose a move, then review and apply it. Use Scheduling for dependency links, baselines and critical path.",
  },
  {
    id: "schedule",
    title: "Scheduling",
    group: "Project management",
    help: "Connect dependent tasks, inspect the critical path and capture a baseline. Review proposed date changes before applying them. Cross-project links require access to the linked projects.",
  },
  {
    id: "strategy",
    title: "Strategy & KPIs",
    group: "Project management",
    help: "Define goals and measurable outcomes for this project. FlightDeck OS strategy and KPI data will be available when the OS integration is connected.",
  },
  {
    id: "delivery",
    title: "Delivery & budget",
    group: "Project management",
    help: "Review estimated and recorded effort, approved budget, actual spend and forecast cost. Keep budget assumptions current so leadership reviews can identify financial exposure.",
  },
  {
    id: "CEO",
    title: "Think like a CEO",
    group: "Leadership",
    help: "Review value, strategic direction, sponsorship and exposure. Choose Right now, This week or the next gate, then turn a reviewed recommendation into a project task. These reviews use project evidence and rules; live FlightDeck AI is pending.",
  },
  {
    id: "VP",
    title: "Think like a VP",
    group: "Leadership",
    help: "Review alignment, capacity, dependencies and measurable outcomes for the selected project. Save a review snapshot or add a reviewed action. This does not infer the actual thoughts of your VP or review inaccessible projects.",
  },
  {
    id: "Director",
    title: "Think like a Director",
    group: "Leadership",
    help: "Review delivery, ownership, overdue work and next decisions. Recommendations cite project evidence. Edit the suggested action and owner before adding it to the task list.",
  },
  {
    id: "fields",
    title: "Custom fields",
    group: "Work tools",
    help: "Add text, number, date, choice, checkbox or formula fields to tasks. Define fields here, then fill them in the task editor. Formula fields calculate from your project’s task data.",
  },
  {
    id: "rules",
    title: "Automations",
    group: "Work tools",
    help: "Create rules that react to saved project changes, check conditions and apply actions. Inbox reminders appear when due. Scheduled background jobs, email and external actions are not connected yet.",
  },
  {
    id: "time",
    title: "Time & costs",
    group: "Work tools",
    help: "Start a persistent task timer, log or correct time and track expenses. Review task rates before using labor values. Export the records for your reporting workflow.",
  },
  {
    id: "requests",
    title: "Request intake",
    group: "Work tools",
    help: "Create a form, choose a reviewer and collect requests from authorized users. Review and approve a submission into a task or private project. A link alone does not grant workspace access.",
  },
  {
    id: "notes",
    title: "Live notes",
    group: "Work tools",
    help: "Write shared project notes in blocks. Changes refresh automatically and conflicts are checked when saving. Sharing still follows the project’s access permissions.",
  },
  {
    id: "resources",
    title: "Resource planner",
    group: "Work tools",
    help: "Inspect this project’s assignments and capacity. Drag work to propose an owner or date change, then review and confirm it. Team workspace provides planning across projects.",
  },
  {
    id: "reports",
    title: "Report builder",
    group: "Work tools",
    help: "Build project widgets using task metrics and custom fields. Choose a calculation and filters. Saved widgets also appear on the portfolio dashboard.",
  },
  {
    id: "templates",
    title: "Playbooks",
    group: "Work tools",
    help: "Save a repeatable work structure as a versioned playbook and apply it to another project. Review propagation before updating existing projects; their progress and ownership are preserved.",
  },
] as const;
export type WorkTool = (typeof workTools)[number]["id"];
export type View =
  | "apps"
  | "team"
  | "presentations"
  | "today"
  | "dashboard"
  | "globe"
  | "connection"
  | "briefing"
  | "ideas"
  | "access"
  | "wellbeing"
  | "manage"
  | "help";
export const validViews: View[] = [
  "apps",
  "team",
  "presentations",
  "today",
  "dashboard",
  "globe",
  "connection",
  "briefing",
  "ideas",
  "access",
  "wellbeing",
  "manage",
  "help",
];
export function workTool(value: string | null): WorkTool {
  return workTools.find((t) => t.id === value)?.id || "projects";
}
