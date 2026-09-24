"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { studioLight, woodTexture } from "@/lib/scene-lighting";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { ArrowRight } from "lucide-react";
import type { Project } from "@/lib/projects";
import { progress } from "@/lib/projects";
export type PortfolioView = "dashboard" | "globe";

/** A reversible, illustrative camera journey. It is not a model of a project site. */
export default function ViewFlight({
  from,
  to,
  duration,
  dark,
  projects,
  snapshot,
  onComplete,
}: {
  from: PortfolioView;
  to: PortfolioView;
  duration: number;
  dark: boolean;
  projects: Project[];
  snapshot: HTMLElement | null;
  onComplete: (view: PortfolioView) => void;
}) {
  const mount = useRef<HTMLDivElement>(null),
    snapshotMount = useRef<HTMLDivElement>(null);
  const dashboardSnapshot = useRef<HTMLElement | null>(null);
  const target = useRef(to),
    finish = useRef(onComplete),
    location = useRef(from === "dashboard" ? 0 : 1);
  const [phase, setPhase] = useState(
    from === "dashboard"
      ? "Leaving your workspace"
      : "Returning to your workspace",
  );
  const complete = useRef(false);
  useLayoutEffect(() => {
    target.current = to;
    finish.current = onComplete;
  });
  useEffect(() => {
    const node = snapshotMount.current;
    const surface = document.querySelector<HTMLElement>(".dashboard");
    // Work on a copy so the snapshot prop itself is never changed.
    const copy = (snapshot || surface)?.cloneNode(true) as
      | HTMLElement
      | undefined;
    if (copy && node) {
      copy.removeAttribute("id");
      copy.removeAttribute("role");
      copy.removeAttribute("aria-labelledby");
      copy.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
      if (!snapshot && surface) {
        copy.style.width = `${surface.getBoundingClientRect().width}px`;
        copy.style.margin = "0";
      }
      dashboardSnapshot.current = copy;
      node.appendChild(copy);
      return () => {
        copy.remove();
        dashboardSnapshot.current = null;
      };
    }
  }, [snapshot]);
  useEffect(() => {
    const node = mount.current;
    if (!node) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      finish.current(target.current);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    node.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const sky = new THREE.Color(dark ? "#10243b" : "#b8d8ec");
    scene.background = sky;
    scene.fog = new THREE.FogExp2(sky, 0.00009);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.025, 16000);
    const resources: { dispose: () => void }[] = [];
    const lighting = studioLight(renderer, scene),
      woodMap = woodTexture();
    resources.push(lighting, woodMap);
    const cube = new RoundedBoxGeometry(1, 1, 1, 2, 0.025);
    resources.push(cube);
    const material = (color: string, roughness = 0.75, metalness = 0) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      resources.push(m);
      return m;
    };
    const chalk = material(dark ? "#586776" : "#dfdfd5"),
      wood = material("#a2754c"),
      metal = material("#3c4856", 0.35, 0.65),
      orange = material("#e98300"),
      floor = material(dark ? "#566168" : "#b5b8b1");
    wood.map = woodMap;
    wood.roughness = 0.48;
    function box(
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      m: THREE.Material,
      parent: THREE.Object3D = scene,
      shadow = true,
    ) {
      const mesh = new THREE.Mesh(cube, m);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, y, z);
      mesh.castShadow = shadow;
      mesh.receiveShadow = shadow;
      parent.add(mesh);
      return mesh;
    }
    scene.add(
      new THREE.HemisphereLight(
        dark ? 0x92bde8 : 0xd7edff,
        0x715941,
        dark ? 1.7 : 2.4,
      ),
    );
    const sun = new THREE.DirectionalLight(dark ? 0xc7dcff : 0xffdfb0, 3.5);
    sun.position.set(-50, 100, 65);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.normalBias = 0.035;
    sun.shadow.bias = -0.0002;
    sun.shadow.radius = 3;
    Object.assign(sun.shadow.camera, {
      left: -35,
      right: 35,
      top: 40,
      bottom: -35,
      near: 1,
      far: 240,
    });
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    const room = new THREE.Group();
    room.position.y = 18;
    scene.add(room);
    box(12, 0.18, 12, 0, 0, 0, floor, room);
    box(12, 4.5, 0.18, 0, 2.25, -5.4, chalk, room);
    box(0.18, 4.5, 12, -6, 2.25, 0, chalk, room);
    box(0.18, 4.5, 12, 6, 2.25, 0, chalk, room);
    box(12, 0.2, 12, 0, 4.5, 0, chalk, room);
    for (const x of [-5.8, -3, 3, 5.8])
      box(0.09, 4.4, 0.1, x, 2.2, 5.8, metal, room);
    box(12, 0.12, 0.2, 0, 0.25, 5.8, metal, room);
    box(12, 0.12, 0.3, 0, 4.4, 6, orange, room);
    box(4.6, 0.15, 2.2, 0, 1.02, 0.2, wood, room);
    for (const x of [-1.9, 1.9])
      for (const z of [-0.6, 1]) box(0.08, 1, 0.08, x, 0.5, z, metal, room);
    box(3.25, 0.075, 1.4, 0, 1.16, 0.12, metal, room);
    box(3.15, 1.86, 0.1, 0, 2.12, -0.5, metal, room);
    const texture = dashboardTexture(projects, dark);
    resources.push(texture);
    const screenGeometry = new THREE.PlaneGeometry(3, 1.6875);
    resources.push(screenGeometry);
    const screenMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      toneMapped: false,
    });
    resources.push(screenMaterial);
    const screen = new THREE.Mesh(screenGeometry, screenMaterial);
    screen.position.set(0, 2.12, -0.438);
    room.add(screen);
    // Keyboard and trackpad are actual geometry, with a warm desk light and contact shadows.
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 12; c++)
        box(
          0.17,
          0.012,
          0.11,
          -1.1 + c * 0.2,
          1.205,
          -0.25 + r * 0.17,
          chalk,
          room,
          false,
        );
    box(0.68, 0.012, 0.26, 0, 1.206, 0.57, floor, room, false);
    box(0.18, 0.02, 0.5, 1.78, 1.14, 0.25, orange, room);
    const pot = material("#74644f"),
      green = material("#506b54");
    box(0.65, 0.8, 0.65, 4.9, 0.4, -3.8, pot, room);
    const leafGeometry = new THREE.IcosahedronGeometry(0.4, 1);
    resources.push(leafGeometry);
    for (let i = 0; i < 10; i++) {
      const leaf = new THREE.Mesh(leafGeometry, green);
      leaf.scale.set(0.75, 1.6, 0.65);
      leaf.position.set(
        4.9 + Math.sin(i * 2.4) * 0.45,
        1.1 + i * 0.12,
        -3.8 + Math.cos(i * 2.4) * 0.35,
      );
      leaf.castShadow = true;
      room.add(leaf);
    }
    const glow = new THREE.PointLight(0xffb15c, 18, 12);
    glow.position.set(-2.7, 3.2, 1.5);
    room.add(glow);
    box(0.7, 0.07, 0.7, -2.7, 3.4, 1.5, orange, room);
    // Exterior: one highlighted office above a quiet illustrative city.
    const facade = material(dark ? "#334653" : "#819aa8");
    box(12, 18, 12, 0, 9, 0, facade);
    for (let y = 2; y < 18; y += 3) box(12.06, 0.2, 12.06, 0, y, 0, metal);
    for (let x = -4; x <= 4; x += 2) box(0.12, 18, 12.1, x, 9, 0, chalk);
    const ground = material(dark ? "#172b36" : "#88a09e");
    box(14000, 1, 14000, 0, -0.8, 0, ground, scene, false);
    // One textured district avoids intersecting road strips and depth flicker at high altitude.
    const districtTexture = cityMap(dark);
    resources.push(districtTexture);
    const districtGeometry = new THREE.PlaneGeometry(580, 580);
    resources.push(districtGeometry);
    const districtMaterial = new THREE.MeshStandardMaterial({
      map: districtTexture,
      roughness: 1,
    });
    resources.push(districtMaterial);
    const district = new THREE.Mesh(districtGeometry, districtMaterial);
    district.rotation.x = -Math.PI / 2;
    district.position.y = 0.08;
    scene.add(district);
    const cityMaterial = material(dark ? "#526473" : "#a4b4bc");
    const city = new THREE.InstancedMesh(cube, cityMaterial, 168);
    let index = 0;
    const dummy = new THREE.Object3D();
    for (let x = -6; x <= 6; x++)
      for (let z = -6; z <= 6; z++) {
        if (x === 0 && z === 0) continue;
        const n = Math.abs(Math.sin(x * 32.53 + z * 19.27));
        const h = 9 + n * 39;
        dummy.position.set(x * 38 + 17, h / 2, z * 38 + 16);
        dummy.scale.set(14 + n * 9, h, 13 + n * 8);
        dummy.updateMatrix();
        city.setMatrixAt(index, dummy.matrix);
        city.setColorAt(
          index,
          new THREE.Color().setHSL(
            0.55,
            0.08,
            dark ? 0.25 + n * 0.1 : 0.54 + n * 0.16,
          ),
        );
        index++;
      }
    city.count = index;
    city.castShadow = false;
    city.receiveShadow = false;
    scene.add(city);
    resources.push(city);
    // Soft cloud banks carry the transition into the live Cesium view; no map location is implied.
    const cloudGeometry = new THREE.PlaneGeometry(550, 280);
    resources.push(cloudGeometry);
    const cloudTexture = cloudMap();
    resources.push(cloudTexture);
    const cloudMaterial = new THREE.MeshBasicMaterial({
      map: cloudTexture,
      transparent: true,
      opacity: dark ? 0.22 : 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
      color: dark ? 0x9eb7d0 : 0xffffff,
    });
    resources.push(cloudMaterial);
    const clouds: THREE.Mesh[] = [];
    for (let i = 0; i < 12; i++) {
      const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial);
      cloud.position.set(
        Math.sin(i * 2.1) * 800,
        130 + (i % 3) * 90,
        Math.cos(i * 2.1) * 650,
      );
      cloud.scale.setScalar(0.8 + (i % 4) * 0.35);
      scene.add(cloud);
      clouds.push(cloud);
    }
    const positions = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0, 20.12, 1.37),
        new THREE.Vector3(0.5, 20.9, 4.4),
        new THREE.Vector3(1, 22, 12),
        new THREE.Vector3(40, 72, 95),
        new THREE.Vector3(100, 230, 310),
        new THREE.Vector3(350, 750, 980),
      ],
      false,
      "centripetal",
    );
    const looks = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0, 20.12, -0.438),
        new THREE.Vector3(0, 20.12, -0.438),
        new THREE.Vector3(0, 19, 0),
        new THREE.Vector3(0, 10, 0),
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 0),
      ],
      false,
      "centripetal",
    );
    let frame = 0,
      last = performance.now(),
      disposed = false,
      lastPhase = "";
    const outer = node.parentElement!;
    const resize = () => {
      const w = node.clientWidth,
        h = node.clientHeight;
      if (!w || !h) return;
      if (dashboardSnapshot.current)
        dashboardSnapshot.current.style.width = `${w}px`;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    resize();
    const contextLost = (e: Event) => {
      e.preventDefault();
      finish.current(target.current);
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    function tick(now: number) {
      if (disposed) return;
      const delta = Math.min((now - last) / 1000, 0.08);
      last = now;
      const goal = target.current === "globe" ? 1 : 0;
      const step = delta / Math.max(0.5, duration);
      location.current =
        goal === 1
          ? Math.min(1, location.current + step)
          : Math.max(0, location.current - step);
      const t = location.current;
      // The spline supplies continuous position even if the destination reverses mid-flight.
      const eased = t * t * (3 - 2 * t);
      camera.position.copy(positions.getPoint(eased));
      const near = Math.max(0.025, camera.position.y / 600);
      if (Math.abs(camera.near - near) > 0.001) {
        camera.near = near;
        camera.updateProjectionMatrix();
      }
      camera.lookAt(looks.getPoint(eased));
      camera.rotateZ(
        Math.sin(eased * Math.PI) *
          0.025 *
          (target.current === "globe" ? 1 : -1),
      );
      const desiredFov = 50 + Math.sin(eased * Math.PI) * 7;
      if (Math.abs(camera.fov - desiredFov) > 0.05) {
        camera.fov = desiredFov;
        camera.updateProjectionMatrix();
      }
      for (const cloud of clouds) cloud.quaternion.copy(camera.quaternion);
      const fade =
        goal === 1 ? Math.min(1, (1 - t) / 0.12) : Math.min(1, t / 0.1);
      outer.style.opacity = String(Math.max(0, fade));
      if (snapshotMount.current && dashboardSnapshot.current) {
        // Keep the actual DOM dashboard opaque and pin its four corners to the laptop screen.
        // A short geometry blend starts exactly at the viewport edge, avoiding a double-image crossfade.
        scene.updateMatrixWorld();
        camera.updateMatrixWorld();
        const w = node!.clientWidth,
          h = node!.clientHeight,
          blend = Math.min(1, t / 0.12);
        const start = [
          [0, 0],
          [w, 0],
          [w, h],
          [0, h],
        ];
        const halfWidth = Math.min(1.5, (0.84375 * w) / h);
        const halfHeight = Math.min(0.84375, (1.5 * h) / w);
        const corners = [
          [-halfWidth, halfHeight],
          [halfWidth, halfHeight],
          [halfWidth, -halfHeight],
          [-halfWidth, -halfHeight],
        ].map(([x, y], i) => {
          const point = new THREE.Vector3(x, y, 0);
          screen.localToWorld(point);
          point.project(camera);
          const px = ((point.x + 1) * w) / 2,
            py = ((1 - point.y) * h) / 2;
          return [
            start[i][0] + (px - start[i][0]) * blend,
            start[i][1] + (py - start[i][1]) * blend,
          ];
        });
        snapshotMount.current.style.transform = quadTransform(corners, w, h);
        snapshotMount.current.style.opacity = t < 0.44 ? "1" : "0";
        // Only reveal the simplified distant texture after the real dashboard becomes tiny.
        const nextMap = t < 0.44 ? null : texture;
        if (screenMaterial.map !== nextMap) {
          screenMaterial.map = nextMap;
          screenMaterial.color.set(
            t < 0.44 ? (dark ? "#0e1720" : "#f3f6f7") : "#ffffff",
          );
          screenMaterial.needsUpdate = true;
        }
      }
      const caption =
        goal === 1
          ? t < 0.3
            ? "Leaving your workspace"
            : t < 0.72
              ? "Rising above the city"
              : "A wider perspective"
          : t > 0.68
            ? "Descending to your workspace"
            : t > 0.3
              ? "Back through the window"
              : "Returning to your dashboard";
      if (caption !== lastPhase) {
        setPhase(caption);
        lastPhase = caption;
      }
      renderer.render(scene, camera);
      if (t === goal && !complete.current) {
        complete.current = true;
        finish.current(target.current);
        return;
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      resources.forEach((r) => r.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
    // The scene stays mounted when `to` changes so reversing does not reset the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="view-flight" data-direction={to}>
      <div className="view-flight-canvas" ref={mount} aria-hidden="true" />
      <div
        className="view-flight-snapshot"
        ref={snapshotMount}
        aria-hidden="true"
        inert
      />
      <div className="view-flight-caption" role="status">
        <span>ATLAS / CHANGE PERSPECTIVE</span>
        <strong>{phase}</strong>
        <small>Stylized workspace transition</small>
      </div>
      <button
        className="view-flight-skip"
        onClick={() => finish.current(target.current)}
      >
        Skip to {to === "globe" ? "Project Eye" : "Dashboard"}
        <ArrowRight size={15} />
      </button>
    </div>
  );
}

function dashboardTexture(projects: Project[], dark: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 900;
  const c = canvas.getContext("2d")!;
  const bg = dark ? "#0e1720" : "#f3f6f7",
    card = dark ? "#182833" : "#ffffff",
    ink = dark ? "#eef2f7" : "#253d4b",
    muted = dark ? "#a7b6c3" : "#657d8a";
  c.fillStyle = bg;
  c.fillRect(0, 0, 1600, 900);
  c.fillStyle = card;
  c.fillRect(0, 0, 230, 900);
  c.fillRect(230, 0, 1370, 75);
  c.fillStyle = "#e98300";
  c.fillRect(30, 30, 115, 57);
  c.fillStyle = "#fff";
  c.font = "bold italic 38px sans-serif";
  c.fillText("TE", 47, 73);
  c.font = "bold 24px sans-serif";
  c.fillStyle = ink;
  c.fillText("ATLAS", 32, 133);
  c.font = "18px sans-serif";
  ["Portfolio", "Briefings", "Ideas & AI", "FlightDeck OS"].forEach((x, i) => {
    c.fillStyle = i ? muted : "#e98300";
    c.fillText(x, 32, 210 + i * 58);
  });
  c.fillStyle = ink;
  c.font = "18px sans-serif";
  c.fillText("Workspace / Dashboard", 270, 46);
  c.fillStyle = "#e98300";
  c.fillRect(1410, 20, 155, 36);
  c.fillStyle = "#21180d";
  c.fillText("+ New project", 1425, 45);
  c.fillStyle = muted;
  c.font = "15px sans-serif";
  c.fillText("THE BIG PICTURE", 280, 128);
  c.fillStyle = ink;
  c.font = "bold 41px sans-serif";
  c.fillText("Everything in motion.", 280, 185);
  for (let i = 0; i < 4; i++) {
    c.fillStyle = card;
    c.fillRect(280 + i * 310, 220, 290, 110);
    c.fillStyle = muted;
    c.font = "14px sans-serif";
    c.fillText(
      ["TOTAL PROJECTS", "IN PROGRESS", "TASKS COMPLETE", "ON THE MAP"][i],
      300 + i * 310,
      249,
    );
    c.fillStyle = ink;
    c.font = "35px sans-serif";
    c.fillText(
      String(
        [
          projects.length,
          projects.filter((p) => p.status === "In progress").length,
          projects.reduce(
            (sum, p) => sum + p.tasks.filter((t) => t.done).length,
            0,
          ),
          projects.filter((p) => p.latitude !== null).length,
        ][i],
      ),
      300 + i * 310,
      299,
    );
  }
  c.font = "bold 24px sans-serif";
  c.fillStyle = ink;
  c.fillText("Your projects", 280, 385);
  projects.slice(0, 6).forEach((p, i) => {
    const x = 280 + (i % 3) * 420,
      y = 420 + Math.floor(i / 3) * 223;
    c.fillStyle = card;
    c.fillRect(x, y, 395, 196);
    c.fillStyle = "#e98300";
    c.fillRect(x + 20, y + 20, 36, 36);
    c.fillStyle = muted;
    c.font = "13px sans-serif";
    c.fillText(p.status, x + 220, y + 43);
    c.fillStyle = ink;
    c.font = "bold 21px sans-serif";
    c.fillText(p.name.slice(0, 27), x + 20, y + 94);
    c.fillStyle = muted;
    c.font = "14px sans-serif";
    c.fillText(p.location.slice(0, 35) || "Project workspace", x + 20, y + 125);
    c.fillStyle = dark ? "#304553" : "#e5ecf0";
    c.fillRect(x + 20, y + 150, 355, 6);
    c.fillStyle = "#e98300";
    c.fillRect(x + 20, y + 150, (355 * progress(p)) / 100, 6);
  });
  const logo = document.querySelector<HTMLImageElement>("img.te-logo");
  if (logo?.complete && logo.naturalWidth) c.drawImage(logo, 30, 30, 115, 60);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function cloudMap() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  for (const [x, y, r] of [
    [70, 65, 50],
    [125, 48, 48],
    [175, 72, 55],
    [130, 84, 50],
  ]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,.75)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
  }
  return new THREE.CanvasTexture(c);
}

function quadTransform(points: number[][], width: number, height: number) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = points;
  const dx1 = x1 - x2,
    dx2 = x3 - x2,
    dx3 = x0 - x1 + x2 - x3,
    dy1 = y1 - y2,
    dy2 = y3 - y2,
    dy3 = y0 - y1 + y2 - y3;
  const denominator = dx1 * dy2 - dx2 * dy1;
  const g =
    Math.abs(denominator) < 1e-8 ? 0 : (dx3 * dy2 - dx2 * dy3) / denominator;
  const h =
    Math.abs(denominator) < 1e-8 ? 0 : (dx1 * dy3 - dx3 * dy1) / denominator;
  return `matrix3d(${(x1 - x0 + g * x1) / width},${(y1 - y0 + g * y1) / width},0,${g / width},${(x3 - x0 + h * x3) / height},${(y3 - y0 + h * y3) / height},0,${h / height},0,0,1,0,${x0},${y0},0,1)`;
}

function cityMap(dark: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext("2d")!;
  context.fillStyle = dark ? "#263f49" : "#8ca3a4";
  context.fillRect(0, 0, 1024, 1024);
  const scale = 1024 / 580;
  context.strokeStyle = dark ? "#172b36" : "#637e86";
  context.lineWidth = 8 * scale;
  context.beginPath();
  for (let n = -7; n <= 7; n++) {
    const p = 512 + n * 38 * scale;
    context.moveTo(p, 0);
    context.lineTo(p, 1024);
    context.moveTo(0, p);
    context.lineTo(1024, p);
  }
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
