// Owner-only launcher. This is separate from machine-credential app discovery.
// Trusted Atlas access supplies the identity; general administrators never bypass it.
import { flightdeckApp, type AppEntry } from "../collaboration";

export const VISION_APP_ID = "vision-os";
const OWNERS = new Set(["karsten.haldan@gmail.com", "karsten.haldan@te.com"]);
export type VisionViewer = { userId: string; email: string; superAdmin?: boolean };
export function isVisionOwner(viewer: VisionViewer) {
  return !!viewer.userId && OWNERS.has(viewer.email.trim().toLowerCase());
}
export type VisionCardConfig = { url: string } | null;
export function visionCardConfig(raw: string | undefined): VisionCardConfig {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.username || url.password) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return null;
    return { url: url.href };
  } catch { return null; }
}
export function visionCardFor(viewer: VisionViewer, config: VisionCardConfig): (AppEntry & { reserved: true }) | null {
  if (!config || !isVisionOwner(viewer)) return null;
  return { ...flightdeckApp, id: VISION_APP_ID, name: "Vision OS", description: "Private HR AI strategy, assessments and delivery", url: config.url, category: "Strategy", featured: false, order: 2, audience: "selected", newTab: true, reserved: true };
}
export function catalogWithVisionCard(catalog: AppEntry[], viewer: VisionViewer, config: VisionCardConfig): AppEntry[] {
  const kept = catalog.filter((entry) => entry.id !== VISION_APP_ID);
  const card = visionCardFor(viewer, config);
  return card ? [...kept, card] : kept;
}

/** Use only the authorized server catalog, after stored reserved cards have
 * been discarded. The account action also requires the current Atlas role. */
export function visionMenuUrl(superAdmin: boolean, catalog: AppEntry[]): string | null {
  if (!superAdmin) return null;
  const card = catalog.find((entry) => entry.id === VISION_APP_ID && "reserved" in entry && entry.reserved === true);
  return visionCardConfig(card?.url)?.url ?? null;
}
