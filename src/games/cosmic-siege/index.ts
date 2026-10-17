import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import { CabinetShell, type GameDefinition } from '../../engine/shell';
import type { CabinetInfo } from '../../engine/types';
import { CosmicSiegeRound } from './round';
import { ALIEN_COLORS, ALIEN_W, SPR } from './sprites';

export const cosmicSiege: CabinetInfo = {
  id: 'cosmic-siege',
  title: 'COSMIC SIEGE',
  color: C.MAGENTA,
  accent: C.GREEN,
  controls: [
    { type: 'stick', keys: '←→', label: 'MOVE' },
    { type: 'button', keys: 'SPACE', label: 'FIRE' },
  ],
  attract(g, x, y, w, h, t) {
    const step = Math.floor(t * 3);
    const off = Math.abs((step % 16) - 8) - 4;
    const frame = step % 2;
    [0, 2].forEach((type, row) => {
      for (let k = 0; k < 4; k++) {
        const cx = x + 13 + k * 18 + off;
        g.drawImage(SPR.aliens[type][frame], cx - (ALIEN_W[type] >> 1), y + 2 + row * 12);
      }
    });
    const px = Math.round(x + w / 2 - 6 + Math.sin(t * 1.3) * 22);
    g.drawImage(SPR.player, px, y + h - 8);
    const shotT = t % 1.5;
    if (shotT < 0.6) {
      g.fillStyle = C.WHITE;
      g.fillRect(px + 6, Math.round(y + h - 12 - (shotT / 0.6) * 22), 1, 3);
    }
  },
  create: () => new CabinetShell(definition),
};

const definition: GameDefinition = {
  info: cosmicSiege,
  howTo: ['STOP THE INVADERS', 'BEFORE THEY LAND!', 'HIDE BEHIND THE SHIELDS.', 'EXTRA LIFE AT 1500 POINTS.'],
  createRound: (env) => new CosmicSiegeRound(env),
  drawPoints(g, y) {
    const rows = [
      { sprite: SPR.ufo, text: '= ? MYSTERY', color: C.RED },
      { sprite: SPR.aliens[0][0], text: '= 30 POINTS', color: ALIEN_COLORS[0] },
      { sprite: SPR.aliens[1][0], text: '= 20 POINTS', color: ALIEN_COLORS[1] },
      { sprite: SPR.aliens[2][0], text: '= 10 POINTS', color: ALIEN_COLORS[2] },
    ];
    rows.forEach((r, k) => {
      const ry = y + k * 30;
      const s = r.sprite;
      g.drawImage(s, 118 - s.width, ry, s.width * 2, s.height * 2);
      drawText(g, r.text, 140, ry + 1, { scale: 2, color: r.color });
    });
  },
};
