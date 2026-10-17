import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import { CabinetShell, type GameDefinition } from '../../engine/shell';
import type { CabinetInfo } from '../../engine/types';
import { GardenGuardRound } from './round';

function segment(g: CanvasRenderingContext2D, x: number, y: number, color: string, k = 1) {
  g.fillStyle = color;
  g.fillRect(x + k, y + k, 6 * k, 6 * k);
  g.fillRect(x, y + 2 * k, 8 * k, 4 * k);
}

function mushroom(g: CanvasRenderingContext2D, x: number, y: number, k = 1) {
  g.fillStyle = C.MAGENTA;
  g.fillRect(x + k, y + k, 6 * k, 4 * k);
  g.fillRect(x, y + 2 * k, 8 * k, 2 * k);
  g.fillStyle = '#d8d0f0';
  g.fillRect(x + 3 * k, y + 5 * k, 2 * k, 3 * k);
}

export const gardenGuard: CabinetInfo = {
  id: 'garden-guard',
  title: 'GARDEN GUARD',
  tagline: 'STOP THE CATERPILLAR IN ITS TRACKS!',
  color: C.GREEN,
  accent: C.YELLOW,
  controls: [
    { type: 'stick', keys: '←↑→↓', label: 'MOVE' },
    { type: 'button', keys: 'SPACE', label: 'FIRE' },
  ],
  attract(g, x, y, w, h, t) {
    [[10, 6], [40, 4], [62, 14], [24, 20], [52, 26]].forEach(([mx, my]) => mushroom(g, x + mx, y + my, 0.75));
    const head = (t * 22) % (w + 40);
    for (let i = 0; i < 6; i++) segment(g, Math.round(x + head - i * 6 - 20), y + 10, C.GREEN, 0.75);
    g.fillStyle = C.YELLOW;
    g.fillRect(Math.round(x + w / 2 + Math.sin(t) * 20), y + h - 5, 6, 5);
  },
  create: () => new CabinetShell(gardenGuardGame),
};

export const gardenGuardGame: GameDefinition = {
  info: gardenGuard,
  howTo: ['SHOOT THE CATERPILLAR.', 'EACH HIT SPLITS IT AND', 'GROWS A MUSHROOM.', 'BEWARE OF THE SPIDER!'],
  createRound: (env) => new GardenGuardRound(env),
  drawPoints(g, y) {
    const rows: { draw: (sx: number, sy: number) => void; text: string; color: string }[] = [
      { draw: (sx, sy) => { segment(g, sx, sy, C.GREEN, 2); g.fillStyle = C.RED; g.fillRect(sx + 10, sy + 4, 4, 4); }, text: 'HEAD  = 100', color: C.GREEN },
      { draw: (sx, sy) => segment(g, sx, sy, C.GREEN, 2), text: 'BODY  =  10', color: C.GREEN },
      { draw: (sx, sy) => { g.fillStyle = C.WHITE; g.fillRect(sx + 4, sy + 4, 10, 8); g.fillRect(sx, sy + 6, 18, 2); }, text: 'SPIDER= 900', color: C.WHITE },
      { draw: (sx, sy) => { g.fillStyle = C.CYAN; g.fillRect(sx + 4, sy, 8, 12); g.fillRect(sx, sy + 12, 4, 4); g.fillRect(sx + 12, sy + 12, 4, 4); }, text: 'FLEA  = 200', color: C.CYAN },
      { draw: (sx, sy) => mushroom(g, sx, sy, 2), text: 'MUSHROOM= 1', color: C.MAGENTA },
    ];
    rows.forEach((r, k) => {
      const ry = y + k * 22;
      r.draw(110, ry);
      drawText(g, r.text, 140, ry + 2, { scale: 2, color: r.color });
    });
  },
};
