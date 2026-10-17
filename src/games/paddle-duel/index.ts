import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import { CabinetShell, type GameDefinition } from '../../engine/shell';
import type { CabinetInfo } from '../../engine/types';
import { OPPONENTS, PaddleDuelRound } from './round';

const tri = (t: number) => 1 - Math.abs((t % 2) - 1);

export const paddleDuel: CabinetInfo = {
  id: 'paddle-duel',
  title: 'PADDLE DUEL',
  tagline: 'BEAT THE COMPUTER AT TABLE TENNIS!',
  color: C.WHITE,
  accent: C.CYAN,
  controls: [{ type: 'stick', keys: '↑↓', label: 'MOVE' }],
  attract(g, x, y, w, h, t) {
    const bx = x + 5 + tri(t * 0.8) * (w - 10);
    const by = y + 2 + tri(t * 1.1) * (h - 6);
    g.fillStyle = C.WHITE;
    for (let yy = y; yy < y + h; yy += 4) g.fillRect(x + w / 2, yy, 1, 2);
    g.fillRect(Math.round(bx), Math.round(by), 2, 2);
    g.fillStyle = C.CYAN;
    g.fillRect(x + 2, Math.round(Math.max(y, Math.min(y + h - 10, by - 5))), 2, 10);
    g.fillStyle = C.MAGENTA;
    g.fillRect(x + w - 4, Math.round(Math.max(y, Math.min(y + h - 10, by - 4))), 2, 10);
  },
  create: () => new CabinetShell(paddleDuelGame),
};

export const paddleDuelGame: GameDefinition = {
  info: paddleDuel,
  howTo: ['HIT THE BALL BACK.', 'FIRST TO 7 WINS', 'THE MATCH.', 'EACH WIN BRINGS A', 'TOUGHER OPPONENT.'],
  createRound: (env) => new PaddleDuelRound(env),
  drawPoints(g, y) {
    drawText(g, 'YOUR OPPONENTS', 192, y, { color: C.WHITE, align: 'center' });
    OPPONENTS.forEach((o, k) => {
      drawText(g, `${k + 1}. ${o.name}`, 192, y + 18 + k * 18, { scale: 2, color: [C.GREEN, C.YELLOW, C.ORANGE, C.RED][k], align: 'center' });
    });
    drawText(g, 'POINT = 100 X MATCH', 192, y + 96, { color: C.CYAN, align: 'center' });
    drawText(g, 'MATCH WIN = 1000 X MATCH', 192, y + 108, { color: C.CYAN, align: 'center' });
  },
};
