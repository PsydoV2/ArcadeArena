import { makeSprite } from '../../engine/draw';
import * as C from '../../engine/palette';

/** Geister ("Imps") mit kleinen Hörnern, 2 Animationsphasen. */
const IMP_TOP = [
  '.#..........#.',
  '.##..####..##.',
  '..##########..',
  '.############.',
  '.############.',
  '##############',
  '##############',
  '##############',
  '##############',
  '##############',
  '##############',
  '##############',
];
const IMP_FEET = [
  ['##.###..###.##', '#...##..##...#'],
  ['###.##..##.###', '.#...#..#...#.'],
];

export const IMP_COLORS = [C.RED, '#ff8ad8', C.CYAN, C.ORANGE];
export const IMP_NAMES = ['BLAZE', 'TRICKY', 'DIZZY', 'SHY'];
export const IMP_ROLES = ['CHASER', 'AMBUSHER', 'WANDERER', 'SCAREDY'];
export const SCARED_COLOR = '#2440ff';
export const SCARED_FLASH = '#f4f1ff';

const imp = (color: string) => IMP_FEET.map((feet) => makeSprite([...IMP_TOP, ...feet], color));

export const IMPS = IMP_COLORS.map(imp);
export const IMP_SCARED = imp(SCARED_COLOR);
export const IMP_SCARED_FLASH = imp(SCARED_FLASH);

const FRUIT_PALETTE = {
  r: '#ff3d5a',
  g: '#5dff6a',
  y: '#ffe23d',
  w: '#ffffff',
  p: '#b04dff',
  b: '#8a5a2a',
  c: '#3df5ff',
};

/** Bonusfrüchte: Kirsche, Zitrone, Apfel, Trauben, Kristall. */
export const FRUITS = [
  [
    '......ggg.',
    '.....g..g.',
    '....g...g.',
    '...g....g.',
    '.rrr...g..',
    'rwrrr.rrr.',
    'rrrrrrwrrr',
    'rrrrrrrrrr',
    '.rrr.rrrrr',
    '......rrr.',
  ],
  [
    '..........',
    '....gg....',
    '..yyyyyy..',
    '.ywyyyyyy.',
    'yyyyyyyyyy',
    'ywyyyyyyyy',
    'yyyyyyyyyy',
    '.yyyyyyyy.',
    '..yyyyyy..',
    '..........',
  ],
  [
    '.....b....',
    '....b.gg..',
    '..rrbrrr..',
    '.rwrrrrrr.',
    'rwrrrrrrrr',
    'rrrrrrrrrr',
    'rrrrrrrrrr',
    '.rrrrrrrr.',
    '..rrrrrr..',
    '...rr.rr..',
  ],
  [
    '....gg....',
    '.....g....',
    '..pp.pp...',
    '.pwppwpp..',
    '.pppppppp.',
    '..ppwppp..',
    '..pppppp..',
    '...pwpp...',
    '...pppp...',
    '....pp....',
  ],
  [
    '..........',
    '...cccc...',
    '..cwcccc..',
    '.cwcccccc.',
    'cccccccccc',
    '.cccccccc.',
    '..cccccc..',
    '...cccc...',
    '....cc....',
    '..........',
  ],
].map((rows) => makeSprite(rows, FRUIT_PALETTE));

export const FRUIT_POINTS = [100, 300, 500, 700, 1000, 2000, 3000, 5000];

export function fruitIndex(level: number): number {
  return Math.min(level - 1, FRUITS.length - 1);
}

export function fruitPoints(level: number): number {
  return FRUIT_POINTS[Math.min(level - 1, FRUIT_POINTS.length - 1)];
}

/** Der Muncher: runder Kerl mit Auge, Mund zeigt in Laufrichtung. */
export function drawMuncher(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  mouth: number,
  color = C.YELLOW,
): void {
  const R = 6.5;
  const facing = Math.atan2(dy, dx);
  g.fillStyle = color;
  for (let y = -6; y <= 6; y++) {
    for (let x = -6; x <= 6; x++) {
      if (x * x + y * y > R * R) continue;
      if (mouth > 0 && (x !== 0 || y !== 0)) {
        let a = Math.atan2(y, x) - facing;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        if (Math.abs(a) < mouth) continue;
      }
      g.fillRect(cx + x, cy + y, 1, 1);
    }
  }
  if (mouth < Math.PI * 0.6) {
    // Auge oberhalb (bzw. links) der Laufrichtung
    const sx = dx !== 0 ? 0 : -1;
    const sy = dx !== 0 ? -1 : 0;
    g.fillStyle = '#2a1a00';
    g.fillRect(cx + dx + sx * 3, cy + dy + sy * 3, 1, 1);
  }
}
