import { authorize } from "@/lib/access";
import { json, sameOrigin } from "@/lib/http";
import { database } from "@/lib/server-projects";
import { FEEDBACK_PER_HOUR, feedbackSchema, overLimit } from "@/lib/feedback";
export const dynamic = "force-dynamic";

// Feedback from the web lane and the desktop app (owner request, 2026-10-30).
// Structural context only — screen, project, stage, action — plus the person's
// own words. Never page text or project data: the Maps overlay's privacy rule.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  const auth = await authorize("onboarding.view", false, request);
  if (auth.error) return auth.error;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Send a JSON body.", code: "bad_body" }, 400);
  }
  const parsed = feedbackSchema.safeParse(payload);
  if (!parsed.success)
    return json(
      { error: parsed.error.issues[0]?.message ?? "Check the feedback.", code: "invalid_feedback" },
      400,
    );
  const item = parsed.data;
  try {
    const db = database();
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const recent = await db
      .prepare("SELECT COUNT(*) AS n FROM atlas_feedback WHERE by = ? AND created_at > ?")
      .bind(auth.access.email, since)
      .first<{ n: number }>();
    if (overLimit(Number(recent?.n ?? 0)))
      return json(
        { error: `That is more than ${FEEDBACK_PER_HOUR} notes in an hour. Try again later.`, code: "rate_limited" },
        429,
      );
    const id = crypto.randomUUID();
    const at = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO atlas_feedback
           (id, by, source, screen, project_id, stage, rating, category, comment, app_version, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        auth.access.email,
        item.source,
        item.screen,
        item.projectId ?? null,
        item.stage ?? null,
        item.rating,
        item.category ?? null,
        item.comment,
        item.appVersion ?? null,
        at,
      )
      .run();
    return json({ id, at }, 201);
  } catch {
    return json({ error: "The feedback could not be recorded." }, 503);
  }
}
export async function GET(request: Request) {
  const auth = await authorize("onboarding.view", false, request);
  if (auth.error) return auth.error;
  try {
    const { results } = await database()
      .prepare(
        "SELECT id, source, screen, project_id, stage, rating, category, comment, app_version, created_at FROM atlas_feedback WHERE by = ? ORDER BY created_at DESC LIMIT 50",
      )
      .bind(auth.access.email)
      .all<Record<string, unknown>>();
    return json({
      feedback: results.map((row) => ({
        id: row.id,
        source: row.source,
        screen: row.screen,
        projectId: row.project_id,
        stage: row.stage,
        rating: row.rating,
        category: row.category,
        comment: row.comment,
        appVersion: row.app_version,
        createdAt: row.created_at,
      })),
    });
  } catch {
    return json({ error: "Feedback is unavailable." }, 503);
  }
}
