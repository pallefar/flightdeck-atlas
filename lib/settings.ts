import { z } from "zod";

export const SETTINGS_KEY = "atlas-settings-v1";
export const dashboardSettingsSchema = z.object({
  layout: z.enum(["cards", "list"]).catch("cards"),
  sort: z.enum(["updated", "name", "due"]).catch("updated"),
  showMetrics: z.boolean().catch(true),
  showFocus: z.boolean().catch(true),
  showWellbeing: z.boolean().catch(true),
});
export const globeSettingsSchema = z.object({
  mapStyle: z.enum(["satellite", "street"]).catch("satellite"),
  buildings: z.boolean().catch(true),
  terrain: z.boolean().catch(true),
  labels: z.boolean().catch(true),
  projectList: z.boolean().catch(true),
  motion: z.enum(["cinematic", "quick", "instant"]).catch("cinematic"),
});
export const settingsSchema = z.object({
  viewAnimation: z.enum(["cinematic", "quick", "instant"]).catch("cinematic"),
  startView: z.enum(["dashboard", "globe"]).catch("dashboard"),
  dashboard: dashboardSettingsSchema.catch(dashboardSettingsSchema.parse({})),
  globe: globeSettingsSchema.catch(globeSettingsSchema.parse({})),
});
export type AtlasSettings = z.infer<typeof settingsSchema>;
export type GlobeSettings = AtlasSettings["globe"];
export const defaultSettings = settingsSchema.parse({});

export function readSettings(): AtlasSettings {
  try {
    return settingsSchema.parse(
      JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"),
    );
  } catch {
    return settingsSchema.parse({});
  }
}

export function motionScale(motion: GlobeSettings["motion"]): number {
  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    motion === "instant"
  )
    return 0;
  return motion === "quick" ? 0.45 : 1;
}
