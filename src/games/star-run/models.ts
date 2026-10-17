import { line } from '../../engine/draw';

export type Vec3 = [number, number, number];

export interface Model {
  verts: Vec3[];
  edges: [number, number][];
}

/** Brennweite der Perspektive und Bildmitte (Fadenkreuz). */
export const FOCAL = 220;
export const CX = 192;
export const CY = 114;
/** Näher als das wird nichts mehr gezeichnet. */
const NEAR = 3;

export interface Camera {
  x: number;
  y: number;
}

export function project(cam: Camera, x: number, y: number, z: number): [number, number] | null {
  if (z < NEAR) return null;
  return [CX + ((x - cam.x) * FOCAL) / z, CY + ((y - cam.y) * FOCAL) / z];
}

/** Gegnerischer Jäger: Deltaflügel mit Finne, Nase zeigt zum Spieler. */
export const FIGHTER: Model = {
  verts: [
    [0, 0, -14], // Nase
    [-18, 3, 6], // linke Flügelspitze
    [18, 3, 6], // rechte Flügelspitze
    [0, -7, 6], // Finne
    [0, 3, 8], // Heck
    [-7, 1, 2],
    [7, 1, 2],
  ],
  edges: [
    [0, 1], [0, 2], [0, 3], [1, 4], [2, 4], [3, 4], [1, 3], [2, 3], [5, 6], [0, 5], [0, 6],
  ],
};

/** Zufällig verbeulter Asteroid aus Breiten- und Längenringen. */
export function makeRock(radius: number): Model {
  const verts: Vec3[] = [];
  const edges: [number, number][] = [];
  const LON = 7;
  const lats = [-0.75, 0, 0.75];
  const jitter = () => radius * (0.75 + Math.random() * 0.4);
  verts.push([0, -jitter(), 0]);
  for (const lat of lats) {
    for (let i = 0; i < LON; i++) {
      const a = (i / LON) * Math.PI * 2;
      const r = jitter();
      verts.push([Math.cos(a) * Math.cos(lat) * r, Math.sin(lat) * r, Math.sin(a) * Math.cos(lat) * r]);
    }
  }
  verts.push([0, jitter(), 0]);
  const bottom = verts.length - 1;
  const idx = (ring: number, i: number) => 1 + ring * LON + (i % LON);
  for (let ring = 0; ring < lats.length; ring++) {
    for (let i = 0; i < LON; i++) {
      edges.push([idx(ring, i), idx(ring, i + 1)]);
      if (ring < lats.length - 1) edges.push([idx(ring, i), idx(ring + 1, i)]);
    }
  }
  for (let i = 0; i < LON; i++) {
    edges.push([0, idx(0, i)]);
    edges.push([bottom, idx(lats.length - 1, i)]);
  }
  return { verts, edges };
}

/**
 * Zeichnet ein Modell an Position (x,y,z), gedreht um Y (yaw), X (pitch) und Z (roll).
 */
export function drawModel(
  g: CanvasRenderingContext2D,
  cam: Camera,
  m: Model,
  x: number,
  y: number,
  z: number,
  rot: { yaw?: number; pitch?: number; roll?: number },
  color: string,
): void {
  const cy = Math.cos(rot.yaw ?? 0);
  const sy = Math.sin(rot.yaw ?? 0);
  const cp = Math.cos(rot.pitch ?? 0);
  const sp = Math.sin(rot.pitch ?? 0);
  const cr = Math.cos(rot.roll ?? 0);
  const sr = Math.sin(rot.roll ?? 0);

  const pts = m.verts.map(([vx, vy, vz]) => {
    // Yaw
    const x1 = vx * cy + vz * sy;
    const z1 = -vx * sy + vz * cy;
    // Pitch
    const y2 = vy * cp - z1 * sp;
    const z2 = vy * sp + z1 * cp;
    // Roll
    const x3 = x1 * cr - y2 * sr;
    const y3 = x1 * sr + y2 * cr;
    return project(cam, x + x3, y + y3, z + z2);
  });

  for (const [a, b] of m.edges) {
    const pa = pts[a];
    const pb = pts[b];
    if (pa && pb) line(g, pa[0], pa[1], pb[0], pb[1], color);
  }
}
