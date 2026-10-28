// Worker wiring for the onboarding brain. Server-only: it resolves the real
// authorisation, the real project policy and the D1 binding, and hands them to
// the handlers in lib/onboarding/routes.ts, which the tests run unchanged.
import type { ChainDb } from "../audit/chain";
import { authorize } from "../access";
import type { Permission } from "../access-policy";
import { projectFor, visibleProjects } from "../project-access";
import { database } from "../server-projects";
import { createOnboardingRoutes, type BrainAccess } from "./routes";
/** The D1 binding, resolved on first use: importing this module must not
 * require a database (route files import it at build time). */
const db = {
  prepare(query: string) {
    return database().prepare(query);
  },
} as ChainDb;
export const onboardingRoutes = createOnboardingRoutes({
  authorize: (permission?: Permission) => authorize(permission) as Promise<
    { access: BrainAccess } | { error: Response }
  >,
  async loadProject(access, id) {
    const found = await projectFor(access as never, id);
    return found
      ? { id: found.project.id, name: found.project.name, revision: found.project.revision }
      : null;
  },
  async canEdit(access, id) {
    const found = await projectFor(access as never, id);
    return Boolean(found?.rights.edit);
  },
  async visibleIds(access) {
    const projects = await visibleProjects(access as never);
    return new Set(projects.map((p) => p.id));
  },
  db,
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
});
