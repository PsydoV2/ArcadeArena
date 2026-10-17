import { fillCircle } from '../../engine/draw';
import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import { CabinetShell, type GameDefinition } from '../../engine/shell';
import type { CabinetInfo } from '../../engine/types';
import { CX, CY, drawModel, FIGHTER, FOCAL, makeRock } from './models';
import { StarRunRound } from './round';

const ORIGIN = { x: 0, y: 0 };
const BIG_ROCK = makeRock(9);
const SMALL_ROCK = makeRock(5);

/** Modell in Originalgröße an eine Bildschirmposition zeichnen. */
function drawAt(g: CanvasRenderingContext2D, model: typeof FIGHTER, sx: number, sy: number, rot: { yaw?: number; pitch?: number; roll?: number }, color: string) {
  drawModel(g, ORIGIN, model, sx - CX, sy - CY, FOCAL, rot, color);
}

export const starRun: CabinetInfo = {
  id: 'star-run',
  title: 'STAR RUN',
  tagline: 'FLY, SHOOT AND DODGE IN 3D SPACE!',
  color: C.CYAN,
  accent: C.ORANGE,
  controls: [
    { type: 'stick', keys: '←↑→↓', label: 'STEER' },
    { type: 'button', keys: 'SPACE', label: 'FIRE' },
    { type: 'button', keys: 'SHIFT', label: 'BOMB' },
  ],
  attract(g, x, y, w, h, t) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    // Sterne fliegen auf den Betrachter zu
    for (let k = 0; k < 28; k++) {
      const a = k * 2.399;
      const f = (t * (0.3 + ((k * 0.137) % 1) * 0.7) + k * 0.31) % 1;
      const r = f * f * 50;
      g.fillStyle = f > 0.6 ? C.WHITE : '#6a6a9a';
      g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.6), f > 0.7 ? 2 : 1, 1);
    }
    drawAt(g, FIGHTER, cx + Math.sin(t * 0.9) * 24, cy - 4 + Math.sin(t * 1.4) * 6, { roll: -Math.cos(t * 0.9) * 0.4 }, C.MAGENTA);
    g.fillStyle = C.CYAN;
    g.fillRect(cx - 6, cy, 4, 1);
    g.fillRect(cx + 3, cy, 4, 1);
    g.fillRect(cx, cy - 5, 1, 3);
    g.fillRect(cx, cy + 3, 1, 3);
  },
  create: () => new CabinetShell(starRunGame),
};

export const starRunGame: GameDefinition = {
  info: starRun,
  howTo: ['FLY THROUGH 3D SPACE.', 'SHOOT FIGHTERS AND ROCKS,', 'DODGE THE LASER FENCES.', 'KEEP YOUR SHIELD UP!'],
  createRound: (env) => new StarRunRound(env),
  drawPoints(g, y) {
    const t = performance.now() / 1000;
    const rows: { draw: (sx: number, sy: number) => void; text: string; color: string }[] = [
      { draw: (sx, sy) => drawAt(g, FIGHTER, sx, sy, { yaw: t, pitch: 0.4 }, C.MAGENTA), text: '= 150 POINTS', color: C.MAGENTA },
      { draw: (sx, sy) => drawAt(g, BIG_ROCK, sx, sy, { yaw: t, pitch: t * 0.7 }, C.ORANGE), text: '= 150 (4 HITS)', color: C.ORANGE },
      { draw: (sx, sy) => drawAt(g, SMALL_ROCK, sx, sy, { yaw: t, pitch: t * 0.7 }, '#d8a060'), text: '= 50 POINTS', color: '#d8a060' },
      {
        draw: (sx, sy) => {
          fillCircle(g, sx, sy, 4, C.GREEN);
          fillCircle(g, sx, sy, 2, C.WHITE);
        },
        text: '= 10 POINTS',
        color: C.GREEN,
      },
    ];
    rows.forEach((r, k) => {
      const ry = y + k * 26;
      r.draw(108, ry + 6);
      drawText(g, r.text, 136, ry, { scale: 2, color: r.color });
    });
  },
};
