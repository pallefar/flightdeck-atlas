"use client";
import { useEffect, useRef, useState } from "react";
import type * as CesiumType from "cesium";
import { ArrowRight, Globe2, Minus, Plus, X, Orbit, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Project } from "@/lib/projects";
import { motionScale, type GlobeSettings } from "@/lib/settings";
import { projectSignals } from "@/lib/project-scan";
import RoomJourney from "./room-journey";
type CesiumModule = typeof CesiumType;
declare global {
  interface Window {
    Cesium: CesiumModule;
    CESIUM_BASE_URL: string;
    atlasCesium?: Promise<CesiumModule>;
  }
}
function getCesium() {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (!window.atlasCesium) {
    window.CESIUM_BASE_URL = "/cesium/";
    window.atlasCesium = new Promise<CesiumModule>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/cesium/Cesium.js";
      script.async = true;
      script.onload = () => resolve(window.Cesium);
      script.onerror = () => {
        window.atlasCesium = undefined;
        script.remove();
        reject(Error("The globe could not load. Please reload and try again."));
      };
      document.head.appendChild(script);
    });
  }
  return window.atlasCesium;
}
export default function Globe({
  projects,
  target,
  onOpen,
  settings,
  resetCommand = 0,
  stopCommand = 0,
  onInteract,
  onSelectionChange,
}: {
  projects: Project[];
  target: Project | null;
  onOpen: (p: Project) => void;
  settings: GlobeSettings;
  resetCommand?: number;
  stopCommand?: number;
  onInteract?: () => void;
  onSelectionChange?: (project: Project | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    viewer = useRef<CesiumType.Viewer | null>(null),
    cesiumRef = useRef<CesiumModule | null>(null),
    currentProjects = useRef(projects),
    currentSettings = useRef(settings),
    terrainProvider = useRef<CesiumType.CesiumTerrainProvider | null>(null),
    buildingTiles = useRef<CesiumType.Cesium3DTileset | null>(null),
    active = useRef(true),
    generation = useRef(0);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Project | null>(null),
    [journey, setJourney] = useState(false),
    [entering, setEntering] = useState(false),
    [mapMode, setMapMode] = useState("Satellite imagery"),
    [imageryReady, setImageryReady] = useState(false),
    [buildingsReady, setBuildingsReady] = useState(false);
  const [hovered, setHovered] = useState<{
    project: Project;
    x: number;
    y: number;
  } | null>(null);
  const [orbit, setOrbit] = useState(false);
  const orbitCleanup = useRef<(() => void) | null>(null);
  const [flightLens, setFlightLens] = useState<{
    label: string;
    duration: number;
    started: number;
  } | null>(null);
  const [cameraHeight, setCameraHeight] = useState(0);
  function stopOrbit() {
    orbitCleanup.current?.();
    orbitCleanup.current = null;
    setOrbit(false);
  }
  function takeControl() {
    stopOrbit();
    viewer.current?.camera.cancelFlight();
    interaction.current?.();
  }
  const control = useRef(takeControl);
  control.current = takeControl;
  const interaction = useRef(onInteract);
  interaction.current = onInteract;
  const selectionChange = useRef(onSelectionChange);
  selectionChange.current = onSelectionChange;
  currentProjects.current = projects;
  currentSettings.current = settings;
  function fly(p: Project, close = false, complete?: () => void) {
    const C = cesiumRef.current,
      v = viewer.current;
    if (
      !C ||
      !v ||
      v.isDestroyed() ||
      p.latitude === null ||
      p.longitude === null
    )
      return;
    v.camera.cancelFlight();
    const duration =
      (close ? 2.5 : 4.5) * motionScale(currentSettings.current.motion);
    setCameraHeight(Math.max(0, v.camera.positionCartographic.height));
    if (currentSettings.current.zoomLens && duration)
      setFlightLens({
        label: close ? `Approaching ${p.name}` : p.name,
        duration,
        started: performance.now(),
      });
    const point = C.Cartesian3.fromDegrees(p.longitude, p.latitude, 35);
    v.camera.flyToBoundingSphere(new C.BoundingSphere(point, 0), {
      offset: new C.HeadingPitchRange(
        C.Math.toRadians(25),
        C.Math.toRadians(close ? -15 : -40),
        close ? 150 : 1500,
      ),
      duration,
      easingFunction: C.EasingFunction.CUBIC_IN_OUT,
      cancel: () => {
        if (active.current) {
          setEntering(false);
          setFlightLens(null);
        }
      },
      complete: () => {
        if (active.current) {
          setFlightLens(null);
          complete?.();
        }
      },
    });
  }
  function choose(p: Project) {
    stopOrbit();
    generation.current++;
    setJourney(false);
    setEntering(false);
    setSelected(p);
    selectionChange.current?.(p);
    fly(p);
  }
  useEffect(() => {
    let disposed = false;
    active.current = true;
    let handler: CesiumType.ScreenSpaceEventHandler | undefined;
    let removeOcclusion: (() => void) | undefined;
    let removeMouseLeave: (() => void) | undefined;
    void (async () => {
      try {
        const C = await getCesium();
        if (disposed || !container.current) return;
        cesiumRef.current = C;
        C.Ion.defaultAccessToken = "";
        const v = new C.Viewer(container.current, {
          animation: false,
          timeline: false,
          skyBox: false,
          baseLayer: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          selectionIndicator: false,
          infoBox: false,
          requestRenderMode: true,
          maximumRenderTimeChange: Infinity,
          contextOptions: { webgl: { alpha: false } },
        });
        viewer.current = v;
        v.scene.backgroundColor = C.Color.fromCssColorString("#03080f");
        v.scene.globe.baseColor = C.Color.fromCssColorString("#152b40");
        v.scene.globe.enableLighting = false;
        v.scene.globe.depthTestAgainstTerrain = true;
        v.scene.screenSpaceCameraController.minimumZoomDistance = 40;
        v.resolutionScale = Math.min(window.devicePixelRatio, 1.6);
        v.camera.setView({
          destination: C.Cartesian3.fromDegrees(18, 30, 15_500_000),
        });
        setReady(true);
        const occluder = new C.Occluder(
          new C.BoundingSphere(
            C.Cartesian3.ZERO,
            C.Ellipsoid.WGS84.minimumRadius,
          ),
          v.camera.positionWC,
        );
        removeOcclusion = v.scene.postRender.addEventListener(() => {
          occluder.cameraPosition = v.camera.positionWC;
          let changed = false;
          for (const entity of v.entities.values) {
            const position = entity.position?.getValue(v.clock.currentTime);
            if (position) {
              const visible = occluder.isPointVisible(position);
              if (entity.show !== visible) {
                entity.show = visible;
                changed = true;
              }
            }
          }
          if (changed) v.scene.requestRender();
        });
        handler = new C.ScreenSpaceEventHandler(v.scene.canvas);
        handler.setInputAction(
          (movement: { position: CesiumType.Cartesian2 }) => {
            const hit = v.scene.pick(movement.position);
            const id = hit?.id?.id;
            const p = currentProjects.current.find((x) => x.id === id);
            if (p) {
              control.current();
              choose(p);
            }
          },
          C.ScreenSpaceEventType.LEFT_CLICK,
        );
        handler.setInputAction(
          () => control.current(),
          C.ScreenSpaceEventType.LEFT_DOWN,
        );
        handler.setInputAction(
          () => control.current(),
          C.ScreenSpaceEventType.RIGHT_DOWN,
        );
        handler.setInputAction(
          () => control.current(),
          C.ScreenSpaceEventType.MIDDLE_DOWN,
        );
        handler.setInputAction(() => {
          setHovered(null);
          control.current();
        }, C.ScreenSpaceEventType.WHEEL);
        let lastHover = "",
          lastMove = 0;
        const clearHover = () => {
          const old = v.entities.getById(lastHover);
          if (old?.point) old.point.pixelSize = new C.ConstantProperty(11);
          lastHover = "";
          setHovered(null);
          v.scene.canvas.style.cursor = "";
          v.scene.requestRender();
        };
        v.scene.canvas.addEventListener("mouseleave", clearHover);
        removeMouseLeave = () =>
          v.scene.canvas.removeEventListener("mouseleave", clearHover);
        handler.setInputAction(
          (movement: { endPosition: CesiumType.Cartesian2 }) => {
            if (
              !window.matchMedia("(hover:hover)").matches ||
              performance.now() - lastMove < 40
            )
              return;
            lastMove = performance.now();
            const hit = v.scene.pick(movement.endPosition),
              id = hit?.id?.id;
            const project = currentProjects.current.find((p) => p.id === id);
            if (!project) {
              if (lastHover) clearHover();
              return;
            }
            if (lastHover !== project.id) {
              const old = v.entities.getById(lastHover);
              if (old?.point) old.point.pixelSize = new C.ConstantProperty(11);
              const entity = v.entities.getById(project.id);
              if (entity?.point)
                entity.point.pixelSize = new C.ConstantProperty(18);
              lastHover = project.id;
              v.scene.requestRender();
            }
            v.scene.canvas.style.cursor = "pointer";
            setHovered({
              project,
              x: Math.max(
                12,
                Math.min(
                  movement.endPosition.x + 18,
                  v.scene.canvas.clientWidth - 244,
                ),
              ),
              y: Math.max(
                12,
                Math.min(
                  movement.endPosition.y + 18,
                  v.scene.canvas.clientHeight - 100,
                ),
              ),
            });
          },
          C.ScreenSpaceEventType.MOUSE_MOVE,
        );
        void (async () => {
          try {
            const terrain = await C.CesiumTerrainProvider.fromUrl(
              "https://terrain.reearth.land/cesium-mesh/ellipsoid",
              {
                credit: new C.Credit(
                  'Terrain: <a href="https://terrain.reearth.land/">Re:Earth</a>',
                  true,
                ),
              },
            );
            if (!disposed) {
              terrainProvider.current = terrain;
              if (currentSettings.current.terrain) v.terrainProvider = terrain;
              v.scene.requestRender();
            }
          } catch {
            /* Ellipsoid remains a supported fallback. */
          }
        })();
        void (async () => {
          try {
            const buildings = await C.Cesium3DTileset.fromUrl(
              "https://buildings.reearth.land/tileset.json",
              { showCreditsOnScreen: true, maximumScreenSpaceError: 12 },
            );
            if (disposed) {
              buildings.destroy();
              return;
            }
            buildings.style = new C.Cesium3DTileStyle({
              color: "color('#a4b8c6', 0.96)",
            });
            buildings.show = currentSettings.current.buildings;
            buildingTiles.current = buildings;
            v.scene.primitives.add(buildings);
            setBuildingsReady(true);
            v.cesiumWidget.creditDisplay.addStaticCredit(
              new C.Credit(
                'Buildings: <a href="https://buildings.reearth.land/">Re:Earth</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://docs.overturemaps.org/attribution/">Overture Maps</a>',
                true,
              ),
            );
            v.scene.requestRender();
          } catch {
            /* Satellite-only view remains usable without community tiles. */
          }
        })();
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    })();
    return () => {
      disposed = true;
      active.current = false;
      orbitCleanup.current?.();
      generation.current++;
      handler?.destroy();
      removeMouseLeave?.();
      removeOcclusion?.();
      const v = viewer.current;
      if (v && !v.isDestroyed()) v.destroy();
      viewer.current = null;
      buildingTiles.current = null;
      terrainProvider.current = null;
    };
  }, []);
  useEffect(() => {
    const C = cesiumRef.current,
      v = viewer.current;
    if (!ready || !C || !v) return;
    let disposed = false;
    setImageryReady(false);
    void (async () => {
      let provider: CesiumType.ImageryProvider;
      let caption = "Street map";
      try {
        if (settings.mapStyle === "satellite") {
          provider = await C.ArcGisMapServerImageryProvider.fromUrl(
            "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
            { enablePickFeatures: false },
          );
          caption = "Satellite imagery";
        } else {
          provider = new C.OpenStreetMapImageryProvider({
            url: "https://tile.openstreetmap.org/",
          });
        }
      } catch {
        if (disposed) return;
        provider = new C.OpenStreetMapImageryProvider({
          url: "https://tile.openstreetmap.org/",
        });
        caption = "Street map (satellite unavailable)";
      }
      if (disposed || v.isDestroyed()) return;
      v.imageryLayers.removeAll();
      const layer = v.imageryLayers.addImageryProvider(provider);
      layer.brightness = caption === "Satellite imagery" ? 0.87 : 1;
      layer.saturation = caption === "Satellite imagery" ? 0.72 : 1;
      setMapMode(caption);
      setImageryReady(true);
      v.scene.requestRender();
    })();
    return () => {
      disposed = true;
    };
  }, [ready, settings.mapStyle]);
  useEffect(() => {
    const C = cesiumRef.current,
      v = viewer.current;
    if (!ready || !C || !v) return;
    if (buildingTiles.current) buildingTiles.current.show = settings.buildings;
    v.terrainProvider =
      settings.terrain && terrainProvider.current
        ? terrainProvider.current
        : new C.EllipsoidTerrainProvider();
    v.scene.requestRender();
  }, [ready, settings.buildings, settings.terrain]);
  useEffect(() => {
    const v = viewer.current;
    if (!ready || !v) return;
    v.shadows = settings.shadows;
    v.scene.globe.enableLighting = settings.shadows;
    v.scene.requestRender();
  }, [ready, settings.shadows]);
  useEffect(() => {
    if (ready && resetCommand) reset();
  }, [ready, resetCommand]);
  useEffect(() => {
    if (!stopCommand) return;
    stopOrbit();
    viewer.current?.camera.cancelFlight();
    generation.current++;
    setEntering(false);
  }, [stopCommand]);
  useEffect(() => {
    viewer.current?.camera.cancelFlight();
    generation.current++;
    setEntering(false);
    if (settings.motion === "instant") setJourney(false);
    stopOrbit();
    setFlightLens(null);
  }, [settings.motion]);
  useEffect(() => {
    if (!flightLens) return;
    const id = window.setInterval(() => {
      const v = viewer.current;
      if (v && !v.isDestroyed())
        setCameraHeight(Math.max(0, v.camera.positionCartographic.height));
    }, 100);
    return () => clearInterval(id);
  }, [flightLens]);
  useEffect(() => {
    if (!settings.zoomLens) setFlightLens(null);
  }, [settings.zoomLens]);
  useEffect(() => {
    const v = viewer.current,
      C = cesiumRef.current;
    if (
      !orbit ||
      !selected ||
      !ready ||
      !C ||
      !v ||
      motionScale(settings.motion) === 0
    )
      return;
    let disposed = false,
      frame = 0,
      last = 0,
      heading = C.Math.toRadians(25);
    const center = C.Cartesian3.fromDegrees(
      selected.longitude!,
      selected.latitude!,
      35,
    );
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      if (!v.isDestroyed()) {
        v.camera.cancelFlight();
        v.camera.lookAtTransform(C.Matrix4.IDENTITY);
        v.scene.requestRender();
      }
    };
    orbitCleanup.current = cleanup;
    fly(selected, false, () => {
      if (disposed) return;
      const tick = (now: number) => {
        if (disposed) return;
        if (!last) last = now;
        heading += Math.min(now - last, 50) * 0.00007;
        last = now;
        v.camera.lookAt(
          center,
          new C.HeadingPitchRange(heading, C.Math.toRadians(-35), 1500),
        );
        v.scene.requestRender();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cleanup();
      if (orbitCleanup.current === cleanup) orbitCleanup.current = null;
    };
  }, [orbit, selected?.id, ready, settings.motion]);
  useEffect(() => {
    const stop = (e: KeyboardEvent) => {
      if (e.key === "Escape") control.current();
    };
    const hidden = () => {
      if (document.hidden) control.current();
    };
    window.addEventListener("keydown", stop);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", stop);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  useEffect(() => {
    const C = cesiumRef.current,
      v = viewer.current;
    if (!ready || !C || !v) return;
    setHovered(null);
    v.entities.removeAll();
    const pointOccluder = new C.Occluder(
      new C.BoundingSphere(C.Cartesian3.ZERO, C.Ellipsoid.WGS84.minimumRadius),
      v.camera.positionWC,
    );
    projects
      .filter((p) => p.latitude !== null && p.longitude !== null)
      .forEach((p) => {
        const signal = projectSignals(p);
        const color = C.Color.fromCssColorString(
          settings.markerColor === "risk"
            ? signal.blocked
              ? "#ff6975"
              : signal.late || signal.overdue
                ? "#ffbf58"
                : p.status === "Completed"
                  ? "#79dfb0"
                  : "#88baff"
            : {
                orange: "#ff9170",
                blue: "#88baff",
                green: "#9be2be",
                violet: "#c3acff",
              }[p.color],
        );
        v.entities.add({
          id: p.id,
          show: pointOccluder.isPointVisible(
            C.Cartesian3.fromDegrees(p.longitude!, p.latitude!, 160),
          ),
          position: C.Cartesian3.fromDegrees(p.longitude!, p.latitude!, 160),
          point: {
            heightReference: C.HeightReference.RELATIVE_TO_GROUND,
            pixelSize: 11,
            color,
            outlineColor: C.Color.fromCssColorString("#1a222d"),
            outlineWidth: 3,
            disableDepthTestDistance: 0,
          },
          label: {
            show: settings.labels,
            heightReference: C.HeightReference.RELATIVE_TO_GROUND,
            text: p.name,
            font: "13px sans-serif",
            fillColor: C.Color.WHITE,
            outlineColor: C.Color.BLACK,
            outlineWidth: 3,
            style: C.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new C.Cartesian2(16, -5),
            horizontalOrigin: C.HorizontalOrigin.LEFT,
            disableDepthTestDistance: 0,
            distanceDisplayCondition: new C.DistanceDisplayCondition(
              0,
              30_000_000,
            ),
          },
        });
      });
    v.scene.requestRender();
  }, [ready, projects, settings.labels, settings.markerColor]);
  useEffect(() => {
    if (ready && target) choose(target);
  }, [ready, target]);
  useEffect(() => {
    setSelected((previous) =>
      previous ? projects.find((p) => p.id === previous.id) || null : null,
    );
  }, [projects]);
  function reset() {
    stopOrbit();
    setFlightLens(null);
    generation.current++;
    setJourney(false);
    setEntering(false);
    setSelected(null);
    selectionChange.current?.(null);
    const C = cesiumRef.current,
      v = viewer.current;
    if (C && v) {
      v.camera.cancelFlight();
      v.camera.flyTo({
        destination: C.Cartesian3.fromDegrees(18, 30, 15_500_000),
        duration: 2 * motionScale(currentSettings.current.motion),
      });
    }
  }
  function zoom(inward: boolean) {
    takeControl();
    const C = cesiumRef.current,
      v = viewer.current;
    if (!C || !v) return;
    const point = v.camera.positionCartographic;
    const duration = 0.85 * motionScale(settings.motion);
    if (settings.zoomLens && duration)
      setFlightLens({
        label: inward ? "Zooming in" : "Zooming out",
        duration,
        started: performance.now(),
      });
    v.camera.flyTo({
      destination: C.Cartesian3.fromRadians(
        point.longitude,
        point.latitude,
        Math.min(40000000, Math.max(60, point.height * (inward ? 0.6 : 1.6))),
      ),
      orientation: {
        heading: v.camera.heading,
        pitch: v.camera.pitch,
        roll: v.camera.roll,
      },
      duration,
      complete: () => setFlightLens(null),
      cancel: () => setFlightLens(null),
    });
  }
  function enter() {
    if (!selected) return;
    stopOrbit();
    interaction.current?.();
    if (motionScale(settings.motion) === 0) {
      viewer.current?.camera.cancelFlight();
      onOpen(selected);
      return;
    }
    const run = ++generation.current;
    viewer.current?.camera.cancelFlight();
    setEntering(true);
    fly(selected, true, () => {
      if (active.current && run === generation.current) {
        setJourney(true);
        setEntering(false);
      }
    });
  }
  return (
    <>
      <div
        ref={container}
        className="globe-canvas"
        aria-label="Interactive 3D project globe"
      />
      {!ready && !error && (
        <div className="globe-loading">Loading your world…</div>
      )}
      {error && (
        <div className="map-message">
          {error}
          <p>You can still open and manage projects from the dashboard.</p>
        </div>
      )}
      {ready && (
        <>
          <div className="globe-controls">
            <button
              onClick={() => {
                interaction.current?.();
                reset();
              }}
              aria-label="Reset to globe"
            >
              <Globe2 size={17} />
              <span>World</span>
            </button>
            <button onClick={() => zoom(true)} aria-label="Zoom in">
              <Plus size={17} />
            </button>
            <button onClick={() => zoom(false)} aria-label="Zoom out">
              <Minus size={17} />
            </button>
          </div>
          <div className="globe-hint">
            {mapMode}
            {settings.buildings && buildingsReady ? " + 3D buildings" : ""} ·
            Drag to orbit · Scroll to zoom
          </div>
        </>
      )}
      {settings.markerColor === "risk" && (
        <div className="globe-risk-legend">
          <span>
            <i style={{ background: "#ff6975" }} />
            Blocked
          </span>
          <span>
            <i style={{ background: "#ffbf58" }} />
            Overdue
          </span>
          <span>
            <i style={{ background: "#79dfb0" }} />
            Completed
          </span>
          <span>
            <i style={{ background: "#88baff" }} />
            No alert
          </span>
        </div>
      )}
      {flightLens && (
        <div className="zoom-flight-hud" aria-label="Camera flight">
          <div
            className="zoom-lens"
            key={flightLens.started}
            style={
              {
                "--zoom-duration": `${flightLens.duration}s`,
              } as React.CSSProperties
            }
            aria-hidden="true"
          >
            <span />
            <span />
            <span />
            <i />
            <b />
          </div>
          <div className="zoom-readout">
            <span>
              LOCATING /{" "}
              {cameraHeight >= 1000
                ? `${(cameraHeight / 1000).toFixed(1)} KM`
                : `${Math.round(cameraHeight)} M`}{" "}
              ALTITUDE
            </span>
            <strong>{flightLens.label}</strong>
            <button onClick={takeControl}>Stop flight</button>
          </div>
        </div>
      )}
      {hovered && (
        <div
          className="globe-marker-tooltip"
          style={{ left: hovered.x, top: hovered.y }}
          role="tooltip"
        >
          <strong>{hovered.project.name}</strong>
          <span>{hovered.project.location || "Project location"}</span>
          <small>{hovered.project.status} · Click to explore</small>
        </div>
      )}
      {selected && !journey && (
        <div
          className={`destination-card ${flightLens ? "destination-in-flight" : ""}`}
        >
          <button
            className="destination-close"
            aria-label="Close selected project"
            onClick={() => {
              stopOrbit();
              viewer.current?.camera.cancelFlight();
              generation.current++;
              setEntering(false);
              setSelected(null);
              selectionChange.current?.(null);
              interaction.current?.();
            }}
          >
            <X size={15} />
          </button>
          <span className="eyebrow">DESTINATION SELECTED</span>
          <h2>{selected.name}</h2>
          <p>
            {selected.location}
            <br />
            {selected.latitude?.toFixed(4)}°, {selected.longitude?.toFixed(4)}°
          </p>
          <button
            className="orbit-control"
            aria-pressed={orbit}
            disabled={motionScale(settings.motion) === 0 || entering}
            onClick={() => {
              interaction.current?.();
              if (orbit) stopOrbit();
              else setOrbit(true);
            }}
          >
            {orbit ? <Pause size={15} /> : <Orbit size={15} />}{" "}
            {orbit ? "Stop orbit" : "Orbit this project"}
          </button>
          <Button onClick={enter} disabled={entering || !imageryReady}>
            {entering ? "Approaching your workspace…" : "Enter workspace"}
            <ArrowRight size={16} />
          </Button>
          <small>
            {motionScale(settings.motion) === 0
              ? "Opens your project immediately"
              : "Building → stylized room → your project"}
          </small>
          <button
            className="text-link"
            style={{ marginTop: 12, fontSize: 11 }}
            onClick={() => {
              takeControl();
              generation.current++;
              setEntering(false);
              onOpen(selected);
            }}
          >
            Open directly
          </button>
        </div>
      )}
      {journey && selected && (
        <RoomJourney
          project={selected}
          durationScale={motionScale(settings.motion)}
          onComplete={() => {
            setJourney(false);
            onOpen(selected);
          }}
          onCancel={() => {
            setJourney(false);
            setEntering(false);
          }}
        />
      )}
    </>
  );
}
