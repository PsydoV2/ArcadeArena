import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import { CabinetShell, type GameDefinition } from '../../engine/shell';
import type { CabinetInfo } from '../../engine/types';
import { MazeMuncherRound } from './round';
import { drawMuncher, IMP_COLORS, IMP_NAMES, IMP_ROLES, IMP_SCARED, IMPS } from './sprites';

export const mazeMuncher: CabinetInfo = {
  id: 'maze-muncher',
  title: 'MAZE MUNCHER',
  tagline: 'EAT ALL DOTS - DODGE THE IMPS!',
  color: C.YELLOW,
  accent: C.BLUE,
  controls: [{ type: 'stick', keys: '←↑→↓', label: 'MOVE' }],
  attract(g, x, y, w, h, t) {
    const mid = y + h / 2;
    g.fillStyle = C.BLUE;
    g.fillRect(x, mid - 10, w, 1);
    g.fillRect(x, mid + 10, w, 1);
    // Muncher läuft nach rechts, ein Imp hinterher – bis die Power-Pille wirkt
    const cycle = t % 6;
    const pos = Math.round(cycle * 22) - 16;
    const powered = pos > 66;
    for (let dx = 8; dx < w; dx += 8) {
      if (x + dx > x + pos + 4) {
        g.fillStyle = '#ffd0b0';
        if (dx === 72) g.fillRect(x + dx - 2, mid - 2, 5, 5);
        else g.fillRect(x + dx, mid, 2, 2);
      }
    }
    if (pos < w + 8) {
      drawMuncher(g, x + pos, mid, 1, 0, Math.abs(Math.sin(t * 14)) * 0.8);
      const imp = powered ? IMP_SCARED : IMPS[0];
      g.drawImage(imp[Math.floor(t * 6) % 2], x + pos - 24, mid - 7);
    }
  },
  create: () => new CabinetShell(mazeMuncherGame),
};

export const mazeMuncherGame: GameDefinition = {
  info: mazeMuncher,
  howTo: ['EAT ALL THE DOTS.', 'AVOID THE IMPS!', 'POWER PILLS TURN THEM BLUE -', 'THEN YOU CAN EAT THEM.'],
  createRound: (env) => new MazeMuncherRound(env),
  drawPoints(g, y) {
    IMPS.forEach((frames, k) => {
      const ry = y + k * 20;
      g.drawImage(frames[0], 104, ry - 3);
      drawText(g, `${IMP_NAMES[k]} - ${IMP_ROLES[k]}`, 128, ry, { color: IMP_COLORS[k] });
    });
    const ry = y + 92;
    g.fillStyle = '#ffd0b0';
    g.fillRect(122, ry + 2, 2, 2);
    drawText(g, '10 PTS', 132, ry, { color: C.WHITE });
    g.fillRect(200, ry, 5, 5);
    drawText(g, '50 PTS', 212, ry, { color: C.WHITE });
    g.drawImage(IMP_SCARED[0], 104, ry + 17);
    drawText(g, '200 400 800 1600', 128, ry + 20, { color: C.CYAN });
  },
};
