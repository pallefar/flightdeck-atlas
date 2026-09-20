"use client";
import { sourceCatalog, looks } from "@/lib/globe-effects";
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
                <option value="globe">Project Eye</option>
              </select>
            </SettingRow>
            <SettingRow
              id="settings-view-motion"
              title="View transitions"
              description="Travel from your dashboard into the sky. Reduced motion is always respected."
            >
              <select
                id="settings-view-motion"
                value={settings.viewAnimation}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    viewAnimation: e.target
                      .value as AtlasSettings["viewAnimation"],
                  })
                }
              >
                <option value="cinematic">Cinematic</option>
                <option value="quick">Quick</option>
                <option value="instant">Instant</option>
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
              <Globe2 size={17} /> Project Eye
            </button>
          </div>
          <section
            aria-label={
              tab === "dashboard" ? "Dashboard settings" : "Project Eye settings"
            }
          >
            {tab === "dashboard" ? (
              <>
                <SettingRow
                  id="settings-layout"
                  title="Project layout"
                  description="Cards, a compact list, or a status board."
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
                    <option value="board">Board</option>
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
                  id="settings-planner"
                  title="Deadline planner"
                  description="Seven-day agenda and projects needing a check-in."
                >
                  <Switch
                    id="settings-planner"
                    checked={dashboard.showPlanner}
                    onCheckedChange={(showPlanner) =>
                      setDashboard({ showPlanner })
                    }
                  />
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
                <SettingRow
                  id="settings-wellbeing"
                  title="Wellbeing widget"
                  description="Show your mood, readiness and focus timer on the dashboard."
                >
                  <Switch
                    id="settings-wellbeing"
                    checked={dashboard.showWellbeing}
                    onCheckedChange={(showWellbeing) =>
                      setDashboard({ showWellbeing })
                    }
                  />
                </SettingRow>
              </>
            ) : (
              <>
                <details className="globe-settings-group" open>
                  <summary>Display & sensor looks</summary>
                  <SettingRow
                    id="settings-look"
                    title="Visual preset"
                    description="Night vision and thermal are simulated display effects, not sensor measurements."
                  >
                    <select
                      id="settings-look"
                      value={globe.look}
                      onChange={(e) =>
                        setGlobe({ look: e.target.value as typeof globe.look })
                      }
                    >
                      {looks.map((l) => (
                        <option key={l} value={l}>
                          {l === "nvg"
                            ? "Night vision"
                            : l === "crt"
                              ? "CRT"
                              : l[0].toUpperCase() + l.slice(1)}
                        </option>
                      ))}
                    </select>
                  </SettingRow>
                  {(
                    [
                      ["gain", "Gain", 0.2, 2],
                      ["contrast", "Contrast", 0.2, 2],
                      ["saturation", "Saturation", 0, 2],
                      ["pixelation", "Pixelation", 1, 10],
                      ["scanlines", "Scanlines", 0, 1],
                      ["grain", "Grain", 0, 1],
                      ["vignette", "Vignette", 0, 1],
                      ["distortion", "CRT distortion", 0, 1],
                      ["instability", "CRT instability", 0, 1],
                      ["sensitivity", "Thermal sensitivity", 0, 1],
                      ["snowDensity", "Snow density", 0, 1],
                      ["wind", "Snow wind", 0, 1],
                      ["sharpen", "Sharpening", 0, 1],
                      ["bloomIntensity", "Bloom intensity", 0, 2],
                    ] as const
                  ).map(([key, label, min, max]) => (
                    <SettingRow key={key} id={`settings-${key}`} title={label}>
                      <input
                        id={`settings-${key}`}
                        type="range"
                        min={min}
                        max={max}
                        step={key === "pixelation" ? 1 : 0.05}
                        value={globe[key]}
                        onChange={(e) =>
                          setGlobe({ [key]: Number(e.target.value) })
                        }
                      />
                      <output>{globe[key]}</output>
                    </SettingRow>
                  ))}
                  <SettingRow
                    id="settings-thermal-palette"
                    title="Thermal palette"
                  >
                    <select
                      id="settings-thermal-palette"
                      value={globe.thermalPalette}
                      onChange={(e) =>
                        setGlobe({
                          thermalPalette: e.target
                            .value as typeof globe.thermalPalette,
                        })
                      }
                    >
                      <option value="ironbow">Ironbow</option>
                      <option value="white">White hot</option>
                      <option value="black">Black hot</option>
                    </select>
                  </SettingRow>
                  <SettingRow id="settings-bloom" title="Bloom">
                    <Switch
                      id="settings-bloom"
                      checked={globe.bloom}
                      onCheckedChange={(bloom) => setGlobe({ bloom })}
                    />
                  </SettingRow>
                </details>
                <details className="globe-settings-group">
                  <summary>HUD, scope & quality</summary>
                  <SettingRow id="settings-hud" title="HUD layout">
                    <select
                      id="settings-hud"
                      value={globe.hud}
                      onChange={(e) =>
                        setGlobe({ hud: e.target.value as typeof globe.hud })
                      }
                    >
                      {["off", "minimal", "operator", "tactical"].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </SettingRow>
                  {(
                    [
                      ["detection", "Project detection brackets"],
                      ["scope", "Circular scope"],
                      ["cleanUI", "Clean presentation view"],
                      ["atmosphere", "Atmosphere"],
                      ["fog", "Distance haze"],
                    ] as const
                  ).map(([key, label]) => (
                    <SettingRow key={key} id={`settings-${key}`} title={label}>
                      <Switch
                        id={`settings-${key}`}
                        checked={globe[key]}
                        onCheckedChange={(value) => setGlobe({ [key]: value })}
                      />
                    </SettingRow>
                  ))}
                  <p className="hub-muted">
                    Detection brackets label saved project records. They do not
                    recognise objects in imagery.
                  </p>
                  {(
                    [
                      ["detectionDensity", "Detection density"],
                      ["scopeFeather", "Scope feather"],
                    ] as const
                  ).map(([key, label]) => (
                    <SettingRow key={key} id={`settings-${key}`} title={label}>
                      <input
                        id={`settings-${key}`}
                        type="range"
                        min={key === "detectionDensity" ? 0.1 : 0}
                        max={1}
                        step={0.1}
                        value={globe[key]}
                        onChange={(e) =>
                          setGlobe({ [key]: Number(e.target.value) })
                        }
                      />
                    </SettingRow>
                  ))}
                  <SettingRow id="settings-quality" title="Render quality">
                    <select
                      id="settings-quality"
                      value={globe.quality}
                      onChange={(e) =>
                        setGlobe({
                          quality: e.target.value as typeof globe.quality,
                        })
                      }
                    >
                      <option value="performance">Performance</option>
                      <option value="balanced">Balanced</option>
                      <option value="high">High detail</option>
                    </select>
                  </SettingRow>
                </details>
                <details className="globe-settings-group">
                  <summary>Camera & lighting</summary>
                  <SettingRow id="settings-orbit-speed" title="Orbit speed">
                    <select
                      id="settings-orbit-speed"
                      value={globe.orbitSpeed}
                      onChange={(e) =>
                        setGlobe({
                          orbitSpeed: e.target.value as typeof globe.orbitSpeed,
                        })
                      }
                    >
                      <option value="slow">Slow · 2°/s</option>
                      <option value="normal">Normal · 6°/s</option>
                      <option value="fast">Fast · 15°/s</option>
                    </select>
                  </SettingRow>
                  <SettingRow
                    id="settings-tour-dwell"
                    title="Tour pause at each project"
                  >
                    <input
                      id="settings-tour-dwell"
                      type="range"
                      min={2}
                      max={15}
                      value={globe.tourDwell}
                      onChange={(e) =>
                        setGlobe({ tourDwell: Number(e.target.value) })
                      }
                    />
                    <output>{globe.tourDwell}s</output>
                  </SettingRow>
                  <SettingRow
                    id="settings-sun"
                    title="Sun position"
                    description="Lighting presets are for presentation; only Live uses the current UTC time."
                  >
                    <select
                      id="settings-sun"
                      value={globe.sun}
                      onChange={(e) =>
                        setGlobe({ sun: e.target.value as typeof globe.sun })
                      }
                    >
                      <option value="live">Live sun position</option>
                      <option value="noon">Midday at selected longitude</option>
                      <option value="golden">
                        Golden hour at selected longitude
                      </option>
                      <option value="night">Night at selected longitude</option>
                    </select>
                  </SettingRow>
                </details>
                <details className="globe-settings-group">
                  <summary>Data layers & connections</summary>
                  <SettingRow
                    id="settings-earthquakes"
                    title="Earthquakes · last 24 hours"
                    description="USGS reported events. Refreshes every five minutes while visible."
                  >
                    <Switch
                      id="settings-earthquakes"
                      checked={globe.earthquakes}
                      onCheckedChange={(earthquakes) =>
                        setGlobe({ earthquakes })
                      }
                    />
                  </SettingRow>
                  <div className="globe-provider-list">
                    {sourceCatalog.map((s) => (
                      <div key={s.name}>
                        <strong>{s.name}</strong>
                        <span>
                          {s.source} · {s.state}
                        </span>
                        <small>{s.detail}</small>
                      </div>
                    ))}
                  </div>
                </details>
                <SettingRow id="settings-globe-mode" title="Globe experience">
                  <select
                    id="settings-globe-mode"
                    value={globe.mode}
                    onChange={(e) =>
                      setGlobe({ mode: e.target.value as typeof globe.mode })
                    }
                  >
                    <option value="explore">Explore</option>
                    <option value="scan">Cinematic scan</option>
                  </select>
                </SettingRow>
                <SettingRow
                  id="settings-shadows"
                  title="Sunlight & shadows"
                  description="Illuminate the globe and cast building shadows using the current sun position."
                >
                  <Switch
                    id="settings-shadows"
                    checked={globe.shadows}
                    onCheckedChange={(shadows) => setGlobe({ shadows })}
                  />
                </SettingRow>
                <SettingRow
                  id="settings-zoom-lens"
                  title="Circular zoom lens"
                  description="Animated target rings while flying into a project or zooming."
                >
                  <Switch
                    id="settings-zoom-lens"
                    checked={globe.zoomLens}
                    onCheckedChange={(zoomLens) => setGlobe({ zoomLens })}
                  />
                </SettingRow>
                <SettingRow id="settings-marker-color" title="Marker colors">
                  <select
                    id="settings-marker-color"
                    value={globe.markerColor}
                    onChange={(e) =>
                      setGlobe({
                        markerColor: e.target.value as typeof globe.markerColor,
                      })
                    }
                  >
                    <option value="project">Project colors</option>
                    <option value="risk">Risk signals</option>
                  </select>
                </SettingRow>
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
                  description="Show the project panel in Explore mode. Scanner results remain available in Cinematic scan."
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
            {tab === "dashboard" ? "dashboard" : "Project Eye"}
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
