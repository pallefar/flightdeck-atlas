import { z } from "zod";
export const taskSchema = z.object({
  id: z.string().max(80),
  title: z.string().trim().min(1).max(200),
  done: z.boolean(),
  dueDate: z
    .string()
    .regex(/^$|^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  priority: z.enum(["High", "Normal", "Low"]).optional(),
  assignee: z.string().max(100).optional(),
  completedAt: z.string().nullable().optional(),
});
export const projectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1500).default(""),
    status: z.enum(["In progress", "Planning", "On hold", "Completed"]),
    category: z.string().trim().min(1).max(60),
    location: z.string().max(100),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    dueDate: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/),
    color: z.enum(["orange", "blue", "green", "violet"]),
    tasks: z.array(taskSchema).max(200),
    functionArea: z.string().max(80).optional(),
    priority: z.enum(["High", "Normal", "Low"]).optional(),
    sponsor: z.string().max(100).optional(),
    nextAction: z.string().max(300).optional(),
    blocker: z.string().max(500).optional(),
    benefit: z.string().max(500).optional(),
    archived: z.boolean().optional(),
    onboardingStage: z
      .enum(["Discovery", "Pilot", "Ready for FlightDeck", "Rolled out"])
      .optional(),
  })
  .refine(
    (p) => (p.latitude === null) === (p.longitude === null),
    "Provide both coordinates or neither",
  );
export type ProjectFields = z.infer<typeof projectSchema>;
export type ProjectEvent = {
  id: string;
  at: string;
  kind:
    | "created"
    | "project"
    | "task-completed"
    | "task-reopened"
    | "task-added"
    | "task-removed"
    | "note";
  text: string;
  taskId?: string;
};
export type Project = ProjectFields & {
  activity?: ProjectEvent[];
  canEdit?: boolean;
  canArchive?: boolean;
  ownedByMe?: boolean;
  id: string;
  source: "atlas" | "flightdeck";
  updatedAt: string;
  revision: number;
};
export const progress = (p: Project) =>
  p.tasks.length
    ? Math.round((p.tasks.filter((t) => t.done).length / p.tasks.length) * 100)
    : p.status === "Completed"
      ? 100
      : 0;
export const examples: Project[] = [
  {
    id: "demo-1",
    name: "FlightDeck OS",
    description: "One workspace for the projects, people, and ideas in motion.",
    status: "In progress",
    category: "Platform",
    location: "Copenhagen, Denmark",
    latitude: 55.6761,
    longitude: 12.5683,
    dueDate: "2026-10-15",
    color: "orange",
    tasks: [
      { id: "a", title: "Define the sub-app experience", done: true },
      { id: "b", title: "Connect the project API", done: false },
      { id: "c", title: "Review shared sign-in", done: false },
    ],
    source: "atlas",
    updatedAt: "2026-09-17",
    revision: 1,
  },
  {
    id: "demo-2",
    name: "Northstar Studio",
    description:
      "A new home for a creative practice with a global perspective.",
    status: "In progress",
    category: "Design",
    location: "New York, United States",
    latitude: 40.7128,
    longitude: -74.006,
    dueDate: "2026-10-02",
    color: "blue",
    tasks: [
      { id: "a", title: "Map the customer journey", done: true },
      { id: "b", title: "Build the visual identity", done: true },
      { id: "c", title: "Review the first prototype", done: false },
      { id: "d", title: "Publish the studio site", done: false },
    ],
    source: "atlas",
    updatedAt: "2026-09-16",
    revision: 1,
  },
  {
    id: "demo-3",
    name: "Kyoto Field Notes",
    description:
      "An independent journal documenting places and the people who shape them.",
    status: "Planning",
    category: "Editorial",
    location: "Kyoto, Japan",
    latitude: 35.0116,
    longitude: 135.7681,
    dueDate: "2026-11-01",
    color: "green",
    tasks: [
      { id: "a", title: "Choose the first three stories", done: false },
      { id: "b", title: "Plan the field research", done: false },
    ],
    source: "atlas",
    updatedAt: "2026-09-15",
    revision: 1,
  },
  {
    id: "demo-4",
    name: "Casa Horizon",
    description: "A considered space to work, gather, and make new things.",
    status: "On hold",
    category: "Spaces",
    location: "Lisbon, Portugal",
    latitude: 38.7223,
    longitude: -9.1393,
    dueDate: "",
    color: "violet",
    tasks: [
      { id: "a", title: "Shortlist locations", done: true },
      { id: "b", title: "Review the space plan", done: false },
    ],
    source: "atlas",
    updatedAt: "2026-09-12",
    revision: 1,
  },
];
