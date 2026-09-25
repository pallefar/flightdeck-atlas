// The real dependencies of the onboarding handlers (lib/flightdeck/
// onboard-route.ts): Atlas authorisation and project access, the OS clients
// and the D1 binding. Server-only.
import { authorize } from "../access";
import type { AccessProfile } from "../access-policy";
import { projectFor, visibleProjects } from "../project-access";
import { database, onboardingMetricsEnabled } from "../server-projects";
import { createOnboardRoute } from "./onboard-route";
import { atlasInstallationId, osReader, osSubmissions } from "./os-server";

export const onboardRoute = createOnboardRoute<AccessProfile>({
  authorize: () => authorize("projects.read"),
  async loadProject(access, id) {
    const found = await projectFor(access, id);
    return found
      ? { project: found.project, canEdit: found.rights.edit }
      : null;
  },
  async visibleProjectIds(access) {
    return (await visibleProjects(access)).map((p) => p.id);
  },
  reader: osReader,
  submissions: osSubmissions,
  db: database,
  installationId: atlasInstallationId,
  metricsEnabled: onboardingMetricsEnabled,
});
