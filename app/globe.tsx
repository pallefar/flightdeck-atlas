"use client";
import { useEffect, useRef, useState } from "react";
import type * as CesiumType from "cesium";
import { ArrowRight, Globe2, Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Project } from "@/lib/projects";
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
}: {
  projects: Project[];
  target: Project | null;
  onOpen: (p: Project) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    viewer = useRef<CesiumType.Viewer | null>(null),
    cesiumRef = useRef<CesiumModule | null>(null),
    currentProjects = useRef(projects),
    active = useRef(true),
    generation = useRef(0);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Project | null>(null),
    [journey, setJourney] = useState(false),
    [entering, setEntering] = useState(false),
    [mapMode, setMapMode] = useState("Satellite imagery"),
    [imageryReady, setImageryReady] = useState(false);
  currentProjects.current = projects;
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
    const point = C.Cartesian3.fromDegrees(p.longitude, p.latitude, 35);
    v.camera.flyToBoundingSphere(new C.BoundingSphere(point, 0), {
      offset: new C.HeadingPitchRange(
        C.Math.toRadians(25),
        C.Math.toRadians(close ? -15 : -40),
        close ? 150 : 1500,
      ),
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : close
          ? 2.5
          : 4.5,
      easingFunction: C.EasingFunction.CUBIC_IN_OUT,
      cancel: () => {
        if (active.current) setEntering(false);
      },
      complete,
    });
  }
  function choose(p: Project) {
    generation.current++;
    setJourney(false);
    setEntering(false);
    setSelected(p);
    fly(p);
  }
  useEffect(() => {
    let disposed = false;
    active.current = true;
    let handler: CesiumType.ScreenSpaceEventHandler | undefined;
    let removeOcclusion: (() => void) | undefined;
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
        removeOcclusion = v.scene.preRender.addEventListener(() => {
          occluder.cameraPosition = v.camera.positionWC;
          for (const entity of v.entities.values) {
            const position = entity.position?.getValue(v.clock.currentTime);
            if (position) entity.show = occluder.isPointVisible(position);
          }
        });
        handler = new C.ScreenSpaceEventHandler(v.scene.canvas);
        handler.setInputAction(
          (movement: { position: CesiumType.Cartesian2 }) => {
            const hit = v.scene.pick(movement.position);
            const id = hit?.id?.id;
            const p = currentProjects.current.find((x) => x.id === id);
            if (p) choose(p);
          },
          C.ScreenSpaceEventType.LEFT_CLICK,
        );
        void (async () => {
          try {
            const imagery = await C.ArcGisMapServerImageryProvider.fromUrl(
              "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
              { enablePickFeatures: false },
            );
            if (disposed) return;
            const layer = v.imageryLayers.addImageryProvider(imagery);
            layer.brightness = 0.87;
            layer.saturation = 0.72;
            setImageryReady(true);
            v.scene.requestRender();
          } catch {
            if (disposed) return;
            v.imageryLayers.addImageryProvider(
              new C.OpenStreetMapImageryProvider({
                url: "https://tile.openstreetmap.org/",
              }),
            );
            setMapMode("Street map fallback");
            setImageryReady(true);
          }
        })();
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
            if (!disposed) v.terrainProvider = terrain;
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
            v.scene.primitives.add(buildings);
            v.cesiumWidget.creditDisplay.addStaticCredit(
              new C.Credit(
                'Buildings: <a href="https://buildings.reearth.land/">Re:Earth</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://docs.overturemaps.org/attribution/">Overture Maps</a>',
                true,
              ),
            );
            setMapMode("Satellite + 3D building footprints");
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
      generation.current++;
      handler?.destroy();
      removeOcclusion?.();
      const v = viewer.current;
      if (v && !v.isDestroyed()) v.destroy();
      viewer.current = null;
    };
  }, []);
  useEffect(() => {
    const C = cesiumRef.current,
      v = viewer.current;
    if (!ready || !C || !v) return;
    v.entities.removeAll();
    projects
      .filter((p) => p.latitude !== null && p.longitude !== null)
      .forEach((p) => {
        const color = C.Color.fromCssColorString(
          {
            orange: "#ff9170",
            blue: "#88baff",
            green: "#9be2be",
            violet: "#c3acff",
          }[p.color],
        );
        v.entities.add({
          id: p.id,
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
  }, [ready, projects]);
  useEffect(() => {
    if (ready && target) choose(target);
  }, [ready, target]);
  useEffect(() => {
    setSelected((previous) =>
      previous ? projects.find((p) => p.id === previous.id) || null : null,
    );
  }, [projects]);
  function reset() {
    generation.current++;
    setJourney(false);
    setEntering(false);
    setSelected(null);
    const C = cesiumRef.current,
      v = viewer.current;
    if (C && v) {
      v.camera.cancelFlight();
      v.camera.flyTo({
        destination: C.Cartesian3.fromDegrees(18, 30, 15_500_000),
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 2,
      });
    }
  }
  function enter() {
    if (!selected) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
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
            <button onClick={reset} aria-label="Reset to globe">
              <Globe2 size={17} />
              <span>World</span>
            </button>
            <button
              onClick={() => {
                viewer.current?.camera.zoomIn(
                  viewer.current.camera.positionCartographic.height * 0.4,
                );
                viewer.current?.scene.requestRender();
              }}
              aria-label="Zoom in"
            >
              <Plus size={17} />
            </button>
            <button
              onClick={() => {
                viewer.current?.camera.zoomOut(
                  viewer.current.camera.positionCartographic.height * 0.6,
                );
                viewer.current?.scene.requestRender();
              }}
              aria-label="Zoom out"
            >
              <Minus size={17} />
            </button>
          </div>
          <div className="globe-hint">
            {mapMode} · Drag to orbit · Scroll to zoom
          </div>
        </>
      )}
      {selected && !journey && (
        <div className="destination-card">
          <span className="eyebrow">DESTINATION SELECTED</span>
          <h2>{selected.name}</h2>
          <p>
            {selected.location}
            <br />
            {selected.latitude?.toFixed(4)}°, {selected.longitude?.toFixed(4)}°
          </p>
          <Button onClick={enter} disabled={entering || !imageryReady}>
            {entering ? "Approaching your workspace…" : "Enter workspace"}
            <ArrowRight size={16} />
          </Button>
          <small>Building → stylized room → your project</small>
          <button
            className="text-link"
            style={{ marginTop: 12, fontSize: 11 }}
            onClick={() => {
              viewer.current?.camera.cancelFlight();
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
