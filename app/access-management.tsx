"use client";
import { useEffect, useState } from "react";
import { KeyRound, Plus, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { permissionLabels, type Permission } from "@/lib/access-policy";
type Role = {
  id: string;
  name: string;
  permissions: Permission[];
  builtin: number;
};
type AccessData = {
  superAdmin: string;
  roles: Role[];
  members: {
    email: string;
    role_id: string;
    role_name: string;
    joined: number;
    disabled: number;
  }[];
  events: { action: string; target: string; created_at: string }[];
};
export default function AccessManagement() {
  const [data, setData] = useState<AccessData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [email, setEmail] = useState(""),
    [role, setRole] = useState("owner"),
    [name, setName] = useState("");
  const [grants, setGrants] = useState<Permission[]>([
    "projects.read",
    "briefings.read",
  ]);
  async function load() {
    const r = await fetch("/api/access");
    const body = (await r.json()) as AccessData & { error?: string };
    if (!r.ok) throw Error(body.error || "Access could not be loaded.");
    setData(body);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function change(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(result.error || "Change could not be saved.");
      await load();
      setMessage(success);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="hub-page">
      <header className="hub-heading">
        <div>
          <span className="eyebrow">ATLAS MASTER APP</span>
          <h1>People & access</h1>
          <p>You grant access. Roles define what each person can do.</p>
        </div>
        <ShieldCheck className="hub-heading-icon" size={34} />
      </header>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="access-success" role="status">
          {message}
        </p>
      )}
      <div className="access-owner hub-card">
        <ShieldCheck size={24} />
        <div>
          <strong>Super Admin · you</strong>
          <span>{data?.superAdmin || "Loading your account…"}</span>
        </div>
        <span className="status planning">Protected role</span>
      </div>
      <p className="access-note">
        Only the Super Admin can grant or revoke access and create roles. The
        hosted preview is also private: users need its sharing access before
        they can reach Atlas. An Atlas role does not change that hosting gate or
        send an invitation email.
      </p>
      <div className="access-grid">
        <section className="hub-card">
          <h2>
            <UserPlus size={18} /> Grant dashboard access
          </h2>
          <form
            className="access-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await change(
                  { action: "grant", email, roleId: role },
                  "Atlas access granted. Arrange private-site sharing separately before the user signs in.",
                )
              )
                setEmail("");
            }}
          >
            <label>
              Sign-in email
              <Input
                type="email"
                required
                maxLength={254}
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {data?.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={busy || !data} type="submit">
              <Plus size={16} /> Grant access
            </Button>
          </form>
        </section>
        <section className="hub-card">
          <h2>
            <KeyRound size={18} /> Create a role
          </h2>
          <form
            className="access-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await change(
                  { action: "create-role", name, permissions: grants },
                  "Role created. You can now assign it to users.",
                )
              ) {
                setName("");
                setGrants(["projects.read", "briefings.read"]);
              }
            }}
          >
            <label>
              Role name
              <Input
                required
                minLength={2}
                maxLength={50}
                placeholder="Portfolio reviewer"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <fieldset className="role-permissions">
              <legend>Permissions</legend>
              {Object.entries(permissionLabels).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={grants.includes(key as Permission)}
                    disabled={key === "projects.read" || busy}
                    onChange={(e) => {
                      let next = e.target.checked
                        ? [...grants, key as Permission]
                        : grants.filter((p) => p !== key);
                      if (
                        e.target.checked &&
                        key.startsWith("projects.archive_")
                      )
                        next.push(
                          key.replace("archive_", "edit_") as Permission,
                        );
                      if (!e.target.checked && key === "projects.edit_all")
                        next = next.filter((p) => p !== "projects.archive_all");
                      if (
                        !next.includes("projects.edit_all") &&
                        !next.includes("projects.edit_own")
                      )
                        next = next.filter((p) => p !== "projects.archive_own");
                      setGrants([...new Set(next)]);
                    }}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <p className="hub-muted">
              Access administration always stays with you; custom roles cannot
              grant themselves that authority. Archiving includes the matching
              edit permission.
            </p>
            <Button type="submit" disabled={busy || !data}>
              Create role
            </Button>
          </form>
        </section>
      </div>
      <section className="hub-card">
        <h2>People</h2>
        {data?.members.map((m) => (
          <div className="member-row" key={m.email}>
            <span>
              <strong>{m.email}</strong>
              <small>
                {m.disabled
                  ? "Access revoked"
                  : m.joined
                    ? "Joined Atlas"
                    : "Granted · awaiting first sign-in"}
              </small>
            </span>
            <select
              aria-label={`Role for ${m.email}`}
              disabled={busy || !!m.disabled}
              value={m.role_id}
              onChange={(e) =>
                void change(
                  { action: "grant", email: m.email, roleId: e.target.value },
                  `Role updated for ${m.email}.`,
                )
              }
            >
              {data.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <button
              disabled={busy}
              className="text-link"
              onClick={() =>
                void change(
                  m.disabled
                    ? { action: "grant", email: m.email, roleId: m.role_id }
                    : { action: "revoke", email: m.email },
                  m.disabled
                    ? "Access restored."
                    : "Access revoked. Future requests are blocked.",
                )
              }
            >
              {m.disabled ? "Restore" : "Revoke"}
            </button>
          </div>
        ))}
        {!data?.members.length && (
          <p className="hub-muted">
            No additional users yet. Grant a role to their sign-in email above.
          </p>
        )}
      </section>
      <section className="hub-card">
        <h2>Available roles</h2>
        <div className="role-grid">
          {data?.roles.map((r) => (
            <article key={r.id}>
              <strong>{r.name}</strong>
              <span>{r.builtin ? "Built-in" : "Custom"}</span>
              <ul>
                {r.permissions.map((p) => (
                  <li key={p}>{permissionLabels[p]}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
      <section className="hub-card">
        <h2>Access history</h2>
        {data?.events.map((e, i) => (
          <div className="access-event" key={`${e.created_at}-${i}`}>
            <span>
              <strong>{e.action}</strong> · {e.target}
            </span>
            <time>{new Date(e.created_at).toLocaleString()}</time>
          </div>
        ))}
        {!data?.events.length && (
          <p className="hub-muted">
            Your grants and role changes will be recorded here.
          </p>
        )}
      </section>
    </main>
  );
}
