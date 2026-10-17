import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import { CabinetShell, type GameDefinition } from '../../engine/shell';
import type { CabinetInfo } from '../../engine/types';
import { BrickBlasterRound, POWER_LIST, ROW_COLORS } from './round';

/** Dreieckswelle 0..1..0 für die Mini-Demo. */
const tri = (t: number) => 1 - Math.abs((t % 2) - 1);

export const brickBlaster: CabinetInfo = {
  id: 'brick-blaster',
  title: 'BRICK BLASTER',
  tagline: 'SMASH EVERY BRICK ON THE WALL!',
  color: C.ORANGE,
  accent: C.CYAN,
  controls: [
    { type: 'stick', keys: '←→', label: 'MOVE' },
    { type: 'button', keys: 'SPACE', label: 'LAUNCH' },
  ],
  attract(g, x, y, w, h, t) {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r * 8 + c + Math.floor(t * 2)) % 11 === 0) continue;
        g.fillStyle = ROW_COLORS[r];
        g.fillRect(x + 2 + c * 10, y + 1 + r * 4, 9, 3);
      }
    }
    const bx = x + 2 + tri(t * 0.9) * (w - 4);
    const by = y + 18 + tri(t * 1.3) * (h - 22);
    g.fillStyle = C.WHITE;
    g.fillRect(Math.round(bx), Math.round(by), 2, 2);
    g.fillStyle = C.ORANGE;
    g.fillRect(Math.round(Math.min(x + w - 18, Math.max(x, bx - 8))), y + h - 2, 16, 2);
  },
  create: () => new CabinetShell(brickBlasterGame),
};

export const brickBlasterGame: GameDefinition = {
  info: brickBlaster,
  howTo: ['BOUNCE THE BALL WITH', 'YOUR PADDLE AND SMASH', 'ALL THE BRICKS.', "DON'T LET IT FALL!"],
  createRound: (env) => new BrickBlasterRound(env),
  drawPoints(g, y) {
    ROW_COLORS.slice(0, 4).forEach((color, k) => {
      g.fillStyle = color;
      g.fillRect(70, y + k * 14, 28, 8);
      drawText(g, `${(8 - k) * 10} PTS`, 106, y + k * 14 + 1, { color });
    });
    g.fillStyle = '#c8c4dc';
    g.fillRect(70, y + 60, 28, 8);
    drawText(g, '2 HITS  100', 106, y + 61, { color: '#c8c4dc' });
    g.fillStyle = '#6a6488';
    g.fillRect(70, y + 74, 28, 8);
    drawText(g, 'STEEL', 106, y + 75, { color: '#8a86a8' });

    const names: Record<string, string> = { wide: 'WIDE PADDLE', multi: 'MULTI BALL', slow: 'SLOW BALL', life: 'EXTRA LIFE' };
    POWER_LIST.forEach(([kind, info], k) => {
      const ry = y + k * 20;
      g.fillStyle = info.color;
      g.fillRect(200, ry, 14, 9);
      drawText(g, info.letter, 207, ry + 1, { color: C.BLACK, align: 'center' });
      drawText(g, names[kind], 222, ry + 1, { color: info.color });
    });
    drawText(g, 'CATCH THE CAPSULES!', 200, y + 84, { color: C.WHITE });
  },
};
