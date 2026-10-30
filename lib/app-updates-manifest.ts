// The update manifest as code.
//
// `app-updates.json` is the published artifact (what a release process edits);
// this module is the same object, typed, so the Worker bundle and the Node test
// runner both read it without a JSON import attribute. A test asserts the two
// are identical, so the copy cannot drift.
export type Manifest = {
  schema: "atlas-app-updates/1";
  releases: {
    version: string;
    releasedAt: string;
    notes: string;
    url: string;
    sha256: string;
  }[];
};
export const manifest: Manifest = {
  schema: "atlas-app-updates/1",
  releases: [
    {
      version: "0.1.0",
      releasedAt: "2026-10-30T00:00:00.000Z",
      notes: "Onboarding wizard, pipeline, project brain, roles and the Atlas deep link.",
      url: "",
      sha256: "",
    },
  ],
};
