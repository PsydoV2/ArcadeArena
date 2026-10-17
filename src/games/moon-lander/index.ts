import { line } from '../../engine/draw';
import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import { CabinetShell, type GameDefinition } from '../../engine/shell';
import type { CabinetInfo } from '../../engine/types';
import { LANDER_LINES, MoonLanderRound } from './round';

function lander(g: CanvasRenderingContext2D, x: number, y: number, k: number, color: string) {
  for (const [x0, y0, x1, y1] of LANDER_LINES) line(g, x + x0 * k, y + y0 * k, x + x1 * k, y + y1 * k, color);
}

export const moonLander: CabinetInfo = {
  id: 'moon-lander',
  title: 'MOON LANDER',
  tagline: 'TOUCH DOWN GENTLY ON THE MOON!',
  color: '#b8acd8',
  accent: C.GREEN,
  controls: [
    { type: 'stick', keys: '←→', label: 'TURN' },
    { type: 'button', keys: 'SPACE', label: 'THRUST' },
  ],
  attract(g, x, y, w, h, t) {
    const ground = y + h - 4;
    line(g, x, ground - 6, x + 20, ground, '#b8acd8');
    line(g, x + 20, ground, x + 50, ground, C.GREEN);
    line(g, x + 50, ground, x + w, ground - 10, '#b8acd8');
    const p = (t % 5) / 5;
    const ly = y + 6 + p * (h - 14);
    lander(g, x + 35, ly, 0.8, C.WHITE);
    if (p > 0.5 && t % 0.1 < 0.06) line(g, x + 35, ly + 2, x + 35, ly + 7, C.YELLOW);
  },
  create: () => new CabinetShell(moonLanderGame),
};

export const moonLanderGame: GameDefinition = {
  info: moonLander,
  howTo: ['TURN AND FIRE THE ENGINE', 'TO LAND SOFTLY ON A PAD.', 'GREEN SPEEDS ARE SAFE.', 'WATCH YOUR FUEL!'],
  createRound: (env) => new MoonLanderRound(env),
  drawPoints(g, y) {
    lander(g, 100, y + 30, 2.5, C.WHITE);
    const rows: [string, string][] = [
      ['WIDE PAD', 'X2'],
      ['MEDIUM PAD', 'X3'],
      ['NARROW PAD', 'X5'],
    ];
    rows.forEach(([what, mult], k) => {
      drawText(g, what, 150, y + k * 20, { scale: 2, color: C.WHITE });
      drawText(g, mult, 330, y + k * 20, { scale: 2, color: C.GREEN, align: 'right' });
    });
    drawText(g, 'LANDING 50 - PERFECT 100', 192, y + 70, { color: C.YELLOW, align: 'center' });
    drawText(g, 'PLUS A BONUS FOR FUEL LEFT', 192, y + 84, { color: C.YELLOW, align: 'center' });
  },
};
