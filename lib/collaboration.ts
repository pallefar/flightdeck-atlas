import { z } from "zod";
import { osSelectionSchema, type OsSelection } from "./flightdeck/context";
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
export const grantSchema = z.object({
  type: z.enum(["person", "team"]),
  target: z.string().min(1).max(254),
  role: z.enum(["viewer", "commenter", "editor"]),
});
export const sharingSchema = z.object({
  visibility: z.enum(["private", "shared", "all"]),
  grants: z.array(grantSchema).max(100),
});
export type Sharing = z.infer<typeof sharingSchema> & { revision: number };
export const teamSchema = z.object({
  name: z.string().trim().min(1).max(80),
  members: z.array(email).max(200),
});
export type Team = z.infer<typeof teamSchema> & {
  id: string;
  revision: number;
};
export const httpsUrl = z
  .string()
  .max(2000)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" && !u.username && !u.password;
    } catch {
      return false;
    }
  }, "Use an HTTPS address without credentials.");
export const appSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300),
  url: z.union([z.literal(""), httpsUrl]),
  icon: z
    .string()
    .max(350000)
    .refine(
      (s) =>
        !s ||
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s) ||
        httpsUrl.safeParse(s).success,
      "Choose a PNG, JPEG, WebP or HTTPS icon.",
    ),
  category: z.string().max(60),
  enabled: z.boolean(),
  featured: z.boolean(),
  order: z.number().int().min(0).max(999),
  audience: z.enum(["all", "selected"]),
  people: z.array(email).max(100),
  teams: z.array(z.string().max(80)).max(50),
  roles: z.array(z.string().max(80)).max(50),
  login: z.enum(["external", "flightdeck"]),
  newTab: z.boolean(),
});
export type AppEntry = z.infer<typeof appSchema> & {
  id: string;
  revision: number;
};
export const flightdeckApp: AppEntry = {
  id: "flightdeck",
  revision: 0,
  name: "FlightDeck OS",
  description: "Projects, strategy and connected sub-apps",
  url: "",
  icon: "",
  category: "Workspace",
  enabled: true,
  featured: true,
  order: 0,
  audience: "all",
  people: [],
  teams: [],
  roles: [],
  login: "flightdeck",
  newTab: true,
};
export const recordSchema = z.object({
  kind: z.enum(["comment", "meeting", "decision", "approval", "benefit"]),
  title: z.string().trim().min(1).max(160),
  body: z.string().max(6000),
  taskId: z.string().max(80).default(""),
  mentions: z.array(email).max(20).default([]),
  reviewer: z.union([z.literal(""), email]).default(""),
  status: z
    .enum(["open", "requested", "approved", "changes", "closed"])
    .default("open"),
  date: z
    .string()
    .regex(/^$|^\d{4}-\d{2}-\d{2}$/)
    .default(""),
  expected: z.number().finite().optional(),
  actual: z.number().finite().optional(),
  unit: z.string().max(40).default(""),
  actions: z
    .array(
      z.object({ id: z.string().max(80), title: z.string().min(1).max(200) }),
    )
    .max(30)
    .default([]),
});
export type CollaborationRecord = z.infer<typeof recordSchema> & {
  id: string;
  author: string;
  updatedAt: string;
  revision: number;
};
export const sceneSchema = z.object({
  id: z.string().max(80),
  name: z.string().min(1).max(80),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  height: z.number().min(40).max(50000000),
  heading: z.number().finite(),
  pitch: z.number().min(-1.58).max(1.58),
});
export const annotationSchema = z.object({
  id: z.string().max(80),
  name: z.string().min(1).max(100),
  type: z.enum(["pin", "line", "area"]),
  color: z.enum(["orange", "blue", "green", "white", "red"]),
  points: z
    .array(
      z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    )
    .min(1)
    .max(100),
});
export const preferenceSchema = z.object({
  frog: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      projectId: z.string().min(1).max(80),
      taskId: z.string().min(1).max(80),
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      minutes: z.number().int().min(5).max(90),
      firstStep: z.string().trim().min(1).max(300),
    })
    .nullable()
    .default(null),
  scenes: z.array(sceneSchema).max(30).default([]),
  annotations: z.array(annotationSchema).max(40).default([]),
  shareCapacity: z.boolean().default(false),
  weeklyHours: z.number().min(0).max(80),
  leaveDays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366),
  favourites: z.array(z.string().max(80)).max(50),
  recent: z.array(z.string().max(80)).max(10),
  digest: z.enum(["all", "daily", "weekly"]),
  // Chosen FlightDeck OS workspace/project (OS ids, not Atlas project ids).
  flightdeckContext: osSelectionSchema.nullable().default(null),
});
/** Dispatched on window after a preference is saved outside useWorkspace, so
 * open views reload the new revision instead of hitting a stale-revision 409. */
export const PREFERENCES_CHANGED_EVENT = "atlas-preferences-changed";
export const defaultPreferences = {
  frog: null as z.infer<typeof preferenceSchema>["frog"],
  shareCapacity: false,
  scenes: [] as z.infer<typeof sceneSchema>[],
  annotations: [] as z.infer<typeof annotationSchema>[],
  weeklyHours: 40,
  leaveDays: [] as string[],
  favourites: [] as string[],
  recent: [] as string[],
  digest: "all" as const,
  flightdeckContext: null as OsSelection | null,
};
