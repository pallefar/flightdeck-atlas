/**
 * The sign-offs the quick lane owes, for the person who has to collect them.
 *
 * A due date that nobody reads is not a control, so the queue is ordered by
 * lateness and says who owes what, on which project, by when. It is derived
 * from the brain rows — nothing is stored twice.
 */
export type DeferredRequest = {
  projectId: string;
  projectName: string;
  stage: string;
  owner: string;
  dueAt: string;
  overdue: boolean;
  daysLate: number;
};

export function deferredQueue(
  projects: { projectId: string; name: string; deferred: unknown }[],
  now: Date,
): DeferredRequest[] {
  const requests: DeferredRequest[] = [];
  for (const project of projects) {
    const gates = Array.isArray(project.deferred) ? project.deferred : [];
    for (const gate of gates) {
      const item = gate as { stage?: unknown; owner?: unknown; dueAt?: unknown };
      if (typeof item.stage !== "string" || typeof item.dueAt !== "string") continue;
      const due = Date.parse(item.dueAt);
      if (Number.isNaN(due)) continue;
      const lateMs = now.getTime() - due;
      requests.push({
        projectId: project.projectId,
        projectName: project.name,
        stage: item.stage,
        owner: typeof item.owner === "string" ? item.owner : "",
        dueAt: item.dueAt,
        overdue: lateMs > 0,
        daysLate: lateMs > 0 ? Math.floor(lateMs / 86_400_000) : 0,
      });
    }
  }
  // Late first, then the one that is due soonest: the order someone would work.
  return requests.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return Date.parse(a.dueAt) - Date.parse(b.dueAt);
  });
}
