import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import { CabinetShell, type GameDefinition } from '../../engine/shell';
import type { CabinetInfo } from '../../engine/types';
import { NeonSerpentRound } from './round';

/** Position auf einem rechteckigen Rundkurs (für die Mini-Demo). */
function loopPos(p: number, w: number, h: number): [number, number] {
  const per = 2 * (w + h);
  p = ((p % per) + per) % per;
  if (p < w) return [p, 0];
  if (p < w + h) return [w, p - w];
  if (p < 2 * w + h) return [w - (p - w - h), h];
  return [0, h - (p - 2 * w - h)];
}

export const neonSerpent: CabinetInfo = {
  id: 'neon-serpent',
  title: 'NEON SERPENT',
  tagline: 'EAT, GROW - AND NEVER BITE YOURSELF!',
  color: C.GREEN,
  accent: C.MAGENTA,
  controls: [{ type: 'stick', keys: '←↑→↓', label: 'STEER' }],
  attract(g, x, y, w, h, t) {
    const cw = Math.floor((w - 12) / 4);
    const ch = Math.floor((h - 8) / 4);
    const head = Math.floor(t * 8);
    for (let i = 0; i < 9; i++) {
      const [cx, cy] = loopPos(head - i, cw, ch);
      g.fillStyle = i === 0 ? '#9dffaa' : C.GREEN;
      g.fillRect(x + 6 + cx * 4, y + 4 + cy * 4, 3, 3);
    }
    const [ax, ay] = loopPos(Math.floor(t * 8 / 30) * 30 + 22, cw, ch);
    g.fillStyle = C.RED;
    g.fillRect(x + 6 + ax * 4, y + 4 + ay * 4, 3, 3);
  },
  create: () => new CabinetShell(neonSerpentGame),
};

export const neonSerpentGame: GameDefinition = {
  info: neonSerpent,
  howTo: ['EAT THE APPLES TO GROW.', "DON'T HIT THE WALLS", 'OR YOUR OWN TAIL!', 'GRAB STARS FOR BONUS.'],
  createRound: (env) => new NeonSerpentRound(env),
  drawPoints(g, y) {
    const rows: [string, string, string][] = [
      ['apple', '= 10 X LEVEL', C.RED],
      ['star', '= UP TO 2000', C.YELLOW],
      ['wall', '= OUCH!', '#8a78e0'],
    ];
    rows.forEach(([kind, text, color], k) => {
      const ry = y + 6 + k * 30;
      const sx = 118;
      if (kind === 'apple') {
        g.fillStyle = C.RED;
        g.fillRect(sx + 2, ry + 4, 12, 10);
        g.fillRect(sx + 4, ry + 2, 8, 14);
        g.fillStyle = C.GREEN;
        g.fillRect(sx + 8, ry, 4, 4);
      } else if (kind === 'star') {
        g.fillStyle = C.YELLOW;
        g.fillRect(sx + 6, ry, 4, 16);
        g.fillRect(sx, ry + 6, 16, 4);
        g.fillRect(sx + 4, ry + 4, 8, 8);
      } else {
        g.fillStyle = '#3a2a78';
        g.fillRect(sx, ry, 16, 16);
        g.fillStyle = '#5a48b0';
        g.fillRect(sx, ry, 16, 2);
      }
      drawText(g, text, 146, ry + 2, { scale: 2, color });
    });
    drawText(g, '10 APPLES CLEAR A LEVEL', 192, y + 100, { color: C.WHITE, align: 'center' });
  },
};
