import { visionRoute } from "@/lib/flightdeck/vision-wiring";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return visionRoute.GET(request); }
