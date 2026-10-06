// The built Worker (`npm start`, no vite dev shim in front) must not accept
// forged oai-authenticated-user-* headers unless the deployment says it sits
// behind the Sites hosting dispatcher (ATLAS_DEPLOYMENT=hosted).
// Needs a build: run `npm run build` first; skipped when dist/ is absent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const built = existsSync(path.join(root, "dist/server/wrangler.json"));
const FORGED_EMAIL = "forged-admin@sites.test";
const forged = {
  "oai-authenticated-user-id": "forged_user",
  "oai-authenticated-user-email": FORGED_EMAIL,
  "oai-authenticated-user-full-name": "Forged",
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startWorker(vars) {
  const port = await freePort();
  const env = { ...process.env };
  delete env.ATLAS_DEPLOYMENT;
  const varArgs = Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]);
  // `npm start` exactly as documented, plus a free port and the vars under test.
  const child = spawn(
    "npm",
    ["start", "--silent", "--", "--port", String(port), ...varArgs],
    { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const base = `http://127.0.0.1:${port}`;
  const stop = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // already gone
    }
  };
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      await fetch(`${base}/api/access`, { redirect: "manual" });
      return { base, stop };
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  stop();
  throw new Error(`npm start did not come up on ${base}:\n${output}`);
}

test("built Worker without ATLAS_DEPLOYMENT ignores forged identity headers", { skip: !built && "dist/ is absent; run npm run build", timeout: 180_000 }, async () => {
  const worker = await startWorker({ ATLAS_SUPERADMIN_EMAIL: FORGED_EMAIL });
  try {
    const api = await fetch(`${worker.base}/api/access`, { headers: forged, redirect: "manual" });
    assert.equal(api.status, 401, "the Super Admin API must answer as unauthenticated");
    assert.deepEqual(await api.json(), { error: "Sign in to continue." });

    const page = await fetch(`${worker.base}/`, { headers: forged, redirect: "manual" });
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Sign-in is not available in this deployment/);
    assert.doesNotMatch(html, /Access requires a grant/);

    const anonymous = await fetch(`${worker.base}/`, { redirect: "manual" });
    assert.equal(anonymous.status, 200, "no redirect to a sign-in route that does not exist here");
    assert.equal(anonymous.headers.get("location"), null);
    assert.match(await anonymous.text(), /Sign-in is not available in this deployment/);
  } finally {
    worker.stop();
  }
});

test("built Worker with ATLAS_DEPLOYMENT=hosted keeps trusting the dispatcher's identity headers", { skip: !built && "dist/ is absent; run npm run build", timeout: 180_000 }, async () => {
  const worker = await startWorker({ ATLAS_SUPERADMIN_EMAIL: FORGED_EMAIL, ATLAS_DEPLOYMENT: "hosted" });
  try {
    const api = await fetch(`${worker.base}/api/access`, { headers: forged, redirect: "manual" });
    assert.notEqual(api.status, 401, "hosted: the identity headers are the platform's and are read");

    const anonymous = await fetch(`${worker.base}/`, { redirect: "manual" });
    assert.equal(anonymous.status, 307);
    assert.match(anonymous.headers.get("location") ?? "", /^\/signin-with-chatgpt\?return_to=/);
  } finally {
    worker.stop();
  }
});
