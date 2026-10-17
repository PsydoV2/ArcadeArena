import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import { CabinetShell, type GameDefinition } from '../../engine/shell';
import type { CabinetInfo } from '../../engine/types';
import { RoadHopperRound } from './round';

function miniHopper(g: CanvasRenderingContext2D, x: number, y: number, k = 1) {
  g.fillStyle = '#7dff8a';
  g.fillRect(x, y, 6 * k, 6 * k);
  g.fillStyle = C.WHITE;
  g.fillRect(x + k, y, k * 2, k);
  g.fillRect(x + 3 * k, y, k * 2, k);
}

export const roadHopper: CabinetInfo = {
  id: 'road-hopper',
  title: 'ROAD HOPPER',
  tagline: 'CROSS THE ROAD, RIDE THE RIVER!',
  color: '#7dff8a',
  accent: C.YELLOW,
  controls: [{ type: 'stick', keys: '←↑→↓', label: 'HOP' }],
  attract(g, x, y, w, h, t) {
    g.fillStyle = '#0a1a52';
    g.fillRect(x, y, w, 14);
    g.fillStyle = '#120e1c';
    g.fillRect(x, y + 18, w, 14);
    g.fillStyle = '#8a5a2a';
    g.fillRect(Math.round(x + ((t * 14) % (w + 20)) - 20), y + 2, 22, 4);
    g.fillRect(Math.round(x + ((t * 10 + 40) % (w + 20)) - 20), y + 8, 18, 4);
    const cars = [C.MAGENTA, C.YELLOW];
    cars.forEach((color, i) => {
      g.fillStyle = color;
      g.fillRect(Math.round(x + w - ((t * (18 + i * 10) + i * 30) % (w + 10))), y + 20 + i * 6, 7, 4);
    });
    const step = Math.floor(t * 1.5) % 7;
    miniHopper(g, x + w / 2 - 3, y + h - 6 - step * 5);
  },
  create: () => new CabinetShell(roadHopperGame),
};

export const roadHopperGame: GameDefinition = {
  info: roadHopper,
  howTo: ['HOP ACROSS THE ROAD,', 'THEN RIDE LOGS AND', 'TURTLES OVER THE RIVER.', 'FILL ALL FIVE HOMES!'],
  createRound: (env) => new RoadHopperRound(env),
  drawPoints(g, y) {
    const rows: [string, string][] = [
      ['STEP FORWARD', '10'],
      ['REACH A HOME', '50'],
      ['TIME LEFT', '10 / SEC'],
      ['ALL 5 HOMES', '1000'],
    ];
    rows.forEach(([what, pts], k) => {
      const ry = y + k * 22;
      drawText(g, what, 80, ry, { scale: 2, color: C.WHITE });
      drawText(g, pts, 312, ry, { scale: 2, color: C.YELLOW, align: 'right' });
    });
    drawText(g, 'TURTLES TURN RED BEFORE THEY DIVE', 192, y + 96, { color: C.RED, align: 'center' });
  },
};
