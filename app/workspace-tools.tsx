"use client";
import { ResourcePlanner } from "./work-studio";
import { useCallback, useEffect, useState, useRef } from "react";
import {
  Grid3X3,
  ExternalLink,
  Star,
  Bell,
  Plus,
  Users,
  Settings2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppEntry, Team } from "@/lib/collaboration";
import {
  flightdeckApp,
  defaultPreferences,
  PREFERENCES_CHANGED_EVENT,
} from "@/lib/collaboration";
import type { AccessProfile } from "@/lib/access-policy";
import type { Project, ProjectFields } from "@/lib/projects";
export type WorkspaceData = {
  email: string;
  capacity: { email: string; weeklyHours: number; leaveDays: string[] }[];
  apps: AppEntry[];
  teams: Team[];
  teamOptions: { id: string; name: string }[];
  people: { email: string; userId: string | null; roleId: string }[];
  roles: { id: string; name: string }[];
  notifications: {
    id: string;
    project_id: string;
    text: string;
    created_at: string;
    read: number;
  }[];
  preferences: Omit<typeof defaultPreferences, "digest"> & {
    digest: "all" | "daily" | "weekly";
  };
  preferenceRevision: number;
};
async function fetchWorkspace() {
  const r = await fetch("/api/workspace"),
    b = (await r.json()) as WorkspaceData & { error: string };
  if (!r.ok) throw Error(b.error);
  return b;
}
export function useWorkspace() {
  const [data, setData] = useState<WorkspaceData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      fetchWorkspace().then(
        (b) => {
          setData(b);
          setError("");
        },
        (e) => setError((e as Error).message),
      ),
    [],
  );
  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(refresh, 30000);
    const changed = () => void load();
    window.addEventListener("focus", refresh);
    window.addEventListener(PREFERENCES_CHANGED_EVENT, changed);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(PREFERENCES_CHANGED_EVENT, changed);
    };
  }, [load]);
  async function mutate(payload: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        b = (await r.json()) as WorkspaceData & { error: string };
      if (!r.ok) throw Error(b.error);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { data, error, busy, load, mutate };
}
export function AppLauncher({
  access,
  onAdmin,
  onInbox,
}: {
  access: AccessProfile | null;
  onAdmin: () => void;
  onInbox: () => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const w = useWorkspace();
  async function preference(key: "favourites" | "recent", id: string) {
    if (!w.data) return;
    const prev = w.data.preferences[key];
    const next =
      key === "recent"
        ? [id, ...prev.filter((x) => x !== id)].slice(0, 10)
        : prev.includes(id)
          ? prev.filter((x) => x !== id)
          : [...prev, id];
    await w.mutate({
      action: "preferences",
      revision: w.data.preferenceRevision,
      data: { ...w.data.preferences, [key]: next },
    });
  }
  return (
    <>
      <button
        className="theme-toggle"
        aria-label="Notification inbox"
        title="Notification inbox"
        onClick={onInbox}
      >
        <Bell size={18} />
        {!!w.data?.notifications.some((n) => !n.read) && (
          <span className="inbox-dot" />
        )}
      </button>
      <button
        className="theme-toggle"
        aria-label="Open apps"
        disabled={!access}
        title="Apps"
        onClick={() => {
          void w.load();
          setOpen(true);
        }}
      >
        <Grid3X3 size={20} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="apps-dialog">
          <DialogTitle>Your apps</DialogTitle>
          <DialogDescription>
            One workspace, all your connected tools.
          </DialogDescription>
          <Input
            aria-label="Search apps"
            placeholder="Search apps…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {w.error && <p role="alert">{w.error}</p>}
          <div className="launcher-grid">
            {w.data?.apps
              .filter(
                (a) =>
                  a.enabled &&
                  `${a.name} ${a.category}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              )
              .sort(
                (a, b) =>
                  Number(w.data!.preferences.favourites.includes(b.id)) -
                    Number(w.data!.preferences.favourites.includes(a.id)) ||
                  Number(b.featured) - Number(a.featured),
              )
              .map((a) => (
                <article key={a.id} className="launcher-tile">
                  <button
                    aria-label={`${w.data?.preferences.favourites.includes(a.id) ? "Unpin" : "Pin"} ${a.name}`}
                    disabled={w.busy}
                    className="app-pin"
                    onClick={() => void preference("favourites", a.id)}
                  >
                    <Star
                      size={14}
                      fill={
                        w.data?.preferences.favourites.includes(a.id)
                          ? "currentColor"
                          : "none"
                      }
                    />
                  </button>
                  {a.url ? (
                    <a
                      href={a.url}
                      target={a.newTab ? "_blank" : undefined}
                      rel="noopener noreferrer"
                      onClick={() => void preference("recent", a.id)}
                    >
                      <AppIcon app={a} />
                      <strong>{a.name}</strong>
                      <small>
                        {a.login === "flightdeck"
                          ? "Shared sign-in pending"
                          : "External app"}
                      </small>
                    </a>
                  ) : (
                    <div>
                      <AppIcon app={a} />
                      <strong>{a.name}</strong>
                      <small>Setup pending</small>
                    </div>
                  )}
                  {w.data?.preferences.recent.includes(a.id) && (
                    <span className="app-recent">Recently opened</span>
                  )}
                </article>
              ))}
          </div>
          {access?.superAdmin && (
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                onAdmin();
              }}
            >
              <Settings2 size={16} />
              Manage apps
            </Button>
          )}
          <p className="hub-muted">
            Connected apps need FlightDeck’s sign-in service. Adding a link does
            not enable shared login.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
function AppIcon({ app }: { app: AppEntry }) {
  return app.icon ? (
    <img
      className="app-icon"
      src={app.icon}
      alt=""
      referrerPolicy="no-referrer"
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  ) : (
    <span className="app-icon app-monogram">
      {app.name.slice(0, 2).toUpperCase()}
    </span>
  );
}
export function AppAdministration() {
  const w = useWorkspace();
  const [draft, setDraft] = useState<AppEntry | null>(null);
  function newApp() {
    setDraft({
      ...flightdeckApp,
      id: crypto.randomUUID(),
      revision: 0,
      name: "",
      description: "",
      url: "",
      featured: false,
      login: "external",
      order: w.data?.apps.length || 0,
    });
  }
  return (
    <main className="hub-page suite-page">
      <div className="suite-heading">
        <div>
          <span className="eyebrow">ADMINISTRATION</span>
          <h1>Apps & connections</h1>
          <p>Add the tools your team uses and choose who sees them.</p>
        </div>
        <Button onClick={newApp}>
          <Plus size={16} />
          Add app
        </Button>
      </div>
      {w.error && (
        <p className="form-error" role="alert">
          {w.error}
        </p>
      )}
      <div className="suite-card-grid">
        {w.data?.apps.map((a) => (
          <button
            className="suite-card app-admin-card"
            key={a.id}
            onClick={() => setDraft(a)}
          >
            <AppIcon app={a} />
            <div>
              <h3>{a.name}</h3>
              <p>{a.description}</p>
              <small>
                {a.enabled ? "Enabled" : "Disabled"} ·{" "}
                {a.audience === "all"
                  ? "All admitted members"
                  : "Selected members"}
              </small>
              <small>
                {a.login === "flightdeck"
                  ? "FlightDeck SSO pending"
                  : "External login"}
              </small>
            </div>
            <Settings2 size={17} />
          </button>
        ))}
      </div>
      {draft && (
        <form
          className="suite-card suite-editor"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await w.mutate({
                action: "app",
                id: draft.id,
                revision: draft.revision,
                data: draft,
              })
            )
              setDraft(null);
          }}
        >
          <fieldset disabled={w.busy}>
            <h2>{draft.id ? "Edit app" : "Add an app"}</h2>
            <div className="suite-form-grid">
              <label>
                Name
                <Input
                  required
                  maxLength={80}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label>
                App URL
                <Input
                  type="url"
                  placeholder="https://…"
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              </label>
              <label>
                Description
                <Input
                  maxLength={300}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
              </label>
              <label>
                Category
                <Input
                  maxLength={60}
                  value={draft.category}
                  onChange={(e) =>
                    setDraft({ ...draft, category: e.target.value })
                  }
                />
              </label>
              <label>
                Icon URL
                <Input
                  type="url"
                  value={draft.icon.startsWith("data:") ? "" : draft.icon}
                  onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
                />
              </label>
              <label>
                Or upload icon (PNG/JPEG/WebP, 250 KB)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 250000) {
                      e.target.setCustomValidity(
                        "Choose an image below 250 KB.",
                      );
                      e.target.reportValidity();
                      return;
                    }
                    e.target.setCustomValidity("");
                    const reader = new FileReader();
                    reader.onload = () =>
                      setDraft((d) =>
                        d ? { ...d, icon: String(reader.result) } : d,
                      );
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              <label>
                Sign-in integration
                <select
                  value={draft.login}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      login: e.target.value as AppEntry["login"],
                    })
                  }
                >
                  <option value="external">External app login</option>
                  <option value="flightdeck">
                    FlightDeck shared login (pending SDK)
                  </option>
                </select>
              </label>
              <label>
                Order
                <Input
                  type="number"
                  min={0}
                  max={999}
                  value={draft.order}
                  onChange={(e) =>
                    setDraft({ ...draft, order: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <div className="suite-checks">
              {(["enabled", "featured", "newTab"] as const).map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={draft[key]}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.checked })
                    }
                  />
                  {key === "newTab" ? "Open in new tab" : key}
                </label>
              ))}
            </div>
            <label>
              Visible to
              <select
                value={draft.audience}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    audience: e.target.value as AppEntry["audience"],
                  })
                }
              >
                <option value="all">All admitted Atlas members</option>
                <option value="selected">
                  Selected people, teams or roles
                </option>
              </select>
            </label>
            {draft.audience === "selected" && (
              <div className="suite-form-grid">
                {(["people", "teams", "roles"] as const).map((key) => (
                  <label key={key}>
                    {key}
                    <select
                      multiple
                      value={draft[key]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [key]: Array.from(
                            e.target.selectedOptions,
                            (x) => x.value,
                          ),
                        })
                      }
                    >
                      {(key === "people"
                        ? w.data?.people.map((m) => ({
                            id: m.email,
                            name: m.email,
                          }))
                        : key === "teams"
                          ? w.data?.teamOptions
                          : w.data?.roles
                      )?.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
            <p className="hub-muted">
              Visibility controls this launcher. The destination app must also
              enforce its own access. Shared login remains pending until the SDK
              registers this app.
            </p>
            <div className="suite-actions">
              <Button type="submit">Save app</Button>
              <Button
                variant="outline"
                type="button"
                onClick={() => setDraft(null)}
              >
                Cancel
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </main>
  );
}
export function TeamHub({
  access,
  projects,
  onOpen,
  onCreate,
  onSave,
}: {
  access: AccessProfile | null;
  projects: Project[];
  onOpen: (p: Project) => void;
  onCreate: (p: ProjectFields) => Promise<Project | null>;
  onSave: (f: ProjectFields, p?: Project) => Promise<Project | null>;
}) {
  const capacityDirty = useRef(false);
  const capacityBase = useRef<WorkspaceData | null>(null);
  const w = useWorkspace(),
    [tab, setTab] = useState("inbox"),
    [team, setTeam] = useState<Team | null>(null),
    [hours, setHours] = useState("40"),
    [leave, setLeave] = useState(""),
    [shareCapacity, setShareCapacity] = useState(false);
  useEffect(() => {
    if (w.data && !capacityDirty.current) {
      setHours(String(w.data.preferences.weeklyHours));
      setLeave(w.data.preferences.leaveDays.join("\n"));
      setShareCapacity(w.data.preferences.shareCapacity);
    }
  }, [w.data]);
  const notificationGroups: Record<string, WorkspaceData["notifications"]> = {};
  for (const note of w.data?.notifications || []) {
    const date = new Date(note.created_at);
    const mode = w.data?.preferences.digest || "all";
    if (mode === "weekly")
      date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const group =
      mode === "all"
        ? "Recent activity"
        : `${mode === "weekly" ? "Week of " : ""}${date.toLocaleDateString()}`;
    (notificationGroups[group] ||= []).push(note);
  }
  const nextDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  return (
    <main className="hub-page suite-page">
      <div className="suite-heading">
        <div>
          <span className="eyebrow">WORK TOGETHER</span>
          <h1>Team workspace</h1>
          <p>Conversations, commitments and reusable ways of working.</p>
        </div>
        <Users size={30} />
      </div>
      <div className="filter-tabs suite-tabs">
        {[
          "inbox",
          "teams",
          "capacity",
          "planner",
          "onboarding",
          "proposals",
        ].map((t) => (
          <button
            key={t}
            aria-pressed={tab === t}
            className={tab === t ? "chosen" : ""}
            onClick={() => setTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {w.error && (
        <p className="form-error" role="alert">
          {w.error}
        </p>
      )}
      {tab === "inbox" && (
        <section className="suite-card">
          <div className="suite-heading">
            <h2>Notification inbox</h2>
            <label>
              Group by
              <select
                value={w.data?.preferences.digest || "all"}
                disabled={!w.data || w.busy}
                onChange={(e) =>
                  void w.mutate({
                    action: "preferences",
                    revision: w.data!.preferenceRevision,
                    data: { ...w.data!.preferences, digest: e.target.value },
                  })
                }
              >
                <option value="all">All activity</option>
                <option value="daily">Daily digest</option>
                <option value="weekly">Weekly digest</option>
              </select>
            </label>
          </div>
          <p className="hub-muted">
            In-app updates for mentions, assignments and reviews. Email delivery
            is not connected.
          </p>
          {!w.data?.notifications.length && (
            <p>
              No notifications yet. Share a project and invite its members into
              the discussion.
            </p>
          )}
          {Object.entries(notificationGroups).map(([label, notifications]) => (
            <section className="notification-group" key={label}>
              <h3>
                {label} <small>· {notifications.length} updates</small>
              </h3>
              {notifications.map((n) => (
                <article
                  className={`inbox-row ${n.read ? "is-read" : ""}`}
                  key={n.id}
                >
                  <div>
                    <strong>{n.text}</strong>
                    <small>
                      {new Date(n.created_at).toLocaleString()} ·{" "}
                      {projects.find((p) => p.id === n.project_id)?.name}
                    </small>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const p = projects.find((p) => p.id === n.project_id);
                      if (p) onOpen(p);
                      void w.mutate({ action: "read-notification", id: n.id });
                    }}
                  >
                    Open project
                  </Button>
                </article>
              ))}
            </section>
          ))}
        </section>
      )}
      {tab === "teams" && (
        <>
          <div className="suite-heading">
            <h2>Your teams</h2>
            {access?.superAdmin && (
              <Button
                onClick={() =>
                  setTeam({
                    id: crypto.randomUUID(),
                    revision: 0,
                    name: "",
                    members: [],
                  })
                }
              >
                <Plus size={16} />
                Create team
              </Button>
            )}
          </div>
          <div className="suite-card-grid">
            {w.data?.teams.map((t) => (
              <article className="suite-card" key={t.id}>
                <h3>{t.name}</h3>
                <p>{t.members.length} members</p>
                <p className="hub-muted">
                  {t.members.join(", ") || "No members assigned"}
                </p>
                {access?.superAdmin && (
                  <Button variant="outline" onClick={() => setTeam(t)}>
                    Edit team
                  </Button>
                )}
              </article>
            ))}
          </div>
          {!w.data?.teams.length && (
            <p className="suite-card">
              No teams yet. Your Super Admin can create one from admitted Atlas
              members.
            </p>
          )}
          {team && (
            <form
              className="suite-card"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await w.mutate({
                    action: "team",
                    id: team.id,
                    revision: team.revision,
                    data: team,
                  })
                )
                  setTeam(null);
              }}
            >
              <fieldset disabled={w.busy}>
                <h3>Team details</h3>
                <label>
                  Name
                  <Input
                    required
                    maxLength={80}
                    value={team.name}
                    onChange={(e) => setTeam({ ...team, name: e.target.value })}
                  />
                </label>
                <label>
                  Members
                  <select
                    multiple
                    value={team.members}
                    onChange={(e) =>
                      setTeam({
                        ...team,
                        members: Array.from(
                          e.target.selectedOptions,
                          (x) => x.value,
                        ),
                      })
                    }
                  >
                    {w.data?.people.map((p) => (
                      <option key={p.email}>{p.email}</option>
                    ))}
                  </select>
                </label>
                <p className="hub-muted">
                  Team membership alone does not share projects. Add this team
                  in a project’s Sharing tab.
                </p>
                <div className="suite-actions">
                  <Button>Save team</Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setTeam(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
        </>
      )}
      {tab === "planner" && (
        <ResourcePlanner
          projects={projects}
          onSave={onSave}
          readOnly={projects.every((p) => p.id.startsWith("demo-"))}
        />
      )}
      {tab === "capacity" && (
        <>
          <div className="suite-card">
            <h2>My working capacity</h2>
            <p>
              Your working hours and leave dates stay private unless you choose
              to share them with your Atlas teams. Calendar availability is not
              connected.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const base = capacityBase.current || w.data;
                if (
                  base &&
                  (await w.mutate({
                    action: "preferences",
                    revision: base.preferenceRevision,
                    data: {
                      ...base.preferences,
                      weeklyHours: Number(hours),
                      shareCapacity,
                      leaveDays: leave
                        .split(/[\n,]/)
                        .map((x) => x.trim())
                        .filter(Boolean),
                    },
                  }))
                ) {
                  capacityDirty.current = false;
                  capacityBase.current = null;
                }
              }}
            >
              <fieldset disabled={w.busy}>
                <div className="suite-form-grid">
                  <label>
                    Hours per working week
                    <Input
                      type="number"
                      min={0}
                      max={80}
                      value={hours}
                      onChange={(e) => {
                        capacityBase.current ||= w.data;
                        capacityDirty.current = true;
                        setHours(e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    Leave dates (YYYY-MM-DD, one per line)
                    <textarea
                      value={leave}
                      onChange={(e) => {
                        capacityBase.current ||= w.data;
                        capacityDirty.current = true;
                        setLeave(e.target.value);
                      }}
                    />
                  </label>
                </div>
                <label className="capacity-share-toggle">
                  <input
                    type="checkbox"
                    checked={shareCapacity}
                    onChange={(e) => {
                      capacityBase.current ||= w.data;
                      capacityDirty.current = true;
                      setShareCapacity(e.target.checked);
                    }}
                  />
                  Share working hours and leave dates with my Atlas teams
                </label>
                <Button>Save capacity</Button>
                {capacityDirty.current && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (w.data) {
                        setHours(String(w.data.preferences.weeklyHours));
                        setLeave(w.data.preferences.leaveDays.join("\n"));
                        setShareCapacity(w.data.preferences.shareCapacity);
                      }
                      capacityBase.current = null;
                      capacityDirty.current = false;
                    }}
                  >
                    Discard capacity changes
                  </Button>
                )}
              </fieldset>
            </form>
          </div>
          <div className="suite-card">
            <h2>Next seven days · visible project commitments</h2>
            <p className="hub-muted">
              Only tasks planned in this period are counted. Unestimated tasks
              need review; this is not a complete availability calendar.
            </p>
            {w.data?.people.map((m) => {
              const tasks = projects.flatMap((p) =>
                p.tasks
                  .filter(
                    (t) =>
                      !t.done &&
                      t.assigneeEmail === m.email &&
                      nextDays.includes(t.plannedDate || ""),
                  )
                  .map((t) => ({ p, t })),
              );
              if (!tasks.length && m.email !== access?.email) return null;
              const minutes = tasks.reduce(
                (n, x) => n + (x.t.estimateMinutes || 0),
                0,
              );
              const plan =
                m.email === access?.email
                  ? w.data!.preferences
                  : w.data!.capacity.find((x) => x.email === m.email);
              const days = nextDays.filter(
                (d) =>
                  ![0, 6].includes(new Date(`${d}T12:00`).getDay()) &&
                  !plan?.leaveDays.includes(d),
              ).length;
              const capacity = plan ? (plan.weeklyHours / 5) * days : null;
              return (
                <div className="inbox-row" key={m.email}>
                  <div>
                    <strong>{m.email}</strong>
                    <small>
                      {(minutes / 60).toFixed(1)} h estimated ·{" "}
                      {tasks.filter((x) => !x.t.estimateMinutes).length}{" "}
                      unestimated tasks
                      {capacity !== null
                        ? ` · ${capacity.toFixed(1)} h capacity`
                        : " · capacity not shared"}
                    </small>
                  </div>
                  <span>
                    {capacity !== null && minutes > capacity * 60
                      ? "Over capacity"
                      : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {tab === "onboarding" && (
        <div className="suite-card-grid">
          {[
            "Function discovery",
            "Improvement pilot",
            "FlightDeck rollout",
          ].map((name, i) => (
            <article className="suite-card" key={name}>
              <span className="eyebrow">PLAYBOOK {i + 1}</span>
              <h2>{name}</h2>
              <p>
                {
                  [
                    "Understand the process, people and opportunity.",
                    "Test an improvement against a measurable baseline.",
                    "Prepare ownership, access, support and adoption.",
                  ][i]
                }
              </p>
              <Button
                disabled={!access?.permissions.includes("projects.create")}
                onClick={() =>
                  void onCreate({
                    name,
                    description:
                      "Working template — tailor it with the process owner.",
                    status: "Planning",
                    category: "Function onboarding",
                    location: "",
                    latitude: null,
                    longitude: null,
                    dueDate: "",
                    color: "orange",
                    tasks: [
                      "Name the process owner and sponsor",
                      "Document the current process and pain points",
                      "Agree baseline, target and measurement period",
                      "Confirm data access and project participants",
                      "Run a bounded pilot and review results",
                      "Agree support ownership and rollout decision",
                    ].map((title) => ({
                      id: crypto.randomUUID(),
                      title,
                      done: false,
                    })),
                    onboardingStage: "Discovery",
                    nextAction:
                      "Meet the process owner and agree the opportunity.",
                  }).then((p) => {
                    if (p) onOpen(p);
                  })
                }
              >
                Use playbook
              </Button>
            </article>
          ))}
        </div>
      )}
      {tab === "proposals" && (
        <section className="suite-card">
          <span className="suite-badge">FLIGHTDECK AI · NOT CONNECTED</span>
          <h2>AI proposal inbox</h2>
          <p>
            FlightDeck’s AI service will return evidence-linked draft actions
            here. You will review owners, dates and priorities before applying
            changes.
          </p>
          <p className="hub-muted">
            No AI proposals have been generated. Today & advisor continues to
            offer rule-based watch-outs.
          </p>
          <a href="/integration">
            View integration requirements <ExternalLink size={14} />
          </a>
        </section>
      )}
    </main>
  );
}
