import { fillCircle, line } from '../../engine/draw';
import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import { CabinetShell, type GameDefinition } from '../../engine/shell';
import type { CabinetInfo } from '../../engine/types';
import { CityDefenderRound } from './round';

export const cityDefender: CabinetInfo = {
  id: 'city-defender',
  title: 'CITY DEFENDER',
  tagline: 'STOP THE MISSILES, SAVE THE CITIES!',
  color: C.RED,
  accent: C.CYAN,
  controls: [
    { type: 'stick', keys: '←↑→↓', label: 'AIM' },
    { type: 'button', keys: 'SPACE', label: 'FIRE' },
  ],
  attract(g, x, y, w, h, t) {
    g.fillStyle = '#5a2a8a';
    g.fillRect(x, y + h - 3, w, 3);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = C.CYAN;
      g.fillRect(x + 10 + i * 18, y + h - 7, 6, 4);
    }
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.25 + i * 0.33) % 1;
      const sx = x + 10 + i * 28;
      const tx = x + 14 + ((i * 37) % 60);
      line(g, sx, y, sx + (tx - sx) * p, y + (h - 6) * p, '#a02040');
    }
    const bp = (t * 0.7) % 1;
    if (bp < 0.5) fillCircle(g, Math.round(x + w / 2 + Math.sin(t) * 20), y + 14, Math.round(bp * 18), [C.WHITE, C.YELLOW, C.MAGENTA][Math.floor(t * 10) % 3]);
  },
  create: () => new CabinetShell(cityDefenderGame),
};

export const cityDefenderGame: GameDefinition = {
  info: cityDefender,
  howTo: ['MOVE THE CROSSHAIR AND', 'FIRE: MISSILES EXPLODE', 'AT THE CROSSHAIR.', 'CATCH ENEMY MISSILES', 'IN THE BLAST!'],
  createRound: (env) => new CityDefenderRound(env),
  drawPoints(g, y) {
    const rows: [string, string][] = [
      ['ENEMY MISSILE', '25'],
      ['MISSILE LEFT', '5'],
      ['CITY SAVED', '100'],
    ];
    rows.forEach(([what, pts], k) => {
      const ry = y + k * 22;
      drawText(g, what, 80, ry, { scale: 2, color: C.WHITE });
      drawText(g, pts, 312, ry, { scale: 2, color: C.YELLOW, align: 'right' });
    });
    drawText(g, 'POINTS GROW EVERY 2 WAVES', 192, y + 76, { color: C.CYAN, align: 'center' });
    drawText(g, 'BONUS CITY EVERY 10000', 192, y + 90, { color: C.GREEN, align: 'center' });
  },
};
