// /apps/os/<id>: Atlas's page for one FlightDeck OS app (apps-33 minimal,
// the target of the 9-dot cards' See more and locked links). apps-34
// replaces it with the published release from the inbound bridge projection.
import OsAppAbout from "./os-app-about";

export const dynamic = "force-dynamic";

export default async function OsAppPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let shown = id;
  try {
    shown = decodeURIComponent(id); // OS ids are [a-z0-9-]; a bad escape is just not listed
  } catch {}
  return <OsAppAbout id={shown} />;
}
