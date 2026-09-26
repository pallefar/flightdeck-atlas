import { dueReminders } from "@/lib/work-reminders";
import { authorize } from "@/lib/access";
import { taskBlocked } from "@/lib/projects";
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
import { keptSelection } from "@/lib/flightdeck/context-route";
import { osAdminCardConfig, osOrigin } from "@/lib/flightdeck/os-server";
import {
  catalogWithAdminCard,
  isReservedAppId,
} from "@/lib/flightdeck/admin-card";
import { markNoticeRead, noticesFor } from "@/lib/flightdeck/notices";
export const dynamic = "force-dynamic";
export async function GET() {
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const db = database(),
      teams = await teamList(),
      people = await directory(a.access);
    const rows = await db.prepare("SELECT * FROM atlas_apps").all();
    // A stored row under a reserved id (see POST) is dropped, and the
    // built-in 'FlightDeck Admin' card is added only for a viewer who passes
    // its visibility heuristic (lib/flightdeck/admin-card.ts) — the OS
    // re-checks access on arrival.
    const catalog = catalogWithAdminCard(
      rows.results.map((r) => ({
        ...JSON.parse(r.data as string),
        id: r.id,
        revision: r.revision,
      })) as AppEntry[],
      a.access,
      osAdminCardConfig(),
    );
    if (!catalog.some((x) => x.id === "flightdeck"))
      catalog.push(flightdeckApp);
    // Atlas ships a FEATURED built-in "FlightDeck OS" entry whose `url` is ""
    // (lib/collaboration.ts), so the card has always rendered and has never
    // been openable. Fill it from the same configured origin this Worker
    // already calls — `osOrigin()` returns only the url half of that config,
    // never the credential — and ONLY when it is empty, so an operator who set
    // their own url in Connections & admin always wins. Unconfigured returns
    // "" and the entry keeps its empty url, which is the honest state.
    const osUrl = osOrigin();
    if (osUrl)
      for (const entry of catalog)
        if (entry.id === "flightdeck" && !entry.url) entry.url = osUrl;
    const apps = catalog
      .filter(
        (x) =>
          isReservedAppId(x.id) ||
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
    // Access is re-checked on every read: a notice of a project this user
    // can no longer view is not shown.
    const notifications = await noticesFor(
      db,
      a.access.email,
      async (projectId) => !!(await projectFor(a.access, projectId)),
    );
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
      email: a.access.email,
      capacity,
      apps,
      teams: teams.filter(
        (t) => a.access.superAdmin || t.members.includes(a.access.email),
      ),
      teamOptions: teams.map((t) => ({ id: t.id, name: t.name })),
      people,
      roles,
      notifications: [...(await dueReminders(a.access)), ...notifications]
        .sort((x, y) =>
          String(y.created_at).localeCompare(String(x.created_at)),
        )
        .slice(0, 100),
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
    if (
      b.action === "read-notification" &&
      String(b.id).startsWith("reminder:")
    ) {
      await db
        .prepare(
          "UPDATE atlas_work_records SET closed=1 WHERE id=? AND owner=? AND kind='reminder'",
        )
        .bind(String(b.id).slice(9), a.access.userId)
        .run();
      return json({ success: true });
    }
    if (b.action === "read-notification") {
      await markNoticeRead(db, String(b.id), a.access.email);
      return json({ success: true });
    }
    if (b.action === "preferences") {
      const data = preferenceSchema.parse(b.data);
      const before = await db
        .prepare("SELECT data FROM atlas_preferences WHERE user_id=?")
        .bind(a.access.userId)
        .first();
      const previousFrog = before
        ? JSON.parse(before.data as string).frog
        : null;
      // Only /api/flightdeck/context changes the FlightDeck selection, after
      // validating it against the OS. Other preference saves keep it as is.
      data.flightdeckContext = keptSelection(
        before ? (before.data as string) : null,
      );
      if (
        data.frog &&
        JSON.stringify(data.frog) !== JSON.stringify(previousFrog)
      ) {
        const target = await projectFor(a.access, data.frog.projectId);
        const task = target?.project.tasks.find(
          (t) => t.id === data.frog!.taskId,
        );
        if (
          !target ||
          !task ||
          task.done ||
          task.archived ||
          target.project.archived ||
          target.project.status === "Completed" ||
          target.project.status === "On hold" ||
          taskBlocked(task, target.project) ||
          target.project.blocker?.trim()
        )
          return json(
            {
              error:
                "Choose an accessible, active task with no unresolved blockers.",
            },
            400,
          );
      }
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
    // Reserved built-in ids (the 'FlightDeck Admin' card) are configured by
    // the operator's environment, never by a catalog edit: refused, so no
    // row can create or override them.
    if (b.action === "app" && isReservedAppId(b.id))
      return json(
        { error: "This app is built in and cannot be changed here." },
        400,
      );
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
