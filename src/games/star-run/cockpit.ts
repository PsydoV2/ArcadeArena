import { fillCircle, line, strokeRect } from '../../engine/draw';
import { SCREEN_H as H, SCREEN_W as W } from '../../engine/types';

const FRAME = '#160f2a';
const EDGE = '#2d8fa8';

export const LEFT_BOX = { x: 40, y: 222, w: 116, h: 58 };
export const RIGHT_BOX = { x: 228, y: 222, w: 116, h: 58 };
export const RADAR = { x: 192, y: 252, r: 26 };

/** Cockpitrahmen und Armaturenbrett, einmalig vorgezeichnet. */
export function renderCockpit(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;

  const poly = (pts: [number, number][]) => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
    g.closePath();
    g.fill();
  };
  g.fillStyle = FRAME;
  poly([[0, 0], [W, 0], [W, 10], [330, 18], [54, 18], [0, 10]]);
  poly([[0, 10], [14, 12], [34, 214], [0, 222]]);
  poly([[W, 10], [W - 14, 12], [W - 34, 214], [W, 222]]);
  poly([[0, 222], [34, 214], [80, 210], [304, 210], [350, 214], [W, 222], [W, H], [0, H]]);

  // Kantenglättung entfernen, damit der Rahmen pixelscharf bleibt
  const img = g.getImageData(0, 0, W, H);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 127 ? 255 : 0;
  g.putImageData(img, 0, 0);

  const edges: [number, number, number, number][] = [
    [0, 10, 54, 18], [54, 18, 330, 18], [330, 18, W, 10],
    [14, 12, 34, 214], [W - 14, 12, W - 34, 214],
    [34, 214, 80, 210], [80, 210, 304, 210], [304, 210, W - 34, 214],
  ];
  for (const [x0, y0, x1, y1] of edges) line(g, x0, y0, x1, y1, EDGE);

  // Nieten an den Streben
  g.fillStyle = '#3a2d5c';
  for (let k = 0; k < 8; k++) {
    const y = 30 + k * 24;
    g.fillRect(6 + Math.round(k * 2.4), y, 2, 2);
    g.fillRect(W - 8 - Math.round(k * 2.4), y, 2, 2);
  }

  for (const b of [LEFT_BOX, RIGHT_BOX]) {
    g.fillStyle = '#0a0614';
    g.fillRect(b.x, b.y, b.w, b.h);
    strokeRect(g, b.x, b.y, b.w, b.h, '#3a2a5a');
  }

  fillCircle(g, RADAR.x, RADAR.y, RADAR.r + 2, '#3a2a5a');
  fillCircle(g, RADAR.x, RADAR.y, RADAR.r, '#04120a');
  g.fillStyle = '#0f3a22';
  g.fillRect(RADAR.x - RADAR.r, RADAR.y, RADAR.r * 2, 1);
  g.fillRect(RADAR.x, RADAR.y - RADAR.r, 1, RADAR.r * 2);
  return c;
}
