"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as CesiumType from "cesium";
import { ArrowRight, Globe2, Minus, Plus, X, Orbit, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Project } from "@/lib/projects";
import { motionScale, type GlobeSettings } from "@/lib/settings";
import { projectSignals } from "@/lib/project-scan";
import { sensorShader, looks } from "@/lib/globe-effects";
import { useWorkspace } from "./workspace-tools";
import { sceneSchema } from "@/lib/collaboration";
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
  onFlightComplete,
}: {
  projects: Project[];
  target: Project | null;
  onOpen: (p: Project) => void;
  settings: GlobeSettings;
  resetCommand?: number;
  stopCommand?: number;
  onInteract?: () => void;
  onSelectionChange?: (project: Project | null) => void;
  onFlightComplete?: () => void;
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
  const workspace = useWorkspace();
  const [director, setDirector] = useState(false),
    [sceneName, setSceneName] = useState(""),
    [drawType, setDrawType] = useState<"pin" | "line" | "area" | null>(null),
    [drawPoints, setDrawPoints] = useState<[number, number][]>([]),
    [annotationName, setAnnotationName] = useState(""),
    [annotationColor, setAnnotationColor] = useState<
      "orange" | "blue" | "green" | "white" | "red"
    >("orange"),
    [sceneMessage, setSceneMessage] = useState("");
  // The selected project and the inputs it was last reconciled with: a new
  // target (once the globe is ready) selects it, and a new project list keeps
  // it only while it is still listed. This is adjusted while rendering, and
  // it is one state value on purpose. With the inputs in a separate state,
  // React could drop the selection update while keeping the new inputs. That
  // happens when a lower-priority update is still pending, for example the
  // reset effect's "select nothing". The card then stayed shut after a click
  // (project-scan spec, 2 to 3 failures in 6 runs). Kept together, a dropped
  // update also drops the recorded inputs, so the next render redoes it.
  const [selection, setSelection] = useState<{
    project: Project | null;
    ready: boolean;
    target: Project | null;
    projects: Project[];
  }>(() => ({ project: null, ready, target, projects }));
  const selected = selection.project;
  function setSelected(project: Project | null) {
    setSelection((s) => ({ ...s, project }));
  }
  if (
    selection.ready !== ready ||
    selection.target !== target ||
    selection.projects !== projects
  )
    setSelection((s) => {
      let project = s.project;
      if ((s.ready !== ready || s.target !== target) && ready && target)
        project = target;
      if (s.projects !== projects && project) {
        const id = project.id;
        project = projects.find((p) => p.id === id) || null;
      }
      return { project, ready, target, projects };
    });
  const drawRef = useRef(drawType);
  const [sourceStatus, setSourceStatus] = useState({
      terrain: "Loading",
      buildings: "Loading",
      imagery: "Loading",
    }),
    [retry, setRetry] = useState(0);
  const [telemetry, setTelemetry] = useState({
    longitude: 0,
    latitude: 0,
    altitude: 0,
    heading: 0,
  });
  const [brackets, setBrackets] = useState<
    { id: string; name: string; x: number; y: number }[]
  >([]);
  const [quakeStatus, setQuakeStatus] = useState("Off"),
    [quakeDetail, setQuakeDetail] = useState<{
      magnitude: number;
      place: string;
      time: number;
      url: string | null;
    } | null>(null);
  const flyTicket = useRef(0),
    flightComplete = useRef(onFlightComplete);
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
    flyTicket.current++;
    stopOrbit();
    viewer.current?.camera.cancelFlight();
    interaction.current?.();
  }
  const control = useRef(takeControl);
  const interaction = useRef(onInteract);
  const selectionChange = useRef(onSelectionChange);
  // Cesium callbacks and timers read the latest render's values through
  // these refs; they are updated after each commit, before other effects.
  useLayoutEffect(() => {
    drawRef.current = drawType;
    flightComplete.current = onFlightComplete;
    control.current = takeControl;
    interaction.current = onInteract;
    selectionChange.current = onSelectionChange;
    currentProjects.current = projects;
    currentSettings.current = settings;
  });
  async function fly(p: Project, close = false, complete?: () => void) {
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
    const ticket = ++flyTicket.current;
    const coordinates = C.Cartographic.fromDegrees(p.longitude, p.latitude);
    let ground = v.scene.globe.getHeight(coordinates) || 0;
    if (currentSettings.current.terrain && terrainProvider.current) {
      try {
        const sampled = await Promise.race([
          C.sampleTerrainMostDetailed(terrainProvider.current, [coordinates]),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
        ]);
        if (sampled && Number.isFinite(sampled[0].height))
          ground = sampled[0].height;
      } catch {
        /* Use currently loaded terrain height. */
      }
    }
    if (ticket !== flyTicket.current || !active.current || v.isDestroyed())
      return;
    const duration =
      (close ? 2.5 : 4.5) * motionScale(currentSettings.current.motion);
    setCameraHeight(Math.max(0, v.camera.positionCartographic.height));
    if (currentSettings.current.zoomLens && duration)
      setFlightLens({
        label: close ? `Approaching ${p.name}` : p.name,
        duration,
        started: performance.now(),
      });
    const point = C.Cartesian3.fromDegrees(
      p.longitude,
      p.latitude,
      ground + 35,
    );
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
          flightComplete.current?.();
        }
      },
    });
  }
  function flyToChoice(p: Project) {
    orbitCleanup.current?.();
    orbitCleanup.current = null;
    generation.current++;
    flyTicket.current++;
    selectionChange.current?.(p);
    fly(p);
  }
  function choose(p: Project) {
    setOrbit(false);
    setJourney(false);
    setEntering(false);
    setSelected(p);
    flyToChoice(p);
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
        const cameraLink = new URLSearchParams(location.search).get("camera");
        if (cameraLink) {
          const n = cameraLink.split(",").map(Number);
          if (
            n.length === 5 &&
            n.every(Number.isFinite) &&
            Math.abs(n[0]) <= 180 &&
            Math.abs(n[1]) <= 90 &&
            n[2] >= 40 &&
            n[2] <= 50000000 &&
            Math.abs(n[4]) <= 1.58
          )
            v.camera.setView({
              destination: C.Cartesian3.fromDegrees(n[0], n[1], n[2]),
              orientation: { heading: n[3], pitch: n[4], roll: 0 },
            });
        }
        setReady(true);
        let lastTelemetry = 0;
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
          if (performance.now() - lastTelemetry > 200) {
            lastTelemetry = performance.now();
            const c = v.camera.positionCartographic;
            setTelemetry({
              longitude: C.Math.toDegrees(c.longitude),
              latitude: C.Math.toDegrees(c.latitude),
              altitude: c.height,
              heading: C.Math.toDegrees(v.camera.heading),
            });
            if (currentSettings.current.detection) {
              const visible = [];
              for (const p of currentProjects.current) {
                const entity = v.entities.getById(p.id),
                  point = entity?.position?.getValue(v.clock.currentTime);
                if (!point || !entity?.show) continue;
                const screen = C.SceneTransforms.worldToWindowCoordinates(
                  v.scene,
                  point,
                );
                if (
                  screen &&
                  screen.x > 10 &&
                  screen.y > 10 &&
                  screen.x < v.scene.canvas.clientWidth - 100 &&
                  screen.y < v.scene.canvas.clientHeight - 50
                )
                  visible.push({
                    id: p.id,
                    name: p.name,
                    x: screen.x,
                    y: screen.y,
                  });
              }
              setBrackets(
                visible.slice(
                  0,
                  Math.max(
                    1,
                    Math.ceil(
                      visible.length * currentSettings.current.detectionDensity,
                    ),
                  ),
                ),
              );
            }
          }
          if (changed) v.scene.requestRender();
        });
        handler = new C.ScreenSpaceEventHandler(v.scene.canvas);
        handler.setInputAction(
          (movement: { position: CesiumType.Cartesian2 }) => {
            if (drawRef.current) {
              const ray = v.camera.getPickRay(movement.position),
                point = ray ? v.scene.globe.pick(ray, v.scene) : undefined;
              if (point) {
                const cart = C.Cartographic.fromCartesian(point);
                setDrawPoints((prev) =>
                  [
                    ...prev,
                    [
                      C.Math.toDegrees(cart.longitude),
                      C.Math.toDegrees(cart.latitude),
                    ] as [number, number],
                  ].slice(-100),
                );
              }
              return;
            }
            const hit = v.scene.pick(movement.position);
            if (hit?.id?.properties?.quake) {
              setQuakeDetail(hit.id.properties.quake.getValue());
              return;
            }
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
              setSourceStatus((s) => ({ ...s, terrain: "Ready" }));
              if (currentSettings.current.terrain) v.terrainProvider = terrain;
              v.scene.requestRender();
            }
          } catch {
            if (!disposed)
              setSourceStatus((s) => ({
                ...s,
                terrain: "Unavailable · flat globe fallback",
              }));
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
            setSourceStatus((s) => ({ ...s, buildings: "Ready" }));
            buildings.tileFailed.addEventListener(() => {
              if (!disposed)
                setSourceStatus((s) => ({
                  ...s,
                  buildings: "Degraded · some tiles unavailable",
                }));
            });
            v.cesiumWidget.creditDisplay.addStaticCredit(
              new C.Credit(
                'Buildings: <a href="https://buildings.reearth.land/">Re:Earth</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://docs.overturemaps.org/attribution/">Overture Maps</a>',
                true,
              ),
            );
            v.scene.requestRender();
          } catch {
            if (!disposed)
              setSourceStatus((s) => ({
                ...s,
                buildings: "Unavailable · imagery only",
              }));
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
      flyTicket.current++;
      handler?.destroy();
      removeMouseLeave?.();
      removeOcclusion?.();
      const v = viewer.current;
      if (v && !v.isDestroyed()) v.destroy();
      viewer.current = null;
      buildingTiles.current = null;
      terrainProvider.current = null;
    };
  }, [retry]);
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
      provider.errorEvent.addEventListener(() => {
        if (!disposed)
          setSourceStatus((s) => ({
            ...s,
            imagery: "Degraded · image tiles unavailable",
          }));
      });
      setSourceStatus((s) => ({
        ...s,
        imagery: caption.includes("unavailable")
          ? "Fallback · street map"
          : "Ready",
      }));
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
  // Commands and setting changes adjust React state while rendering; the
  // effects below only drive the Cesium camera.
  const [stopSeen, setStopSeen] = useState(stopCommand);
  if (stopSeen !== stopCommand) {
    setStopSeen(stopCommand);
    if (stopCommand) {
      setOrbit(false);
      setEntering(false);
    }
  }
  useEffect(() => {
    if (!stopCommand) return;
    orbitCleanup.current?.();
    orbitCleanup.current = null;
    viewer.current?.camera.cancelFlight();
    generation.current++;
  }, [stopCommand]);
  const [motionSeen, setMotionSeen] = useState(settings.motion);
  if (motionSeen !== settings.motion) {
    setMotionSeen(settings.motion);
    setEntering(false);
    if (settings.motion === "instant") setJourney(false);
    setOrbit(false);
    setFlightLens(null);
  }
  useEffect(() => {
    viewer.current?.camera.cancelFlight();
    generation.current++;
    orbitCleanup.current?.();
    orbitCleanup.current = null;
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
  const [zoomLensSeen, setZoomLensSeen] = useState(settings.zoomLens);
  if (zoomLensSeen !== settings.zoomLens) {
    setZoomLensSeen(settings.zoomLens);
    if (!settings.zoomLens) setFlightLens(null);
  }
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
      (v.scene.globe.getHeight(
        C.Cartographic.fromDegrees(selected.longitude!, selected.latitude!),
      ) || 0) + 35,
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
        heading +=
          (C.Math.toRadians(
            { slow: 2, normal: 6, fast: 15 }[
              currentSettings.current.orbitSpeed
            ],
          ) *
            Math.min(now - last, 50)) /
          1000;
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
  }, [orbit, selected?.id, ready, settings.motion, settings.orbitSpeed]);
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
  // A new target (once the globe is ready) selects it now and flies there
  // after the commit, as choose() does for a click.
  const [chosenFrom, setChosenFrom] = useState({ ready, target });
  if (chosenFrom.ready !== ready || chosenFrom.target !== target) {
    setChosenFrom({ ready, target });
    if (ready && target) {
      setOrbit(false);
      setJourney(false);
      setEntering(false);
    }
  }
  useEffect(() => {
    if (ready && target) flyToChoice(target);
  }, [ready, target]);
  useEffect(() => {
    const C = cesiumRef.current,
      v = viewer.current;
    if (!ready || !C || !v) return;
    const stage = new C.PostProcessStage({
      fragmentShader: sensorShader,
      uniforms: {
        mode: () => looks.indexOf(currentSettings.current.look),
        gain: () => currentSettings.current.gain,
        pixelation: () => currentSettings.current.pixelation,
        scanlines: () => currentSettings.current.scanlines,
        grain: () => currentSettings.current.grain,
        contrast: () => currentSettings.current.contrast,
        saturation: () => currentSettings.current.saturation,
        vignette: () => currentSettings.current.vignette,
        distortion: () => currentSettings.current.distortion,
        instability: () => currentSettings.current.instability,
        sensitivity: () => currentSettings.current.sensitivity,
        palette: () =>
          ["ironbow", "white", "black"].indexOf(
            currentSettings.current.thermalPalette,
          ),
        snowDensity: () => currentSettings.current.snowDensity,
        wind: () => currentSettings.current.wind,
        clockTime: () =>
          motionScale(currentSettings.current.motion)
            ? performance.now() / 1000
            : 0,
        sharpen: () => currentSettings.current.sharpen,
      },
    });
    v.scene.postProcessStages.add(stage);
    v.scene.requestRender();
    return () => {
      if (!v.isDestroyed()) v.scene.postProcessStages.remove(stage);
    };
  }, [ready, retry]);
  useEffect(() => {
    const v = viewer.current,
      C = cesiumRef.current;
    if (!ready || !v || !C) return;
    if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = settings.atmosphere;
    v.scene.fog.enabled = settings.fog;
    v.resolutionScale = {
      performance: 0.75,
      balanced: 1,
      high: Math.min(window.devicePixelRatio, 1.8),
    }[settings.quality];
    const bloom = v.scene.postProcessStages.bloom;
    bloom.enabled = settings.bloom;
    bloom.uniforms.glowOnly = false;
    bloom.uniforms.contrast = 128;
    bloom.uniforms.brightness = settings.bloomIntensity * 0.3 - 0.3;
    bloom.uniforms.sigma = 2;
    bloom.uniforms.stepSize = 1;
    const date = new Date();
    if (settings.sun !== "live") {
      const lon = selected?.longitude ?? telemetry.longitude;
      date.setUTCHours(
        { noon: 12, golden: 17, night: 0 }[settings.sun] - Math.round(lon / 15),
        0,
        0,
        0,
      );
    }
    v.clock.currentTime = C.JulianDate.fromDate(date);
    v.scene.requestRender();
    if (
      motionScale(settings.motion) &&
      ["crt", "nvg", "noir", "snow"].includes(settings.look)
    ) {
      const timer = setInterval(() => {
        if (!document.hidden && !v.isDestroyed()) v.scene.requestRender();
      }, 40);
      return () => clearInterval(timer);
    }
  }, [ready, settings, selected?.id]);
  useEffect(() => {
    const v = viewer.current,
      C = cesiumRef.current;
    if (!ready || !v || !C) return;
    const source = new C.CustomDataSource("earthquakes");
    void v.dataSources.add(source);
    let disposed = false;
    const refresh = async () => {
      if (!settings.earthquakes) {
        setQuakeStatus("Off");
        return;
      }
      setQuakeStatus("Loading");
      try {
        const r = await fetch("/api/globe/earthquakes"),
          b = (await r.json()) as {
            error: string;
            updatedAt: string;
            events: {
              id: string;
              longitude: number;
              latitude: number;
              magnitude: number;
              place: string;
              time: number;
              url: string | null;
            }[];
          };
        if (!r.ok) throw Error(b.error);
        if (disposed) return;
        source.entities.removeAll();
        for (const q of b.events)
          source.entities.add({
            id: `quake:${q.id}`,
            position: C.Cartesian3.fromDegrees(q.longitude, q.latitude),
            properties: { quake: q },
            point: {
              pixelSize: Math.max(5, Math.min(22, q.magnitude * 3)),
              color: C.Color.fromCssColorString("#ffb04f"),
              outlineColor: C.Color.fromCssColorString("#8f4800"),
              outlineWidth: 1,
              heightReference: C.HeightReference.CLAMP_TO_GROUND,
            },
          });
        setQuakeStatus(
          `${b.events.length} events · refreshed ${new Date(b.updatedAt).toLocaleTimeString()}`,
        );
        v.scene.requestRender();
      } catch {
        if (!disposed) {
          source.entities.removeAll();
          setQuakeStatus("Unavailable · no current data");
        }
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 300000);
    return () => {
      disposed = true;
      clearInterval(timer);
      if (!v.isDestroyed()) v.dataSources.remove(source, true);
    };
  }, [ready, settings.earthquakes, retry]);
  useEffect(() => {
    const v = viewer.current,
      C = cesiumRef.current;
    if (!ready || !v || !C) return;
    const source = new C.CustomDataSource("personal annotations");
    void v.dataSources.add(source);
    const colors = {
      orange: "#ff9c3b",
      blue: "#66b4ff",
      green: "#75d4a1",
      white: "#ffffff",
      red: "#ff6474",
    };
    for (const a of workspace.data?.preferences.annotations || []) {
      const positions = a.points.map(([lon, lat]) =>
        C.Cartesian3.fromDegrees(lon, lat),
      );
      const color = C.Color.fromCssColorString(colors[a.color]);
      source.entities.add({
        id: a.id,
        position: positions[0],
        label: {
          text: a.name,
          font: "14px sans-serif",
          fillColor: color,
          heightReference: C.HeightReference.CLAMP_TO_GROUND,
          pixelOffset: new C.Cartesian2(0, -18),
        },
        ...(a.type === "pin"
          ? {
              point: {
                pixelSize: 12,
                color,
                heightReference: C.HeightReference.CLAMP_TO_GROUND,
              },
            }
          : a.type === "area" && positions.length > 2
            ? {
                polygon: {
                  hierarchy: new C.PolygonHierarchy(positions),
                  material: color.withAlpha(0.25),
                  outline: true,
                  outlineColor: color,
                },
              }
            : {
                polyline: {
                  positions,
                  clampToGround: true,
                  width: 3,
                  material: color,
                },
              }),
      });
    }
    if (drawPoints.length)
      source.entities.add({
        polyline: {
          positions: drawPoints.map(([lon, lat]) =>
            C.Cartesian3.fromDegrees(lon, lat),
          ),
          clampToGround: true,
          width: 3,
          material: C.Color.ORANGE,
        },
      });
    v.scene.requestRender();
    return () => {
      if (!v.isDestroyed()) v.dataSources.remove(source, true);
    };
  }, [ready, workspace.data?.preferences.annotations, drawPoints]);
  function orient(north: boolean) {
    const C = cesiumRef.current,
      v = viewer.current;
    if (!C || !v) return;
    takeControl();
    const point = v.scene.globe.pick(
      v.camera.getPickRay(
        new C.Cartesian2(
          v.scene.canvas.clientWidth / 2,
          v.scene.canvas.clientHeight / 2,
        ),
      )!,
      v.scene,
    );
    if (!point) return;
    const range = C.Cartesian3.distance(v.camera.positionWC, point);
    v.camera.flyToBoundingSphere(new C.BoundingSphere(point, 0), {
      duration: 1.3 * motionScale(settings.motion),
      offset: new C.HeadingPitchRange(
        north ? 0 : v.camera.heading,
        north
          ? v.camera.pitch
          : v.camera.pitch < -0.9
            ? C.Math.toRadians(-35)
            : C.Math.toRadians(-89),
        range,
      ),
    });
  }
  async function saveScene() {
    const v = viewer.current,
      C = cesiumRef.current,
      w = workspace.data;
    if (!v || !C || !w || !sceneName.trim()) return;
    const p = v.camera.positionCartographic;
    const scene = sceneSchema.parse({
      id: crypto.randomUUID(),
      name: sceneName.trim(),
      longitude: C.Math.toDegrees(p.longitude),
      latitude: C.Math.toDegrees(p.latitude),
      height: p.height,
      heading: v.camera.heading,
      pitch: v.camera.pitch,
    });
    if (
      await workspace.mutate({
        action: "preferences",
        revision: w.preferenceRevision,
        data: { ...w.preferences, scenes: [...w.preferences.scenes, scene] },
      })
    )
      setSceneName("");
  }
  function recallScene(s: {
    longitude: number;
    latitude: number;
    height: number;
    heading: number;
    pitch: number;
  }) {
    const v = viewer.current,
      C = cesiumRef.current;
    if (!v || !C) return;
    takeControl();
    v.camera.flyTo({
      destination: C.Cartesian3.fromDegrees(s.longitude, s.latitude, s.height),
      orientation: { heading: s.heading, pitch: s.pitch, roll: 0 },
      duration: 3.5 * motionScale(settings.motion),
    });
  }
  function reset() {
    stopOrbit();
    setFlightLens(null);
    generation.current++;
    flyTicket.current++;
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
            <button onClick={() => orient(true)} aria-label="North up">
              N↑
            </button>
            <button
              onClick={() => orient(false)}
              aria-label="Toggle top-down view"
            >
              Tilt
            </button>
            <button
              onClick={() => setDirector(!director)}
              aria-label="Scene director"
            >
              Scenes
            </button>
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
      {settings.scope && (
        <div
          className="globe-persistent-scope"
          style={
            {
              "--scope-feather": `${settings.scopeFeather * 25 + 5}%`,
            } as React.CSSProperties
          }
          aria-hidden="true"
        />
      )}
      {settings.detection && (
        <div className="project-detection" aria-hidden="true">
          {brackets.map((b) => (
            <div key={b.id} style={{ left: b.x, top: b.y }}>
              <span>{b.name}</span>
            </div>
          ))}
        </div>
      )}
      {settings.hud !== "off" && (
        <div className={`globe-telemetry hud-${settings.hud}`}>
          <span>ATLAS / {settings.look.toUpperCase()}</span>
          <strong>
            {telemetry.latitude.toFixed(3)}° · {telemetry.longitude.toFixed(3)}°
          </strong>
          <small>
            ALT {(telemetry.altitude / 1000).toFixed(2)} km · HDG{" "}
            {telemetry.heading.toFixed(0)}°
          </small>
          {settings.hud !== "minimal" && (
            <>
              <small>{projects.length} authorised project records</small>
              <small>Imagery: {sourceStatus.imagery}</small>
              <small>
                Terrain: {settings.terrain ? sourceStatus.terrain : "Off"}
              </small>
              <small>
                Buildings: {settings.buildings ? sourceStatus.buildings : "Off"}
              </small>
            </>
          )}
          {settings.look !== "normal" && (
            <small>SIMULATED DISPLAY EFFECT</small>
          )}
        </div>
      )}
      {settings.earthquakes && (
        <div className="quake-source">USGS · {quakeStatus}</div>
      )}
      {quakeDetail && (
        <div className="quake-detail">
          <button
            aria-label="Close earthquake"
            onClick={() => setQuakeDetail(null)}
          >
            ×
          </button>
          <strong>
            M {quakeDetail.magnitude} · {quakeDetail.place}
          </strong>
          <small>{new Date(quakeDetail.time).toLocaleString()}</small>
          {quakeDetail.url && (
            <a href={quakeDetail.url} target="_blank" rel="noreferrer">
              USGS event details
            </a>
          )}
        </div>
      )}
      {director && (
        <section className="scene-director">
          <div className="suite-heading">
            <h3>Scene director</h3>
            <button
              onClick={() => setDirector(false)}
              aria-label="Close scene director"
            >
              ×
            </button>
          </div>
          <p>Camera bookmarks and annotations are private to your account.</p>
          <label>
            View name
            <input
              maxLength={80}
              value={sceneName}
              onChange={(e) => setSceneName(e.target.value)}
              placeholder="e.g. European portfolio"
            />
          </label>
          <Button
            disabled={
              !sceneName.trim() ||
              workspace.busy ||
              (workspace.data?.preferences.scenes.length || 0) >= 30
            }
            onClick={() => void saveScene()}
          >
            Save current view
          </Button>
          {workspace.data?.preferences.scenes.map((s) => (
            <div className="scene-bookmark" key={s.id}>
              <button onClick={() => recallScene(s)}>{s.name}</button>
              <button
                aria-label={`Remove ${s.name}`}
                disabled={workspace.busy}
                onClick={() =>
                  void workspace.mutate({
                    action: "preferences",
                    revision: workspace.data!.preferenceRevision,
                    data: {
                      ...workspace.data!.preferences,
                      scenes: workspace.data!.preferences.scenes.filter(
                        (x) => x.id !== s.id,
                      ),
                    },
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          <div className="suite-actions">
            <Button
              variant="outline"
              onClick={async () => {
                const v = viewer.current,
                  C = cesiumRef.current;
                if (!v || !C) return;
                const p = v.camera.positionCartographic;
                const camera = [
                  C.Math.toDegrees(p.longitude),
                  C.Math.toDegrees(p.latitude),
                  p.height,
                  v.camera.heading,
                  v.camera.pitch,
                ].join(",");
                try {
                  await navigator.clipboard.writeText(
                    `${location.origin}/?view=globe&camera=${encodeURIComponent(camera)}&look=${settings.look}`,
                  );
                  setSceneMessage(
                    "View link copied. It grants no project access.",
                  );
                } catch {
                  setSceneMessage("Clipboard unavailable.");
                }
              }}
            >
              Copy view link
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const blob = new Blob(
                    [
                      JSON.stringify(
                        workspace.data?.preferences.scenes || [],
                        null,
                        2,
                      ),
                    ],
                    { type: "application/json" },
                  ),
                  url = URL.createObjectURL(blob),
                  a = document.createElement("a");
                a.href = url;
                a.download = "atlas-scenes.json";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export scenes
            </Button>
          </div>
          <label>
            Import scenes
            <input
              type="file"
              accept="application/json,.json"
              disabled={workspace.busy}
              onChange={async (e) => {
                const file = e.target.files?.[0],
                  w = workspace.data;
                if (!file || !w) return;
                try {
                  if (file.size > 100000) throw Error();
                  const data = JSON.parse(await file.text());
                  if (!Array.isArray(data)) throw Error();
                  const scenes = data.map((x) => sceneSchema.parse(x));
                  if (scenes.length > 30) throw Error();
                  await workspace.mutate({
                    action: "preferences",
                    revision: w.preferenceRevision,
                    data: { ...w.preferences, scenes },
                  });
                } catch {
                  setSceneMessage(
                    "Choose a valid Atlas scene file with up to 30 views.",
                  );
                }
              }}
            />
          </label>
          <hr />
          <h3>Draw on the globe</h3>
          <p>
            {drawType
              ? `${drawPoints.length} point(s). Click the map, then save.`
              : "Pins, lines and areas are your annotations."}
          </p>
          <div className="suite-actions">
            {(["pin", "line", "area"] as const).map((type) => (
              <button
                className={drawType === type ? "active" : ""}
                key={type}
                onClick={() => {
                  setDrawType(type);
                  setDrawPoints([]);
                }}
              >
                {type}
              </button>
            ))}
            <button
              onClick={() => {
                setDrawType(null);
                setDrawPoints([]);
              }}
            >
              Cancel draw
            </button>
          </div>
          {drawType && (
            <>
              <label>
                Label
                <input
                  maxLength={100}
                  value={annotationName}
                  onChange={(e) => setAnnotationName(e.target.value)}
                />
              </label>
              <label>
                Color
                <select
                  value={annotationColor}
                  onChange={(e) =>
                    setAnnotationColor(e.target.value as typeof annotationColor)
                  }
                >
                  {["orange", "blue", "green", "white", "red"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <Button
                disabled={
                  workspace.busy ||
                  !annotationName.trim() ||
                  drawPoints.length <
                    (drawType === "pin" ? 1 : drawType === "line" ? 2 : 3)
                }
                onClick={async () => {
                  const w = workspace.data;
                  if (!w) return;
                  if (
                    await workspace.mutate({
                      action: "preferences",
                      revision: w.preferenceRevision,
                      data: {
                        ...w.preferences,
                        annotations: [
                          ...w.preferences.annotations,
                          {
                            id: crypto.randomUUID(),
                            name: annotationName.trim(),
                            type: drawType,
                            color: annotationColor,
                            points:
                              drawType === "pin"
                                ? drawPoints.slice(-1)
                                : drawPoints,
                          },
                        ],
                      },
                    })
                  ) {
                    setDrawType(null);
                    setDrawPoints([]);
                    setAnnotationName("");
                  }
                }}
              >
                Save annotation
              </Button>
            </>
          )}
          {!!workspace.data?.preferences.annotations.length && (
            <Button
              variant="outline"
              disabled={workspace.busy}
              onClick={() => {
                if (confirm("Clear your saved globe annotations?"))
                  void workspace.mutate({
                    action: "preferences",
                    revision: workspace.data!.preferenceRevision,
                    data: { ...workspace.data!.preferences, annotations: [] },
                  });
              }}
            >
              Clear my annotations
            </Button>
          )}
          <hr />
          <h3>Source status</h3>
          <p>
            Imagery: {sourceStatus.imagery}
            <br />
            Terrain: {settings.terrain ? sourceStatus.terrain : "Off"}
            <br />
            Buildings: {settings.buildings ? sourceStatus.buildings : "Off"}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setReady(false);
              setError("");
              setSourceStatus({
                terrain: "Loading",
                buildings: "Loading",
                imagery: "Loading",
              });
              setRetry((r) => r + 1);
            }}
          >
            Retry globe sources
          </Button>
          {(workspace.error || sceneMessage) && (
            <p role="status">{workspace.error || sceneMessage}</p>
          )}
        </section>
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
