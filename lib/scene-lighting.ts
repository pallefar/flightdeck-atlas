import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
/** Studio light bounced onto physical surfaces; stays inside the interactive renderer. */
export function studioLight(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const pmrem = new THREE.PMREMGenerator(renderer),
    room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.05);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.65;
  room.dispose();
  pmrem.dispose();
  return environment;
}
export function woodTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#aa8055";
  c.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 220; i++) {
    const y = i * 1.2;
    c.strokeStyle = `rgba(${i % 3 ? 72 : 240},${i % 3 ? 42 : 193},${i % 3 ? 21 : 130},${0.02 + (i % 7) * 0.007})`;
    c.lineWidth = 0.5 + (i % 4) * 0.25;
    c.beginPath();
    c.moveTo(0, y);
    for (let x = 0; x <= 512; x += 8)
      c.lineTo(
        x,
        y +
          Math.sin(x * 0.018 + i * 0.08) * 1.5 +
          Math.sin(x * 0.035 + i) * 0.7,
      );
    c.stroke();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
