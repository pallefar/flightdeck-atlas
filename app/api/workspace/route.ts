import { authorize } from "@/lib/access";
import { database, json, sameOrigin } from "@/lib/server-projects";
import { directory, teamList, projectFor } from "@/lib/project-access";
import {
  appSchema,
  teamSchema,
  preferenceSchema,
  defaultPreferences,
  flightdeckApp,
  type AppEntry,
} from "@/lib/collaboration";
export const dynamic = "force-dynamic";
export async function GET() {
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const db = database(),
      teams = await teamList(),
      people = await directory(a.access);
    const rows = await db.prepare("SELECT * FROM atlas_apps").all();
    const catalog = rows.results.map((r) => ({
      ...JSON.parse(r.data as string),
      id: r.id,
      revision: r.revision,
    })) as AppEntry[];
    if (!catalog.some((x) => x.id === "flightdeck"))
      catalog.push(flightdeckApp);
    const apps = catalog
      .filter(
        (x) =>
          a.access.superAdmin ||
          (x.enabled &&
            (x.audience === "all" ||
              x.people.includes(a.access.email) ||
              x.roles.includes(a.access.roleId) ||
              teams.some(
                (t) =>
                  x.teams.includes(t.id) && t.members.includes(a.access.email),
              ))),
      )
      .sort((x, y) => x.order - y.order);
    const prefs = await db
      .prepare("SELECT data,revision FROM atlas_preferences WHERE user_id=?")
      .bind(a.access.userId)
      .first();
    const notes = await db
      .prepare(
        "SELECT * FROM atlas_notifications WHERE recipient=? ORDER BY created_at DESC LIMIT 100",
      )
      .bind(a.access.email)
      .all();
    const notifications = [];
    for (const n of notes.results)
      if (await projectFor(a.access, n.project_id as string))
        notifications.push(n);
    const capacity = [];
    for (const person of people) {
      const common = teams.some(
        (t) =>
          t.members.includes(person.email) &&
          t.members.includes(a.access.email),
      );
      if (!common || !person.userId || person.email === a.access.email)
        continue;
      const row = await db
        .prepare("SELECT data FROM atlas_preferences WHERE user_id=?")
        .bind(person.userId)
        .first();
      if (row) {
        const pref = preferenceSchema.safeParse(JSON.parse(row.data as string));
        if (pref.success && pref.data.shareCapacity)
          capacity.push({
            email: person.email,
            weeklyHours: pref.data.weeklyHours,
            leaveDays: pref.data.leaveDays,
          });
      }
    }
    const roles = a.access.superAdmin
      ? (await db.prepare("SELECT id,name FROM atlas_roles").all()).results
      : [];
    return json({
      capacity,
      apps,
      teams: teams.filter(
        (t) => a.access.superAdmin || t.members.includes(a.access.email),
      ),
      teamOptions: teams.map((t) => ({ id: t.id, name: t.name })),
      people,
      roles,
      notifications,
      preferences: prefs
        ? { ...defaultPreferences, ...JSON.parse(prefs.data as string) }
        : defaultPreferences,
      preferenceRevision: prefs?.revision || 0,
    });
  } catch {
    return json({ error: "Workspace could not be loaded. Please retry." }, 503);
  }
}
export async function POST(req: Request) {
  if (!sameOrigin(req))
    return json({ error: "Request origin is not allowed." }, 403);
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const raw = await req.text();
    if (raw.length > 400000)
      return json({ error: "This record is too large." }, 400);
    const b = JSON.parse(raw),
      db = database();
    if (b.action === "read-notification") {
      await db
        .prepare(
          "UPDATE atlas_notifications SET read=1 WHERE id=? AND recipient=?",
        )
        .bind(String(b.id), a.access.email)
        .run();
      return json({ success: true });
    }
    if (b.action === "preferences") {
      const data = preferenceSchema.parse(b.data);
      const revision = Number(b.revision);
      const r =
        revision === 0
          ? await db
              .prepare(
                "INSERT OR IGNORE INTO atlas_preferences(user_id,data,revision) VALUES (?,?,1)",
              )
              .bind(a.access.userId, JSON.stringify(data))
              .run()
          : await db
              .prepare(
                "UPDATE atlas_preferences SET data=?,revision=revision+1 WHERE user_id=? AND revision=?",
              )
              .bind(JSON.stringify(data), a.access.userId, revision)
              .run();
      return r.meta.changes
        ? json({ success: true })
        : json({ error: "Preferences changed. Reload and try again." }, 409);
    }
    if (!a.access.superAdmin)
      return json(
        { error: "Only the Super Admin manages apps and teams." },
        403,
      );
    if (b.action !== "app" && b.action !== "team")
      return json({ error: "Unknown operation." }, 400);
    const data =
      b.action === "app" ? appSchema.parse(b.data) : teamSchema.parse(b.data);
    const people = await directory(a.access);
    const targets = "members" in data ? data.members : data.people;
    const existingId = typeof b.id === "string" ? b.id : "";
    const previousRow =
      b.action === "team"
        ? await db
            .prepare("SELECT data FROM atlas_teams WHERE id=?")
            .bind(existingId)
            .first()
        : await db
            .prepare("SELECT data FROM atlas_apps WHERE id=?")
            .bind(existingId)
            .first();
    const previous = previousRow ? JSON.parse(previousRow.data as string) : {};
    if (
      targets.some(
        (e) =>
          !(b.action === "team" ? previous.members : previous.people)?.includes(
            e,
          ) && !people.some((m) => m.email === e),
      )
    )
      return json(
        { error: "Grant Atlas access before adding this person." },
        400,
      );
    if ("teams" in data) {
      const teams = await teamList();
      if (data.teams.some((id) => !teams.some((t) => t.id === id)))
        return json({ error: "Choose existing teams." }, 400);
      const roles = (await db.prepare("SELECT id FROM atlas_roles").all())
        .results;
      if (
        data.roles.some(
          (id) => !roles.some((r) => r.id === id) && id !== "superadmin",
        )
      )
        return json({ error: "Choose existing roles." }, 400);
    }
    const id =
      typeof b.id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(b.id)
        ? b.id
        : crypto.randomUUID();
    const revision = Number(b.revision) || 0;
    let stmt;
    if (b.action === "team")
      stmt =
        revision === 0
          ? db
              .prepare(
                "INSERT OR IGNORE INTO atlas_teams(id,name,data,revision) VALUES (?,?,?,1)",
              )
              .bind(id, data.name, JSON.stringify(data))
          : db
              .prepare(
                "UPDATE atlas_teams SET name=?,data=?,revision=revision+1 WHERE id=? AND revision=?",
              )
              .bind(data.name, JSON.stringify(data), id, revision);
    else
      stmt =
        revision === 0
          ? db
              .prepare(
                "INSERT OR IGNORE INTO atlas_apps(id,data,revision) VALUES (?,?,1)",
              )
              .bind(id, JSON.stringify(data))
          : db
              .prepare(
                "UPDATE atlas_apps SET data=?,revision=revision+1 WHERE id=? AND revision=?",
              )
              .bind(JSON.stringify(data), id, revision);
    const [r] = await db.batch([
      stmt,
      db
        .prepare(
          "INSERT INTO atlas_access_events(id,actor,action,target,created_at) SELECT ?,?,?,?,? WHERE changes()>0",
        )
        .bind(
          crypto.randomUUID(),
          a.access.userId,
          `Updated ${b.action}`,
          id,
          new Date().toISOString(),
        ),
    ]);
    if (!r.meta.changes)
      return json({ error: "This record changed. Reload before saving." }, 409);
    return json({ success: true, id });
  } catch (e) {
    return json(
      {
        error:
          e instanceof Error && e.name === "ZodError"
            ? "Check required fields, URLs and selected members."
            : "The change could not be saved. Your draft is preserved.",
      },
      400,
    );
  }
}
