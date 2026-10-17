import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import { CabinetShell, type GameDefinition } from '../../engine/shell';
import type { CabinetInfo } from '../../engine/types';
import { GEM_COLORS, GEMS, GemCascadeRound } from './round';

export const gemCascade: CabinetInfo = {
  id: 'gem-cascade',
  title: 'GEM CASCADE',
  tagline: 'LINE UP THREE GEMS TO CLEAR THEM!',
  color: C.MAGENTA,
  accent: C.YELLOW,
  controls: [
    { type: 'stick', keys: '←→↓', label: 'MOVE' },
    { type: 'button', keys: 'SPACE', label: 'SWAP' },
    { type: 'button', keys: 'SHIFT', label: 'DROP' },
  ],
  attract(g, x, y, w, h, t) {
    const cols = 5;
    const bx = x + (w - cols * 8) / 2;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < 2; r++) {
        const gem = (c * 3 + r * 5) % GEMS.length;
        g.drawImage(GEMS[gem], 0, 0, 12, 12, bx + c * 8, y + h - 16 + r * 8, 7, 7);
      }
    }
    const fall = Math.floor((t * 3) % 4);
    const col = Math.floor(t / 1.33) % cols;
    for (let i = 0; i < 3; i++) {
      const gem = (Math.floor(t / 1.33) + i) % GEMS.length;
      g.drawImage(GEMS[gem], 0, 0, 12, 12, bx + col * 8, y + fall * 3 + i * 7 - 6, 7, 7);
    }
  },
  create: () => new CabinetShell(gemCascadeGame),
};

export const gemCascadeGame: GameDefinition = {
  info: gemCascade,
  howTo: ['LINE UP 3 OR MORE', 'MATCHING GEMS - ACROSS,', 'DOWN OR DIAGONAL.', 'SPACE SWAPS THE ORDER.'],
  createRound: (env) => new GemCascadeRound(env),
  drawPoints(g, y) {
    GEMS.forEach((s, k) => {
      g.drawImage(s, 0, 0, 12, 12, 108 + k * 30, y, 24, 24);
    });
    drawText(g, 'EACH COLOR HAS ITS OWN SHAPE', 192, y + 32, { color: C.WHITE, align: 'center' });
    drawText(g, 'GEM = 10 X LEVEL', 192, y + 52, { scale: 2, color: C.YELLOW, align: 'center' });
    drawText(g, 'CHAINS MULTIPLY!', 192, y + 74, { scale: 2, color: GEM_COLORS[4], align: 'center' });
    drawText(g, 'NEW LEVEL EVERY 30 GEMS', 192, y + 98, { color: C.CYAN, align: 'center' });
  },
};
