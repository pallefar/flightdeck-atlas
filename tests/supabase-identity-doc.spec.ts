import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// docs/SUPABASE-IDENTITY-CONTRACT.md is the handoff for moving login to the
// shared Supabase Auth. Its connectivity section must describe the local
// instance as it actually runs, without leaking any key. No browser, no
// server: this reads the Markdown file only.
const doc = readFileSync(
  new URL("../docs/SUPABASE-IDENTITY-CONTRACT.md", import.meta.url),
  "utf8",
);

function section(heading: string) {
  const start = doc.indexOf(`## ${heading}\n`);
  expect(start, `missing section "${heading}"`).toBeGreaterThanOrEqual(0);
  const next = doc.indexOf("\n## ", start + 3);
  return doc.slice(start, next === -1 ? undefined : next);
}

test.describe("Supabase identity contract doc", () => {
  test("connectivity section records the running local GoTrue", () => {
    const connectivity = section("Local and hosted connectivity");
    expect(connectivity).not.toContain("No running Supabase container was found");
    expect(connectivity).toContain("v2.158.1");
    expect(connectivity).toContain("127.0.0.1:54324");
    expect(connectivity).toMatch(/loopback/i);
    expect(connectivity).toContain("auth_users");
    expect(connectivity).toMatch(/OS login has not moved/i);
  });

  test("the OAuth-server caveat and migration plan are still there", () => {
    expect(doc).toContain(
      "A native Supabase OAuth/OIDC server is an option only after verifying support in the installed version",
    );
    expect(section("Migrate identities without losing ownership")).toContain(
      "The OS team creates an explicit mapping",
    );
  });

  test("prints no keys or secrets", () => {
    expect(doc).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // JWT / anon / service key
    expect(doc).not.toMatch(/(GOTRUE_JWT_SECRET|SERVICE_ROLE_KEY|ANON_KEY)\s*[=:]/);
    expect(doc).not.toMatch(/postgres(ql)?:\/\/[^\s`]*:[^\s`@]+@/); // DSN with password
  });
});
