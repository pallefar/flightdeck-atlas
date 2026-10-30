/**
 * Atlas's entry in the OS's sub-app registry (`subapps.json`, schema
 * `subapp-registry/1`).
 *
 * The registry lives in another repo, so this is a pure function rather than an
 * import: it says exactly what Atlas's entry is, and whether it is already
 * there. Applying it is a separate, deliberate act — the registry is a shared
 * file, and nobody's uncommitted work should be swept up by a tool.
 */
export type SubAppInstall = {
  id: string;
  version: string;
  enabled: boolean;
  installedAt: string;
  installedBy: string;
  grantedScopes: string[];
  baseUrl?: string;
  entry?: string;
};
export type SubAppRegistry = {
  schema: string;
  installs: SubAppInstall[];
  [key: string]: unknown;
};

/** The entry Atlas should have. `entry` sends the person to a project's brain. */
export function atlasInstall(baseUrl: string, version: string, at: string): SubAppInstall {
  return {
    id: "atlas",
    version,
    enabled: true,
    installedAt: at,
    installedBy: "atlas-release",
    grantedScopes: [],
    baseUrl: baseUrl.replace(/\/+$/, ""),
    entry: "/?view=brain&project={project}",
  };
}

/** The registry with Atlas in it, and whether that changed anything. A second
 * run is a no-op: the first install is kept, not rewritten. */
export function registerAtlas(
  registry: SubAppRegistry,
  baseUrl: string,
  version: string,
  at: string,
): { registry: SubAppRegistry; added: boolean } {
  if (registry.installs.some((install) => install.id === "atlas"))
    return { registry, added: false };
  return {
    registry: { ...registry, installs: [...registry.installs, atlasInstall(baseUrl, version, at)] },
    added: true,
  };
}
