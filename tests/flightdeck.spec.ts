import { test, expect } from "@playwright/test";
import {
  createFlightDeckReadAdapter,
  flightDeckProjectKey,
  mapFlightDeckProjects,
} from "../lib/flightdeck/adapter";
test("FlightDeck rejects anonymous 200 responses and workspace fallback", async () => {
  const anonymous = createFlightDeckReadAdapter(async () => ({
    required: true,
    bootstrap: false,
    principal: null,
    effectiveRole: null,
    memberships: [],
  }));
  await expect(anonymous.authMe("work-a")).rejects.toThrow(
    "approved FlightDeck session",
  );
  const wrong = createFlightDeckReadAdapter(async () => ({
    workspaceId: "te-ops",
    defaultProjectId: "general",
    projects: [],
  }));
  await expect(wrong.projects("work-a")).rejects.toThrow("different workspace");
});
test("FlightDeck mapping retains workspace identity and excludes disabled entries", () => {
  const result = mapFlightDeckProjects({
    workspaceId: "work-a",
    defaultProjectId: "general",
    projects: [
      {
        id: "general",
        label: "General",
        enabled: true,
        createdAt: "2026-09-17",
        isDefault: true,
        owners: [],
      },
      {
        id: "disabled",
        label: "Disabled",
        enabled: false,
        createdAt: "2026-09-17",
        isDefault: false,
        owners: [],
      },
    ],
  });
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("General");
  expect(flightDeckProjectKey("work-a", "general")).not.toBe(
    flightDeckProjectKey("work-b", "general"),
  );
  expect(result[0]).not.toHaveProperty("progress");
});
