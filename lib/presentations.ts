import { z } from "zod";
import { progress, type Project } from "./projects";
export const deckSchema = z.object({
  title: z.string().trim().min(1).max(120),
  audience: z.string().max(100),
  period: z.string().max(100),
  template: z.enum([
    "Leadership update",
    "Project steering",
    "Strategy & KPIs",
    "TEOA improvement",
    "Consultancy proposal",
  ]),
  shared: z.boolean().default(false),
  projectIds: z.array(z.string().max(80)).min(1).max(30),
  snapshots: z
    .array(
      z.object({
        id: z.string().max(80),
        name: z.string().max(100),
        revision: z.number().int(),
        at: z.string().max(80),
      }),
    )
    .max(30),
  slides: z
    .array(
      z.object({
        id: z.string().max(80),
        title: z.string().max(160),
        body: z.string().max(5000),
        notes: z.string().max(2000),
      }),
    )
    .min(1)
    .max(60),
});
export type Deck = z.infer<typeof deckSchema> & {
  id: string;
  revision: number;
  updatedAt: string;
  canEdit?: boolean;
};
export const templates = [
  "Leadership update",
  "Project steering",
  "Strategy & KPIs",
  "TEOA improvement",
  "Consultancy proposal",
] as const;
export function createDeck(
  projects: Project[],
  template: Deck["template"],
  audience: string,
  period: string,
): z.infer<typeof deckSchema> {
  const slide = (title: string, body: string, notes = "") => ({
    id: crypto.randomUUID(),
    title,
    body,
    notes,
  });
  const slides = [
    slide(
      template,
      `${audience || "Project team"}\n${period || "Current saved state"}\n${projects.length} selected projects`,
      "Review the audience and data before sharing.",
    ),
  ];
  slides.push(
    slide(
      "Portfolio at a glance",
      projects
        .map(
          (p) =>
            `${p.name} · ${p.status} · ${p.tasks.length ? `${progress(p)}% tasks complete` : "Progress not tracked"}`,
        )
        .join("\n"),
    ),
  );
  for (const p of projects) {
    slides.push(
      slide(
        p.name,
        `${p.description || "Outcome to be confirmed"}\n\nStatus: ${p.status}\nNext action: ${p.nextAction || "To agree"}\nTarget: ${p.dueDate || "Not set"}`,
        `Source: Atlas project ${p.id}; revision ${p.revision}; saved ${p.updatedAt}.`,
      ),
    );
    if (template === "Strategy & KPIs" || template === "TEOA improvement")
      slides.push(
        slide(
          `${p.name}: measures`,
          p.kpis?.length
            ? p.kpis
                .map(
                  (k) =>
                    `${k.name}: ${k.current} ${k.unit} · target ${k.target} · baseline ${k.baseline}`,
                )
                .join("\n")
            : "No measurements recorded. Add manual KPIs or connect an authorised source.",
          template === "TEOA improvement"
            ? "TEOA Advantage is not connected. Any figures shown are manually recorded Atlas KPIs."
            : "Atlas manual measurements; verify units and reporting period.",
        ),
      );
    if (template === "Consultancy proposal")
      slides.push(
        slide(
          `${p.name}: proposed value`,
          `${p.benefit || "Agree a measurable benefit and baseline."}\n\nSponsor: ${p.sponsor || "To confirm"}\nFunction: ${p.functionArea || p.category}\nPilot scope and investment: to agree`,
        ),
      );
    slides.push(
      slide(
        `${p.name}: actions & decisions`,
        `${p.blocker ? `Watch-out: ${p.blocker}\n\n` : ""}${
          p.tasks
            .filter((t) => !t.done)
            .slice(0, 8)
            .map(
              (t) =>
                `• ${t.title}${t.assignee ? ` — ${t.assignee}` : ""}${t.dueDate ? ` · ${t.dueDate}` : ""}`,
            )
            .join("\n") || "No open tasks recorded."
        }`,
      ),
    );
  }
  slides.push(
    slide(
      "Decisions & next steps",
      "Record the decisions required, accountable owners and agreed follow-up dates before presenting.",
    ),
  );
  return {
    title: template,
    audience,
    period,
    template,
    shared: false,
    projectIds: projects.map((p) => p.id),
    snapshots: projects.map((p) => ({
      id: p.id,
      name: p.name,
      revision: p.revision,
      at: p.updatedAt,
    })),
    slides: slides.slice(0, 60),
  };
}
