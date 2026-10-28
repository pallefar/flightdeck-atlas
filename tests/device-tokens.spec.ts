import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { ChainDb } from "../lib/audit/chain";
import {
  hashToken,
  listDeviceTokens,
  mintDeviceToken,
  newToken,
  revokeDeviceToken,
  sameHash,
  touchDeviceToken,
  verifyDeviceToken,
} from "../lib/auth/device-tokens";

// Device tokens for the native clients. The promise: a token is stored only
// as a hash, it maps to an existing grant, and revoking either the token or
// the member denies the next request. These tests run the real module over a
// database built from the migrations.
const AT = "2026-10-29T08:00:00.000Z";
function store() {
  const dir = new URL("../drizzle/", import.meta.url);
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(dir)
    .filter((n) => /^\d{4}_\w+\.sql$/.test(n))
    .sort())
    for (const statement of readFileSync(new URL(name, dir), "utf8").split(
      "--> statement-breakpoint",
    ))
      sqlite.exec(statement);
  const db: ChainDb = {
    prepare(sql) {
      return {
        bind(...values) {
          const statement = sqlite.prepare(sql);
          const args = values as SQLInputValue[];
          return {
            async first<T>() {
              return (statement.get(...args) as T | undefined) ?? null;
            },
            async all<T>() {
              return { results: statement.all(...args) as T[] };
            },
            async run() {
              return { meta: { changes: Number(statement.run(...args).changes) } };
            },
          };
        },
      };
    },
  };
  return { db, sqlite };
}
async function minted(options: { db?: ChainDb; sqlite?: DatabaseSync } = {}) {
  const { db, sqlite } = options.db ? { db: options.db, sqlite: options.sqlite! } : store();
  const mint = await mintDeviceToken(db, {
    id: "tok-1",
    label: "macOS app",
    email: "owner@example.test",
    roleId: "admin",
    createdBy: "admin@example.test",
    at: AT,
  });
  return { db, sqlite, token: mint.token };
}
test.describe("minting and verifying", () => {
  test("only the hash is stored, never the token", async () => {
    const { sqlite, token } = await minted();
    const row = sqlite.prepare("SELECT token_hash FROM atlas_device_tokens").get() as {
      token_hash: string;
    };
    expect(row.token_hash).toBe(await hashToken(token));
    expect(row.token_hash).not.toBe(token);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });
  test("a valid token resolves to its grant", async () => {
    const { db, token } = await minted();
    const grant = await verifyDeviceToken(db, token);
    expect(grant).toMatchObject({ id: "tok-1", email: "owner@example.test", roleId: "admin" });
  });
  test("an unknown or malformed token resolves to nothing", async () => {
    const { db } = await minted();
    expect(await verifyDeviceToken(db, newToken())).toBeNull();
    expect(await verifyDeviceToken(db, "not-a-token")).toBeNull();
    expect(await verifyDeviceToken(db, "")).toBeNull();
  });
  test("a revoked token stops verifying immediately", async () => {
    const { db, token } = await minted();
    expect(await revokeDeviceToken(db, "tok-1", AT)).toBe(true);
    expect(await verifyDeviceToken(db, token)).toBeNull();
    // Revoking twice is not an error, it is a no-op that reports itself.
    expect(await revokeDeviceToken(db, "tok-1", AT)).toBe(false);
  });
  test("last use is recorded, and a failure there never fails the caller", async () => {
    const { db, sqlite, token } = await minted();
    await touchDeviceToken(db, "tok-1", AT);
    const row = sqlite.prepare("SELECT last_used_at FROM atlas_device_tokens").get() as {
      last_used_at: string | null;
    };
    expect(row.last_used_at).toBe(AT);
    await expect(touchDeviceToken({ prepare: () => { throw new Error("down"); } } as never, "tok-1", AT)).resolves.toBeUndefined();
    expect(await verifyDeviceToken(db, token)).not.toBeNull();
  });
  test("the list never contains a token or a hash", async () => {
    const { db, token } = await minted();
    const list = await listDeviceTokens(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: "macOS app", email: "owner@example.test", revoked: false });
    const serialised = JSON.stringify(list);
    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain(await hashToken(token));
  });
});
test.describe("comparison", () => {
  test("equal hashes match; different lengths and values do not", () => {
    expect(sameHash("abc", "abc")).toBe(true);
    expect(sameHash("abc", "abd")).toBe(false);
    expect(sameHash("abc", "abcd")).toBe(false);
  });
});
