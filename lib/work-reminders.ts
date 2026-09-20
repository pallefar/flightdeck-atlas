import type { AccessProfile } from "./access-policy";
import { database } from "./server-projects";
import { projectFor, visibleProjects } from "./project-access";
export async function dueReminders(access: AccessProfile) {
  const visible = (await visibleProjects(access)).map((p) => p.id);
  const rows = await database()
    .prepare(
      "SELECT r.* FROM atlas_work_records r JOIN atlas_projects p ON p.id=r.project_id WHERE r.kind='reminder' AND r.owner=? AND p.id IN(SELECT value FROM json_each(?)) AND r.closed=0 AND r.available_at<=? AND coalesce(json_extract(p.data,'$.archived'),0)=0 AND EXISTS(SELECT 1 FROM json_each(p.data,'$.tasks') t WHERE json_extract(t.value,'$.id')=json_extract(r.data,'$.taskId') AND json_extract(t.value,'$.done')=0 AND coalesce(json_extract(t.value,'$.archived'),0)=0 AND coalesce(json_extract(t.value,'$.dueDate'),'')=json_extract(r.data,'$.dueDate')) ORDER BY r.available_at DESC LIMIT 100",
    )
    .bind(access.userId, JSON.stringify(visible), new Date().toISOString())
    .all();
  const result = [];
  for (const row of rows.results) {
    const p = await projectFor(access, String(row.project_id)),
      data = JSON.parse(String(row.data)),
      t = p?.project.tasks.find((t) => t.id === data.taskId);
    if (
      !t ||
      t.done ||
      t.archived ||
      p?.project.archived ||
      (t.dueDate || "") !== data.dueDate
    )
      continue;
    result.push({
      id: `reminder:${row.id}`,
      project_id: row.project_id,
      text: `Reminder: ${t.title}`,
      created_at: row.available_at,
      read: 0,
    });
  }
  return result;
}
