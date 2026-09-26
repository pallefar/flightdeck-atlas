"use client";
// apps-33: reads the apps directory for the OS project Atlas has selected
// (apps-32, fails closed) and renders the minimal About page for one app.
import { OsAppAboutView } from "@/components/os-app-about";
import { flightdeckSection } from "@/lib/flightdeck/app-card";
import { useAppsDirectory } from "@/lib/flightdeck/apps-directory-client";
import { useFlightDeckContext } from "../../../flightdeck-context-switcher";

export default function OsAppAbout({ id }: { id: string }) {
  // The context route answers not_permitted to anyone but the Super Admin,
  // who alone has a selection; everyone else gets the honest message.
  const context = useFlightDeckContext(true);
  const directory = useAppsDirectory(context.selected);
  const view = flightdeckSection({
    contextEnabled: context.state !== "not_permitted",
    context,
    directory,
    query: "",
    favourites: [],
  });
  return (
    <OsAppAboutView
      id={id}
      view={view}
      confirming={context.saving}
      onConfirm={(selection) =>
        void context
          .choose({
            osWorkspaceId: selection.osWorkspaceId,
            osProjectId: selection.osProjectId,
          })
          // Same selection, so the directory hook will not refetch by
          // itself: read it again now that it is saved.
          .then(() => directory.reload())
      }
    />
  );
}
