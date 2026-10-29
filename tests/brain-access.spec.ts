import { test, expect } from "@playwright/test";
import {
  assignmentsFrom,
  canAssignRoles,
  canCreateIn,
  canCreateWorkspace,
  canEdit,
  canView,
  effectiveProcessOwner,
  gateRefusal,
  isWorkspaceAdmin,
  type Actor,
} from "../lib/onboarding/access";
import type { ProjectRole } from "../lib/onboarding/roles";

// The owner's rule (2026-10-29), as rules rather than prose:
//  - only an Admin or a project's owner uses the brain;
//  - the Super Admin chooses the workspace; an Admin creates only in a
//    workspace they administer;
//  - an owner works on their own project or process, not someone else's;
//  - a gate needs BOTH the permission and the assignment for this project.
const actor = (over: Partial<Actor> = {}): Actor => ({
  email: "owner@example.test",
  superAdmin: false,
  permissions: [
    "onboarding.view",
    "onboarding.create",
    "onboarding.triage",
    "onboarding.gate.process_owner",
    "onboarding.gate.teoa",
    "onboarding.gate.vision",
    "onboarding.value.edit",
  ],
  ...over,
});
const roles = (over: Record<string, "admin" | "member"> = {}) => ({ general: "admin" as const, ...over });
const ROLE_OF: Record<string, ProjectRole> = {
  owner: "owner",
  processOwner: "process_owner",
  teoaApprover: "teoa_approver",
  visionApprover: "vision_approver",
};
const assigned = (over: Partial<Record<string, string>> = {}) =>
  assignmentsFrom([
    { role: "owner", email: "owner@example.test" },
    { role: "process_owner", email: "process@example.test" },
    { role: "teoa_approver", email: "teoa@example.test" },
    { role: "vision_approver", email: "vision@example.test" },
    ...Object.entries(over)
      .filter(([key]) => ROLE_OF[key] !== undefined)
      .map(([key, email]) => ({ role: ROLE_OF[key], email: String(email) })),
  ]);
test.describe("who may use the brain", () => {
  test("a workspace member may read; someone in no workspace and no assignment may not", () => {
    expect(canView(actor(), { workspaceId: "general", roles: roles(), assignments: assigned() })).toBe(true);
    // `roles` is THIS actor's workspace membership, so a stranger has none.
    expect(
      canView(actor({ email: "stranger@example.test" }), {
        workspaceId: "general",
        roles: {},
        assignments: assigned(),
      }),
    ).toBe(false);
  });
  test("a project role alone is enough to read, even outside the workspace", () => {
    expect(
      canView(actor({ email: "process@example.test" }), {
        workspaceId: "general",
        roles: {},
        assignments: assigned(),
      }),
    ).toBe(true);
  });
  test("without the view permission, even a member cannot read", () => {
    expect(
      canView(actor({ permissions: ["onboarding.create"] }), {
        workspaceId: "general",
        roles: roles(),
        assignments: assigned(),
      }),
    ).toBe(false);
  });
  test("the Super Admin may read any workspace", () => {
    expect(
      canView(actor({ superAdmin: true, email: "root@example.test" }), {
        workspaceId: "elsewhere",
        roles: {},
        assignments: assigned(),
      }),
    ).toBe(true);
  });
});
test.describe("creating", () => {
  test("only the Super Admin creates a workspace", () => {
    expect(canCreateWorkspace(actor())).toBe(false);
    expect(canCreateWorkspace(actor({ superAdmin: true }))).toBe(true);
  });
  test("an Admin creates in their workspace and nowhere else", () => {
    expect(canCreateIn(actor(), "general", roles())).toBe(true);
    expect(canCreateIn(actor(), "other", roles())).toBe(false);
    expect(isWorkspaceAdmin(roles({ other: "member" }), "other")).toBe(false);
  });
  test("the Super Admin creates anywhere", () => {
    expect(canCreateIn(actor({ superAdmin: true }), "anywhere", {})).toBe(true);
  });
  test("a member without the create permission cannot create", () => {
    expect(canCreateIn(actor({ permissions: ["onboarding.view"] }), "general", roles())).toBe(false);
  });
});
test.describe("editing", () => {
  test("the owner edits their own project", () => {
    expect(canEdit(actor(), { workspaceId: "general", roles: {}, assignments: assigned() })).toBe(true);
  });
  test("someone else cannot edit it, even in the same workspace", () => {
    expect(
      canEdit(actor({ email: "process@example.test" }), {
        workspaceId: "general",
        roles: {},
        assignments: assigned(),
      }),
    ).toBe(false);
  });
  test("a workspace admin may edit a project in their workspace", () => {
    expect(
      canEdit(actor({ email: "admin@example.test", superAdmin: false }), {
        workspaceId: "general",
        roles: roles(),
        assignments: assigned(),
      }),
    ).toBe(true);
  });
  test("the Super Admin edits anything", () => {
    expect(
      canEdit(actor({ superAdmin: true }), {
        workspaceId: null,
        roles: {},
        assignments: assigned(),
      }),
    ).toBe(true);
  });
});
test.describe("assigning", () => {
  test("an owner cannot assign, or they could hand themselves an approval", () => {
    expect(
      canAssignRoles(actor(), { workspaceId: "general", roles: {} }),
    ).toBe(false);
  });
  test("a workspace admin assigns; the Super Admin assigns", () => {
    expect(
      canAssignRoles(actor({ email: "admin@example.test" }), {
        workspaceId: "general",
        roles: roles(),
      }),
    ).toBe(true);
    expect(
      canAssignRoles(actor({ superAdmin: true }), { workspaceId: null, roles: {} }),
    ).toBe(true);
  });
});
test.describe("gates need both permission and assignment", () => {
  test("the owner passes the intake gate on their project", () => {
    expect(
      gateRefusal(actor(), "intake", {
        workspaceId: "general",
        roles: {},
        assignments: assigned(),
      }),
    ).toBeNull();
  });
  test("the owner cannot pass the process owner's gate", () => {
    expect(
      gateRefusal(actor(), "as-is", {
        workspaceId: "general",
        roles: {},
        assignments: assigned(),
      }),
    ).toBe("assignment_required");
  });
  test("the process owner passes it; someone with the permission but no assignment does not", () => {
    expect(
      gateRefusal(actor({ email: "process@example.test" }), "as-is", {
        workspaceId: "general",
        roles: {},
        assignments: assigned(),
      }),
    ).toBeNull();
    expect(
      gateRefusal(actor({ email: "other@example.test" }), "as-is", {
        workspaceId: "general",
        roles: {},
        assignments: assigned(),
      }),
    ).toBe("assignment_required");
  });
  test("without the permission, an assignment is not enough", () => {
    expect(
      gateRefusal(actor({ email: "process@example.test", permissions: ["onboarding.view"] }), "value", {
        workspaceId: "general",
        roles: {},
        assignments: assigned(),
      }),
    ).toBe("gate_role_required");
  });
  test("alignment needs both approvers, and one person cannot stand in for the other", () => {
    const bothAssignedToOne = assignmentsFrom([
      { role: "owner", email: "owner@example.test" },
      { role: "teoa_approver", email: "both@example.test" },
      { role: "vision_approver", email: "vision@example.test" },
    ]);
    expect(
      gateRefusal(actor({ email: "both@example.test" }), "aligned", {
        workspaceId: "general",
        roles: {},
        assignments: bothAssignedToOne,
      }),
    ).toBe("assignment_required");
  });
  test("each approver alone is refused; the person assigned both passes", () => {
    const one = assignmentsFrom([
      { role: "owner", email: "owner@example.test" },
      { role: "teoa_approver", email: "teoa@example.test" },
      { role: "vision_approver", email: "vision@example.test" },
    ]);
    expect(gateRefusal(actor({ email: "teoa@example.test" }), "aligned", { workspaceId: "general", roles: {}, assignments: one })).toBe("assignment_required");
    const both = assignmentsFrom([
      { role: "owner", email: "owner@example.test" },
      { role: "teoa_approver", email: "both@example.test" },
      { role: "vision_approver", email: "both@example.test" },
    ]);
    expect(gateRefusal(actor({ email: "both@example.test" }), "aligned", { workspaceId: "general", roles: {}, assignments: both })).toBeNull();
  });
  test("the Super Admin passes any gate", () => {
    expect(
      gateRefusal(actor({ superAdmin: true }), "aligned", {
        workspaceId: null,
        roles: {},
        assignments: assignmentsFrom([]),
      }),
    ).toBeNull();
  });
  test("the process owner falls back to the owner, the approvers never do", () => {
    const onlyOwner = assignmentsFrom([{ role: "owner", email: "owner@example.test" }]);
    expect(effectiveProcessOwner(onlyOwner)).toBe("owner@example.test");
    expect(
      gateRefusal(actor(), "aligned", { workspaceId: "general", roles: {}, assignments: onlyOwner }),
    ).toBe("assignment_required");
  });
});
