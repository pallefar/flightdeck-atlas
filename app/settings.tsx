"use client";
import { Globe2, LayoutDashboard, RotateCcw } from "lucide-react";
import { useTheme } from "next-themes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { defaultSettings, type AtlasSettings } from "@/lib/settings";
import type { ReactNode } from "react";

export default function Settings({
  open,
  onOpenChange,
  tab,
  onTabChange,
  settings,
  onChange,
  storageError,
  onReturnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: "dashboard" | "globe";
  onTabChange: (tab: "dashboard" | "globe") => void;
  settings: AtlasSettings;
  onChange: (next: AtlasSettings) => void;
  storageError: string;
  onReturnFocus: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const dashboard = settings.dashboard,
    globe = settings.globe;
  const setDashboard = (patch: Partial<AtlasSettings["dashboard"]>) =>
    onChange({ ...settings, dashboard: { ...dashboard, ...patch } });
  const setGlobe = (patch: Partial<AtlasSettings["globe"]>) =>
    onChange({ ...settings, globe: { ...globe, ...patch } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="settings-dialog"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onReturnFocus();
        }}
      >
        <header className="settings-heading">
          <span className="eyebrow">MAKE IT YOURS</span>
          <DialogTitle>Workspace settings</DialogTitle>
          <DialogDescription>
            Fine-tune your dashboard and your view of the world.
          </DialogDescription>
        </header>
        <div className="settings-scroll">
          <section
            className="settings-common"
            aria-label="Workspace preferences"
          >
            <SettingRow id="settings-theme" title="Appearance">
              <select
                id="settings-theme"
                value={theme === "dark" ? "dark" : "light"}
                onChange={(e) => setTheme(e.target.value)}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </SettingRow>
            <SettingRow
              id="settings-start"
              title="Start view"
              description="Where Atlas opens when no view is linked."
            >
              <select
                id="settings-start"
                value={settings.startView}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    startView: e.target.value as AtlasSettings["startView"],
                  })
                }
              >
                <option value="dashboard">Dashboard</option>
                <option value="globe">God’s Eye</option>
              </select>
            </SettingRow>
          </section>
          <div className="settings-tabs" aria-label="View settings">
            <button
              aria-pressed={tab === "dashboard"}
              onClick={() => onTabChange("dashboard")}
            >
              <LayoutDashboard size={17} /> Dashboard
            </button>
            <button
              aria-pressed={tab === "globe"}
              onClick={() => onTabChange("globe")}
            >
              <Globe2 size={17} /> God’s Eye
            </button>
          </div>
          <section
            aria-label={
              tab === "dashboard" ? "Dashboard settings" : "God’s Eye settings"
            }
          >
            {tab === "dashboard" ? (
              <>
                <SettingRow
                  id="settings-layout"
                  title="Project layout"
                  description="Roomy cards or a compact list."
                >
                  <select
                    id="settings-layout"
                    value={dashboard.layout}
                    onChange={(e) =>
                      setDashboard({
                        layout: e.target.value as typeof dashboard.layout,
                      })
                    }
                  >
                    <option value="cards">Cards</option>
                    <option value="list">List</option>
                  </select>
                </SettingRow>
                <SettingRow id="settings-sort" title="Project order">
                  <select
                    id="settings-sort"
                    value={dashboard.sort}
                    onChange={(e) =>
                      setDashboard({
                        sort: e.target.value as typeof dashboard.sort,
                      })
                    }
                  >
                    <option value="updated">Recently updated</option>
                    <option value="name">Name A–Z</option>
                    <option value="due">Due date</option>
                  </select>
                </SettingRow>
                <SettingRow
                  id="settings-metrics"
                  title="Summary metrics"
                  description="Project counts and completed tasks."
                >
                  <Switch
                    id="settings-metrics"
                    checked={dashboard.showMetrics}
                    onCheckedChange={(showMetrics) =>
                      setDashboard({ showMetrics })
                    }
                  />
                </SettingRow>
                <SettingRow
                  id="settings-focus"
                  title="Focus panel"
                  description="Keep your next tasks beside your projects."
                >
                  <Switch
                    id="settings-focus"
                    checked={dashboard.showFocus}
                    onCheckedChange={(showFocus) => setDashboard({ showFocus })}
                  />
                </SettingRow>
              </>
            ) : (
              <>
                <SettingRow id="settings-map" title="Map style">
                  <select
                    id="settings-map"
                    value={globe.mapStyle}
                    onChange={(e) =>
                      setGlobe({
                        mapStyle: e.target.value as typeof globe.mapStyle,
                      })
                    }
                  >
                    <option value="satellite">Satellite</option>
                    <option value="street">Street map</option>
                  </select>
                </SettingRow>
                <SettingRow
                  id="settings-buildings"
                  title="3D buildings"
                  description="Show building footprints where available."
                >
                  <Switch
                    id="settings-buildings"
                    checked={globe.buildings}
                    onCheckedChange={(buildings) => setGlobe({ buildings })}
                  />
                </SettingRow>
                <SettingRow
                  id="settings-terrain"
                  title="Terrain relief"
                  description="Show the shape of mountains and valleys."
                >
                  <Switch
                    id="settings-terrain"
                    checked={globe.terrain}
                    onCheckedChange={(terrain) => setGlobe({ terrain })}
                  />
                </SettingRow>
                <SettingRow
                  id="settings-labels"
                  title="Project labels"
                  description="Keep names beside the project markers."
                >
                  <Switch
                    id="settings-labels"
                    checked={globe.labels}
                    onCheckedChange={(labels) => setGlobe({ labels })}
                  />
                </SettingRow>
                <SettingRow
                  id="settings-locations"
                  title="Location list"
                  description="Browse projects beside the globe."
                >
                  <Switch
                    id="settings-locations"
                    checked={globe.projectList}
                    onCheckedChange={(projectList) => setGlobe({ projectList })}
                  />
                </SettingRow>
                <SettingRow
                  id="settings-motion"
                  title="Camera & workspace journey"
                  description="Reduced-motion preferences always take priority."
                >
                  <select
                    id="settings-motion"
                    value={globe.motion}
                    onChange={(e) =>
                      setGlobe({
                        motion: e.target.value as typeof globe.motion,
                      })
                    }
                  >
                    <option value="cinematic">Cinematic</option>
                    <option value="quick">Quick</option>
                    <option value="instant">Instant · skip animation</option>
                  </select>
                </SettingRow>
              </>
            )}
          </section>
        </div>
        <footer className="settings-footer">
          <p role="status">
            {storageError || "Changes saved automatically in this browser."}
          </p>
          <button
            className="settings-reset"
            onClick={() =>
              onChange({ ...settings, [tab]: { ...defaultSettings[tab] } })
            }
          >
            <RotateCcw size={15} /> Reset{" "}
            {tab === "dashboard" ? "dashboard" : "God’s Eye"}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function SettingRow({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <label htmlFor={id}>
          <strong>{title}</strong>
        </label>
        {description && <span>{description}</span>}
      </div>
      {children}
    </div>
  );
}
