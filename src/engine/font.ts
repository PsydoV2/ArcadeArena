/** 5×7-Bitmap-Font im Retro-Stil. Jede Zeile eines Zeichens ist durch '|' getrennt. */
const GLYPHS: Record<string, string> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
  '3': '#####|...#.|..#..|...#.|....#|#...#|.###.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '..##.|.#...|#....|####.|#...#|#...#|.###.',
  '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
  '.': '.....|.....|.....|.....|.....|.##..|.##..',
  ',': '.....|.....|.....|.....|.##..|..#..|.#...',
  ':': '.....|.##..|.##..|.....|.##..|.##..|.....',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  '-': '.....|.....|.....|#####|.....|.....|.....',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '=': '.....|.....|#####|.....|#####|.....|.....',
  '/': '.....|....#|...#.|..#..|.#...|#....|.....',
  "'": '..#..|..#..|.#...|.....|.....|.....|.....',
  '"': '.#.#.|.#.#.|.....|.....|.....|.....|.....',
  '(': '...#.|..#..|.#...|.#...|.#...|..#..|...#.',
  ')': '.#...|..#..|...#.|...#.|...#.|..#..|.#...',
  '<': '...#.|..#..|.#...|#....|.#...|..#..|...#.',
  '>': '.#...|..#..|...#.|....#|...#.|..#..|.#...',
  '*': '.....|#.#.#|.###.|#####|.###.|#.#.#|.....',
  '%': '##...|##..#|...#.|..#..|.#...|#..##|...##',
  '_': '.....|.....|.....|.....|.....|.....|#####',
  '#': '.#.#.|#####|.#.#.|.#.#.|.#.#.|#####|.#.#.',
  '←': '.....|..#..|.#...|####.|.#...|..#..|.....',
  '→': '.....|..#..|...#.|.####|...#.|..#..|.....',
  '↑': '..#..|.###.|#.#.#|..#..|..#..|..#..|.....',
  '↓': '.....|..#..|..#..|..#..|#.#.#|.###.|..#..',
};

export const GLYPH_W = 5;
export const GLYPH_H = 7;
const ADVANCE = GLYPH_W + 1;

const CHARS = Object.keys(GLYPHS);
const INDEX = new Map(CHARS.map((c, i) => [c, i]));

let baseAtlas: HTMLCanvasElement | null = null;
const tinted = new Map<string, HTMLCanvasElement>();

function atlasFor(color: string): HTMLCanvasElement {
  let atlas = tinted.get(color);
  if (atlas) return atlas;

  if (!baseAtlas) {
    baseAtlas = document.createElement('canvas');
    baseAtlas.width = CHARS.length * ADVANCE;
    baseAtlas.height = GLYPH_H;
    const g = baseAtlas.getContext('2d')!;
    g.fillStyle = '#fff';
    CHARS.forEach((ch, i) => {
      GLYPHS[ch].split('|').forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === '#') g.fillRect(i * ADVANCE + x, y, 1, 1);
      });
    });
  }

  atlas = document.createElement('canvas');
  atlas.width = baseAtlas.width;
  atlas.height = baseAtlas.height;
  const g = atlas.getContext('2d')!;
  g.drawImage(baseAtlas, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, atlas.width, atlas.height);
  tinted.set(color, atlas);
  return atlas;
}

export interface TextOpts {
  color?: string;
  /** Ganzzahliger Vergrößerungsfaktor. */
  scale?: number;
  align?: 'left' | 'center' | 'right';
  /** Weicher Neon-Schein in der Textfarbe. */
  glow?: boolean;
}

export function textWidth(text: string, scale = 1): number {
  return text.length ? (text.length * ADVANCE - 1) * scale : 0;
}

export function drawText(g: CanvasRenderingContext2D, text: string, x: number, y: number, o: TextOpts = {}): void {
  const s = o.scale ?? 1;
  const str = text.toUpperCase();
  const w = textWidth(str, s);
  let x0 = x;
  if (o.align === 'center') x0 = x - w / 2;
  else if (o.align === 'right') x0 = x - w;
  x0 = Math.round(x0);
  y = Math.round(y);

  const atlas = atlasFor(o.color ?? '#fff');
  const blit = (ox: number, oy: number) => {
    for (let i = 0; i < str.length; i++) {
      const idx = INDEX.get(str[i]);
      if (idx === undefined) continue;
      g.drawImage(atlas, idx * ADVANCE, 0, GLYPH_W, GLYPH_H, x0 + ox + i * ADVANCE * s, y + oy, GLYPH_W * s, GLYPH_H * s);
    }
  };

  if (o.glow) {
    const prev = g.globalAlpha;
    g.globalAlpha = prev * 0.3;
    blit(-1, 0);
    blit(1, 0);
    blit(0, -1);
    blit(0, 1);
    g.globalAlpha = prev;
  }
  blit(0, 0);
}
