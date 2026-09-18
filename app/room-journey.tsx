"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { studioLight, woodTexture } from "@/lib/scene-lighting";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Project } from "@/lib/projects";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export default function RoomJourney({
  project,
  durationScale = 1,
  onComplete,
  onCancel,
}: {
  project: Project;
  durationScale?: number;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [mountNode, setMountNode] = useState<HTMLDivElement | null>(null),
    finish = useRef(onComplete),
    [phase, setPhase] = useState("ENTERING THE ROOM");
  finish.current = onComplete;
  useEffect(() => {
    if (!mountNode) return;
    let frame = 0,
      disposed = false;
    const mount = mountNode;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setPhase("WORKSPACE READY");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#111820");
    scene.fog = new THREE.FogExp2("#18202a", 0.028);
    const camera = new THREE.PerspectiveCamera(52, 1, 0.02, 120);
    const resources: { dispose: () => void }[] = [];
    const lighting = studioLight(renderer, scene),
      woodMap = woodTexture();
    resources.push(lighting, woodMap);
    const material = (color: string, roughness = 0.8, metalness = 0) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      resources.push(m);
      return m;
    };
    const wall = material("#777c79"),
      floor = material("#5e5445"),
      wood = material("#9b714d"),
      dark = material("#252d36"),
      metal = material("#89919c", 0.3, 0.8),
      leaf = material("#426756");
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
    ) {
      const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.12);
      resources.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    }
    scene.add(new THREE.HemisphereLight(0xb8d6ed, 0x3e2a1d, 2.2));
    const sun = new THREE.DirectionalLight(0xffd6aa, 5);
    sun.position.set(-5, 8, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.normalBias = 0.035;
    sun.shadow.bias = -0.0002;
    sun.shadow.radius = 3;
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    scene.add(sun);
    const glow = new THREE.PointLight(0xff9a64, 20, 9);
    glow.position.set(2.3, 2.1, -1);
    scene.add(glow);
    box(10, 0.15, 11, 0, -0.08, 0, floor);
    box(10, 5, 0.18, 0, 2.5, -4.5, wall);
    box(0.18, 5, 11, -5, 2.5, 0, wall);
    box(0.18, 5, 11, 5, 2.5, 0, wall);
    box(10, 0.15, 11, 0, 5, 0, dark);
    // Open facade with architectural window mullions makes the camera handoff spatial.
    for (const x of [-4.8, -2.4, 0, 2.4, 4.8])
      box(0.075, 5, 0.1, x, 2.5, 4.5, dark);
    box(10, 0.08, 0.1, 0, 2.8, 4.5, dark);
    box(10, 0.08, 0.1, 0, 0.3, 4.5, dark);
    for (let i = 0; i < 18; i++)
      box(
        0.02,
        0.01,
        11,
        -4.8 + i * 0.56,
        0.008,
        0,
        material(i % 2 ? "#665a49" : "#594e40"),
      );
    // Desk, laptop, shelves, lamp and a plant are functional 3D scene geometry.
    box(3.8, 0.15, 1.8, 0, 1.35, -1, wood);
    for (const x of [-1.65, 1.65])
      for (const z of [-1.6, -0.4]) box(0.07, 1.3, 0.07, x, 0.65, z, dark);
    box(1.3, 0.06, 0.85, 0, 1.47, -0.9, metal);
    const screenBack = box(1.3, 0.85, 0.055, 0, 1.93, -1.28, dark);
    screenBack.rotation.x = -0.12;
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 640;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#141b22";
    ctx.fillRect(0, 0, 1024, 640);
    ctx.fillStyle = "#e98300";
    ctx.font = "bold 35px sans-serif";
    ctx.fillText("TE / ATLAS", 50, 65);
    ctx.fillStyle = "#dce7ef";
    ctx.font = "36px sans-serif";
    ctx.fillText(project.name.slice(0, 32), 50, 155);
    ctx.fillStyle = "#8fa7bb";
    ctx.font = "20px sans-serif";
    ctx.fillText("YOUR PROJECT WORKSPACE", 50, 107);
    project.tasks.slice(0, 5).forEach((t, i) => {
      const y = 220 + i * 65;
      ctx.fillStyle = "#25323e";
      ctx.fillRect(48, y - 24, 928, 52);
      ctx.fillStyle = t.done ? "#8abb9f" : "#dce7ef";
      ctx.font = "22px sans-serif";
      ctx.fillText(`${t.done ? "✓" : "○"}  ${t.title.slice(0, 65)}`, 65, y + 9);
    });
    if (!project.tasks.length) {
      ctx.fillStyle = "#a6b7c5";
      ctx.font = "25px sans-serif";
      ctx.fillText("A new idea starts here.", 50, 240);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    resources.push(texture);
    const screenMaterial = new THREE.MeshBasicMaterial({ map: texture });
    resources.push(screenMaterial);
    const screen = box(1.21, 0.76, 0.005, 0, 1.934, -1.245, screenMaterial);
    screen.rotation.x = -0.12;
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 12; col++)
        box(
          0.075,
          0.01,
          0.05,
          -0.5 + col * 0.09,
          1.509,
          -1.1 + row * 0.075,
          dark,
        );
    box(0.38, 0.005, 0.2, 0, 1.508, -0.65, dark);
    box(1.35, 0.12, 0.65, -3.7, 1.3, -4.1, wood);
    box(1.35, 0.12, 0.65, -3.7, 2.3, -4.1, wood);
    box(1.35, 0.12, 0.65, -3.7, 3.3, -4.1, wood);
    for (let i = 0; i < 8; i++)
      box(
        0.12,
        0.35 + Math.sin(i) * 0.07,
        0.3,
        -4.2 + i * 0.15,
        1.56,
        -4.1,
        material(["#b28468", "#637c86", "#b8b0a1"][i % 3]),
      );
    box(0.2, 0.05, 0.2, 1.3, 1.47, -1.15, metal);
    box(0.045, 0.85, 0.045, 1.3, 1.9, -1.15, metal);
    const lampGeo = new THREE.ConeGeometry(0.25, 0.25, 24);
    resources.push(lampGeo);
    const lamp = new THREE.Mesh(lampGeo, dark);
    lamp.position.set(1.3, 2.35, -1.15);
    scene.add(lamp);
    const potGeo = new THREE.CylinderGeometry(0.34, 0.26, 0.6, 24);
    resources.push(potGeo);
    const pot = new THREE.Mesh(potGeo, material("#b7aaa0"));
    pot.position.set(3.4, 0.3, -3);
    scene.add(pot);
    for (let i = 0; i < 10; i++) {
      const geo = new THREE.SphereGeometry(0.22, 12, 10);
      resources.push(geo);
      const l = new THREE.Mesh(geo, leaf);
      l.scale.set(1, 0.28, 2.2);
      l.position.set(
        3.4 + Math.sin(i * 2.4) * 0.45,
        0.9 + i * 0.1,
        -3 + Math.cos(i * 2.4) * 0.4,
      );
      l.rotation.set(i * 0.18, i, Math.sin(i));
      scene.add(l);
    }
    box(1, 0.1, 0.9, 0, 0.85, 0.75, dark);
    box(1, 0.85, 0.1, 0, 1.3, 1.2, dark);
    for (const x of [-0.4, 0.4])
      for (const z of [0.4, 1.1]) box(0.05, 0.8, 0.05, x, 0.4, z, metal);
    const posterMat = material("#bb7053");
    box(1.5, 2, 0.04, 2.5, 2.5, -4.37, posterMat);
    box(0.8, 0.08, 0.05, 2.5, 2.5, -4.32, material("#e3bca1"));
    const start = performance.now();
    const positionA = new THREE.Vector3(4, 3.1, 8),
      positionB = new THREE.Vector3(2.4, 2.7, 3),
      positionC = new THREE.Vector3(0.3, 2.15, 0.7),
      positionD = new THREE.Vector3(0, 1.96, -0.9);
    const look = new THREE.Vector3(0, 1.8, -1.2);
    const path = new THREE.CatmullRomCurve3(
      [positionA, positionB, positionC, positionD],
      false,
      "centripetal",
    );
    const ease = (t: number) => t * t * (3 - 2 * t);
    const resize = () => {
      if (disposed) return;
      const w = mount.clientWidth,
        h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    let lastPhase = "";
    function tick() {
      if (disposed) return;
      const t =
        (performance.now() - start) / (1000 * Math.max(0.1, durationScale));
      const u = Math.min(1, t / 8.5),
        smooth = u * u * u * (u * (u * 6 - 15) + 10);
      camera.position.copy(path.getPoint(smooth));
      const aim = look.clone().lerp(new THREE.Vector3(0, 1.96, -1.25), smooth);
      camera.lookAt(aim);
      camera.rotateZ(Math.sin(u * Math.PI) * 0.018);
      camera.fov = 52 - 10 * smooth;
      camera.updateProjectionMatrix();
      const p =
        t < 3
          ? "ENTERING THE ROOM"
          : t < 6
            ? "TAKE YOUR SEAT"
            : "OPENING YOUR WORKSPACE";
      if (lastPhase !== p) {
        setPhase(p);
        lastPhase = p;
      }
      renderer.render(scene, camera);
      if (t >= 8.5) {
        finish.current();
        return;
      }
      frame = requestAnimationFrame(tick);
    }
    tick();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      resources.forEach((r) => r.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [project, mountNode, durationScale]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent showCloseButton={false} className="journey-dialog">
        <DialogTitle className="sr-only">Entering {project.name}</DialogTitle>
        <DialogDescription className="sr-only">
          Animated journey through a stylized workspace. Skip to open the
          project, or press Escape to return to the globe.
        </DialogDescription>
        <div ref={setMountNode} className="journey-canvas" />
        <div className="journey-caption">
          <span>{phase}</span>
          <h2>{project.name}</h2>
          <p style={{ fontSize: 12, color: "#afb7c0" }}>
            A stylized workspace · {project.location}
          </p>
        </div>
        <div className="journey-skip">
          <Button variant="outline" onClick={onCancel}>
            Back to globe
          </Button>
          <Button style={{ marginLeft: 10 }} onClick={onComplete}>
            Skip animation
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
