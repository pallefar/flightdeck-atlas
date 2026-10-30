import { authorize } from "@/lib/access";
import {
  CODE_TTL_MS,
  collectToken,
  deviceCodeState,
  newDeviceCode,
  type DeviceCodeRow,
} from "@/lib/auth/device-codes";
import { mintDeviceToken } from "@/lib/auth/device-tokens";
import { database } from "@/lib/server-projects";
import { json, sameOrigin } from "@/lib/http";
export const dynamic = "force-dynamic";

// Signing the app in without a token typed by a human.
//
// POST          start: no session, returns a code the person approves in a browser
// GET  ?code=   where the code stands: no token is ever returned here
// PUT           approve: a signed-in person, same-origin; mints the token
// POST ?collect the app collects the token once, and the row is deleted
const TTL_MS = CODE_TTL_MS;

const rowFrom = (row: Record<string, unknown> | null): DeviceCodeRow | null =>
  row
    ? {
        code: String(row.code),
        createdAt: String(row.created_at),
        expiresAt: String(row.expires_at),
        approvedBy: (row.approved_by as string) ?? null,
        approvedAt: (row.approved_at as string) ?? null,
        token: (row.token as string) ?? null,
        deliveredAt: (row.delivered_at as string) ?? null,
      }
    : null;

const readRow = async (code: string) =>
  rowFrom(
    (await database()
      .prepare("SELECT * FROM atlas_device_codes WHERE code = ?")
      .bind(code)
      .first()) as Record<string, unknown> | null,
  );

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!code) return json({ error: "Give the code to look up.", code: "code_required" }, 400);
  try {
    const state = deviceCodeState(await readRow(code), new Date());
    if (state === "unknown")
      return json({ error: "That code is not pending.", code: "unknown_code" }, 404);
    return json({ state });
  } catch {
    return json({ error: "The code could not be checked." }, 503);
  }
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  // Collection: the app, with no session, asks once for the token.
  if (url.searchParams.has("collect")) {
    const code = url.searchParams.get("code") ?? "";
    if (!code) return json({ error: "Give the code to collect.", code: "code_required" }, 400);
    try {
      const row = await readRow(code);
      const now = new Date();
      if (!row || deviceCodeState(row, now) !== "approved")
        return json({ error: "The code is not ready.", code: "not_ready" }, 409);
      const collected = collectToken(row, now);
      if ("error" in collected) return json({ error: collected.error, code: "not_ready" }, 409);
      // Delivered once: the row goes, so the token exists only in the app.
      await database().prepare("DELETE FROM atlas_device_codes WHERE code = ?").bind(code).run();
      return json({ token: collected.token }, 200);
    } catch {
      return json({ error: "The token could not be collected." }, 503);
    }
  }
  // Start: no session. A code, a deadline, and nothing else.
  try {
    const now = new Date();
    const code = newDeviceCode();
    await database()
      .prepare(
        "INSERT INTO atlas_device_codes (code, created_at, expires_at) VALUES (?,?,?)",
      )
      .bind(code, now.toISOString(), new Date(now.getTime() + TTL_MS).toISOString())
      .run();
    return json({ code, expiresAt: new Date(now.getTime() + TTL_MS).toISOString() }, 201);
  } catch {
    return json({ error: "A sign-in code could not be issued." }, 503);
  }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  const auth = await authorize(undefined, false, request);
  if (auth.error) return auth.error;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send a JSON body.", code: "bad_body" }, 400);
  }
  const code = typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code.trim() : "";
  if (!code) return json({ error: "Give the code to approve.", code: "code_required" }, 400);
  try {
    const db = database();
    const row = await readRow(code);
    const now = new Date();
    if (!row || deviceCodeState(row, now) !== "pending")
      return json({ error: "That code is not pending.", code: "not_pending" }, 409);
    const minted = await mintDeviceToken(db as never, {
      id: crypto.randomUUID(),
      label: "Atlas app (browser sign-in)",
      email: auth.access.email,
      roleId: auth.access.roleId,
      createdBy: auth.access.email,
      at: now.toISOString(),
    });
    await db
      .prepare(
        "UPDATE atlas_device_codes SET approved_by = ?, approved_at = ?, token = ? WHERE code = ?",
      )
      .bind(auth.access.email, now.toISOString(), minted.token, code)
      .run();
    return json({ approved: true, email: auth.access.email }, 200);
  } catch {
    return json({ error: "The code could not be approved." }, 503);
  }
}
