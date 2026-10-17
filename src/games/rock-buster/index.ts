import { line } from '../../engine/draw';
import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import { CabinetShell, type GameDefinition } from '../../engine/shell';
import type { CabinetInfo } from '../../engine/types';
import { RockBusterRound, SHIP_SHAPE } from './round';

/** Umriss für Halle und Punktetabelle (ohne Wrap). */
function outline(g: CanvasRenderingContext2D, pts: [number, number][], x: number, y: number, a: number, k: number, color: string) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const p = pts.map(([px, py]) => [x + (px * ca - py * sa) * k, y + (px * sa + py * ca) * k]);
  for (let i = 0; i < p.length; i++) line(g, p[i][0], p[i][1], p[(i + 1) % p.length][0], p[(i + 1) % p.length][1], color);
}

const ROCK: [number, number][] = [[1, 0], [0.7, 0.6], [0.1, 0.9], [-0.6, 0.75], [-1, 0.1], [-0.7, -0.6], [-0.1, -0.95], [0.6, -0.7]];
const SAUCER: [number, number][] = [[-10, 0], [-4, -4], [4, -4], [10, 0], [4, 4], [-4, 4]];

export const rockBuster: CabinetInfo = {
  id: 'rock-buster',
  title: 'ROCK BUSTER',
  tagline: 'BLAST THE ROCKS BEFORE THEY GET YOU!',
  color: '#ffb86a',
  accent: C.CYAN,
  controls: [
    { type: 'stick', keys: '←↑→', label: 'FLY' },
    { type: 'button', keys: 'SPACE', label: 'FIRE' },
    { type: 'button', keys: 'SHIFT', label: 'WARP' },
  ],
  attract(g, x, y, w, h, t) {
    const rocks = [[0.2, 0.3, 9], [0.75, 0.25, 6], [0.6, 0.8, 4], [0.15, 0.85, 5]];
    rocks.forEach(([fx, fy, r], i) => {
      const rx = x + ((fx * w + t * (6 + i * 3)) % w);
      const ry = y + ((fy * h + t * (4 - i)) % h + h) % h;
      outline(g, ROCK, rx, ry, t * (0.5 + i * 0.2), r, C.ORANGE);
    });
    const a = t * 1.2;
    outline(g, SHIP_SHAPE, x + w / 2, y + h / 2, a, 0.8, C.CYAN);
    const shot = (t * 3) % 1;
    g.fillStyle = C.WHITE;
    g.fillRect(Math.round(x + w / 2 + Math.cos(a) * (8 + shot * 30)), Math.round(y + h / 2 + Math.sin(a) * (8 + shot * 30)), 1, 1);
  },
  create: () => new CabinetShell(rockBusterGame),
};

export const rockBusterGame: GameDefinition = {
  info: rockBuster,
  howTo: ['TURN, THRUST AND SHOOT.', 'BIG ROCKS BREAK INTO', 'SMALLER ONES.', 'SHIFT WARPS YOU AWAY.'],
  createRound: (env) => new RockBusterRound(env),
  drawPoints(g, y) {
    const rows: { draw: (cx: number, cy: number) => void; text: string; color: string }[] = [
      { draw: (cx, cy) => outline(g, ROCK, cx, cy, 0.3, 11, C.ORANGE), text: '=   20', color: C.ORANGE },
      { draw: (cx, cy) => outline(g, ROCK, cx, cy, 1, 7, '#ffb86a'), text: '=   50', color: '#ffb86a' },
      { draw: (cx, cy) => outline(g, ROCK, cx, cy, 2, 4, '#ffd8a8'), text: '=  100', color: '#ffd8a8' },
      { draw: (cx, cy) => outline(g, SAUCER, cx, cy, 0, 1, C.RED), text: '=  200', color: C.RED },
      { draw: (cx, cy) => outline(g, SAUCER, cx, cy, 0, 0.6, C.RED), text: '= 1000', color: C.RED },
    ];
    rows.forEach((r, k) => {
      const ry = y + 2 + k * 24;
      r.draw(140, ry + 7);
      drawText(g, r.text, 166, ry, { scale: 2, color: r.color });
    });
  },
};
