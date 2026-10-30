import { test, expect } from "@playwright/test";
import { registerAtlas, type SubAppRegistry } from "../lib/suite/registration";

const registry = (): SubAppRegistry => ({
  schema: "subapp-registry/1",
  installs: [
    { id: "docusign", version: "0.1.0", enabled: true, installedAt: "x", installedBy: "uat", grantedScopes: [] },
    { id: "maps", version: "0.1.0", enabled: true, installedAt: "x", installedBy: "uat", grantedScopes: [] },
  ],
});

test("Atlas joins the registry with a base URL and an entry that names a project", () => {
  const { registry: next, added } = registerAtlas(registry(), "https://atlas.test/", "1.0.1", "2026-10-30T10:00:00.000Z");
  expect(added).toBe(true);
  const atlas = next.installs.find((install) => install.id === "atlas");
  expect(atlas).toEqual({
    id: "atlas",
    version: "1.0.1",
    enabled: true,
    installedAt: "2026-10-30T10:00:00.000Z",
    installedBy: "atlas-release",
    grantedScopes: [],
    // A trailing slash is removed, so joining a path never doubles it.
    baseUrl: "https://atlas.test",
    entry: "/?view=brain&project={project}",
  });
  // The other installs are untouched: this is an addition, not a rewrite.
  expect(next.installs).toHaveLength(3);
});

test("a second run is a no-op, not a second Atlas", () => {
  const once = registerAtlas(registry(), "https://atlas.test", "1.0.1", "2026-10-30T10:00:00.000Z");
  const twice = registerAtlas(once.registry, "https://other.test", "9.9.9", "2026-11-01T10:00:00.000Z");
  expect(twice.added).toBe(false);
  expect(twice.registry).toBe(once.registry);
  expect(twice.registry.installs.filter((install) => install.id === "atlas")).toHaveLength(1);
});
