import { z } from "zod";

export const SETTINGS_KEY = "atlas-settings-v1";
export const dashboardSettingsSchema = z.object({
  layout: z.enum(["cards", "list", "board"]).catch("cards"),
  sort: z.enum(["updated", "name", "due"]).catch("updated"),
  showPlanner: z.boolean().catch(true),
  showMetrics: z.boolean().catch(true),
  showFocus: z.boolean().catch(true),
  showWellbeing: z.boolean().catch(true),
});
export const globeSettingsSchema = z.object({
  mode: z.enum(["explore", "scan"]).catch("explore"),
  look: z
    .enum(["normal", "crt", "nvg", "thermal", "anime", "noir", "snow"])
    .catch("normal"),
  gain: z.number().min(0.2).max(2).catch(1),
  contrast: z.number().min(0.2).max(2).catch(1),
  saturation: z.number().min(0).max(2).catch(1),
  pixelation: z.number().min(1).max(10).catch(1),
  scanlines: z.number().min(0).max(1).catch(0.3),
  grain: z.number().min(0).max(1).catch(0.15),
  vignette: z.number().min(0).max(1).catch(0.3),
  distortion: z.number().min(0).max(1).catch(0.1),
  instability: z.number().min(0).max(1).catch(0.05),
  sensitivity: z.number().min(0).max(1).catch(0.5),
  thermalPalette: z.enum(["ironbow", "white", "black"]).catch("ironbow"),
  snowDensity: z.number().min(0).max(1).catch(0.4),
  wind: z.number().min(0).max(1).catch(0.2),
  bloom: z.boolean().catch(false),
  bloomIntensity: z.number().min(0).max(2).catch(0.4),
  sharpen: z.number().min(0).max(1).catch(0.15),
  hud: z.enum(["off", "minimal", "operator", "tactical"]).catch("minimal"),
  detection: z.boolean().catch(false),
  detectionDensity: z.number().min(0.1).max(1).catch(0.5),
  scope: z.boolean().catch(false),
  scopeFeather: z.number().min(0).max(1).catch(0.5),
  cleanUI: z.boolean().catch(false),
  atmosphere: z.boolean().catch(true),
  fog: z.boolean().catch(true),
  quality: z.enum(["performance", "balanced", "high"]).catch("balanced"),
  orbitSpeed: z.enum(["slow", "normal", "fast"]).catch("slow"),
  tourDwell: z.number().min(2).max(15).catch(4),
  sun: z.enum(["live", "noon", "golden", "night"]).catch("live"),
  earthquakes: z.boolean().catch(false),
  zoomLens: z.boolean().catch(true),
  markerColor: z.enum(["project", "risk"]).catch("project"),
  shadows: z.boolean().catch(false),
  mapStyle: z.enum(["satellite", "street"]).catch("satellite"),
  buildings: z.boolean().catch(true),
  terrain: z.boolean().catch(true),
  labels: z.boolean().catch(true),
  projectList: z.boolean().catch(true),
  motion: z.enum(["cinematic", "quick", "instant"]).catch("cinematic"),
});
export const settingsSchema = z.object({
  dailyFocusMinutes: z
    .union([
      z.literal(60),
      z.literal(120),
      z.literal(180),
      z.literal(240),
      z.literal(360),
    ])
    .catch(180),
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
