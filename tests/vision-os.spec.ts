import { test, expect } from "@playwright/test";
import { flightdeckApp } from "../lib/collaboration";
import { visionCardFor, visionCardConfig, catalogWithVisionCard, visionMenuUrl, VISION_APP_ID } from "../lib/flightdeck/vision-card";
import { visionProjectionSchema, visionTransition, projectionRefusal, type VisionProjection } from "../lib/flightdeck/vision";

const owner = { userId: "trusted-provider-principal", email: "karsten.haldan@gmail.com", superAdmin: false };
const url = "https://os.example.test/console/vision?standalone=1";
const projection: VisionProjection = {
  schema: "vision-projection/1", workspaceId: "te-ops", projectId: "hr-pilot",
  enrolled: true, status: "approved", canActivate: true, canOperate: true, canDeliver: true,
  assessmentRevision: 2, visionRevision: 1, approvedGoals: ["Improve HR service quality"], requiredActions: [],
  checkedAt: new Date().toISOString(),
  approvedStage: "Pilot", pendingStage: null, deliveryStatus: "In progress", atlasRevision: 1,
};

test("only the two trusted owner identities receive the reserved standalone card", () => {
  const config = visionCardConfig(url);
  for (const email of ["karsten.haldan@gmail.com", "karsten.haldan@te.com"])
    expect(visionCardFor({ ...owner, email }, config)).toMatchObject({ id: VISION_APP_ID, url, newTab: true });
  for (const viewer of [
    { ...owner, email: "other@example.test", superAdmin: true },
    { ...owner, email: "" }, { ...owner, userId: "" },
  ]) expect(visionCardFor(viewer, config)).toBeNull();
});

test("Vision configuration fails closed and never accepts credentials or a non-local HTTP URL", () => {
  for (const bad of [undefined, "", "javascript:alert(1)", "http://os.example.test/console/vision", "https://owner:secret@os.example.test/console/vision"])
    expect(visionCardConfig(bad)).toBeNull();
  expect(visionCardConfig("http://127.0.0.1:4173/console/vision?standalone=1")).not.toBeNull();
});

test("a stored forged Vision row is hidden even from a general administrator", () => {
  const forged = { ...flightdeckApp, id: VISION_APP_ID, name: "Fake private app", url: "https://evil.example.test" };
  expect(catalogWithVisionCard([flightdeckApp, forged], { ...owner, email: "admin@example.test", superAdmin: true }, visionCardConfig(url))).toEqual([flightdeckApp]);
  expect(catalogWithVisionCard([forged], owner, visionCardConfig(url))).toHaveLength(1);
  expect(catalogWithVisionCard([forged], owner, null)).toEqual([]);
});

test("the account action requires both current Super Admin role and an owner-approved reserved card", () => {
  const config = visionCardConfig(url);
  for (const email of ["karsten.haldan@gmail.com", "karsten.haldan@te.com"]) {
    const allowed = catalogWithVisionCard([], { ...owner, email, superAdmin: true }, config);
    expect(visionMenuUrl(true, allowed)).toBe(url);
    expect(visionMenuUrl(false, allowed)).toBeNull();
  }
  const forged = { ...flightdeckApp, id: VISION_APP_ID, url, reserved: true };
  for (const viewer of [{ ...owner, email: "admin@example.test", superAdmin: true }, { ...owner, email: "member@example.test", superAdmin: false }]) {
    const catalog = catalogWithVisionCard([forged], viewer, config);
    expect(visionMenuUrl(!!viewer.superAdmin, catalog)).toBeNull();
  }
  expect(visionMenuUrl(true, [{ ...flightdeckApp, id: VISION_APP_ID, url }])).toBeNull();
});

test("the account action validates URLs and retains a browser-only loopback destination unchanged", () => {
  for (const value of [undefined, "", "javascript:alert(1)", "http://os.example.test/console/vision", "https://owner:secret@os.example.test/console/vision"]) {
    const catalog = catalogWithVisionCard([], { ...owner, superAdmin: true }, visionCardConfig(value));
    expect(visionMenuUrl(true, catalog)).toBeNull();
  }
  const local = "http://127.0.0.1:4173/console/vision?standalone=1";
  const catalog = catalogWithVisionCard([], { ...owner, superAdmin: true }, visionCardConfig(local));
  expect(visionMenuUrl(true, catalog)).toBe(local);
});

test("the approved projection rejects private fields, incoherent enrollment and unknown states", () => {
  expect(visionProjectionSchema.safeParse(projection).success).toBe(true);
  for (const extra of [{ answers: [] }, { evidence: "private" }, { sourceDocuments: [] }, { ownerEmail: owner.email }])
    expect(visionProjectionSchema.safeParse({ ...projection, ...extra }).success).toBe(false);
  expect(visionProjectionSchema.safeParse({ ...projection, status: "unknown" }).success).toBe(false);
  expect(visionProjectionSchema.safeParse({ ...projection, enrolled: false }).success).toBe(false);
});

test("unrelated projects stay unaffected while enrolled projects require approval for activation", () => {
  const transition = { activation: true, nextDelivery: false };
  expect(projectionRefusal({ ...projection, enrolled: false, status: "not_required", canActivate: true, canDeliver: true }, transition)).toBeNull();
  expect(projectionRefusal({ ...projection, status: "pending", canActivate: false, canDeliver: false }, transition)?.code).toBe("vision_assessment_required");
  expect(projectionRefusal(projection, transition)).toBeNull();
});

test("an existing active project may continue current work but cannot pass its next delivery gate", () => {
  const pending = { ...projection, status: "review_due" as const, canActivate: true, canDeliver: false };
  expect(projectionRefusal(pending, { activation: false, nextDelivery: false })).toBeNull();
  expect(projectionRefusal(pending, { activation: false, nextDelivery: true })?.code).toBe("vision_delivery_review_required");
  expect(visionTransition({ status: "In progress", onboardingStage: "Pilot" }, { status: "In progress", onboardingStage: "Pilot" })).toEqual({ activation: false, nextDelivery: false });
  expect(visionTransition({ status: "Planning" }, { status: "In progress" }).activation).toBe(true);
  expect(visionTransition({ status: "In progress" }, { status: "Completed" }).nextDelivery).toBe(true);
  expect(visionTransition({ status: "In progress", onboardingStage: "Pilot" }, { status: "In progress", onboardingStage: "Ready for FlightDeck" }).nextDelivery).toBe(true);
});
