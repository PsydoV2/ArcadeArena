/** Kachelgröße in Pixeln. */
export const T = 8;
export const MAZE_COLS = 28;
export const MAZE_ROWS = 31;

/**
 * Eigenes Labyrinth (symmetrisch, ohne Sackgassen).
 * '#' Wand, '.' Punkt, 'o' Power-Pille, ' ' leerer Gang, '-' Tür des Geisterhauses, 'G' Geisterhaus.
 */
const LAYOUT = [
  '############################',
  '#..........######..........#',
  '#.####.###.######.###.####.#',
  '#o####.###.######.###.####o#',
  '#.####.###.######.###.####.#',
  '#..........................#',
  '#.####.###.######.###.####.#',
  '#.####.###.######.###.####.#',
  '#......###........###......#',
  '######.###.######.###.######',
  '######.### ###### ###.######',
  '######.              .######',
  '######.### ##--## ###.######',
  '######.### #GGGG# ###.######',
  '      .    #GGGG#    .      ',
  '######.### #GGGG# ###.######',
  '######.### ###### ###.######',
  '######.              .######',
  '######.### ###### ###.######',
  '######.###.######.###.######',
  '#..........................#',
  '#.####.##############.####.#',
  '#.####.##############.####.#',
  '#..........######..........#',
  '#o########.######.########o#',
  '#.########.######.########.#',
  '#.####................####.#',
  '#.####.###.######.###.####.#',
  '#.####.###.######.###.####.#',
  '#..........................#',
  '############################',
];

export const TUNNEL_ROW = 14;

export class Maze {
  private tiles: string[][];
  dotsLeft = 0;

  constructor() {
    this.tiles = LAYOUT.map((row) => row.split(''));
    for (const row of this.tiles) for (const ch of row) if (ch === '.' || ch === 'o') this.dotsLeft++;
  }

  at(c: number, r: number): string {
    if (r < 0 || r >= MAZE_ROWS) return '#';
    return this.tiles[r][((c % MAZE_COLS) + MAZE_COLS) % MAZE_COLS];
  }

  /** Für Spieler und Geister außerhalb des Hauses gelten Tür und Haus als Wand. */
  blocked(c: number, r: number): boolean {
    const ch = this.at(c, r);
    return ch === '#' || ch === '-' || ch === 'G';
  }

  /** Frisst den Punkt auf der Kachel; liefert '.', 'o' oder ''. */
  eat(c: number, r: number): string {
    const ch = this.at(c, r);
    if (ch !== '.' && ch !== 'o') return '';
    this.tiles[r][((c % MAZE_COLS) + MAZE_COLS) % MAZE_COLS] = ' ';
    this.dotsLeft--;
    return ch;
  }

  drawDots(g: CanvasRenderingContext2D, ox: number, oy: number, pillsOn: boolean): void {
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        const ch = this.tiles[r][c];
        if (ch === '.') {
          g.fillStyle = '#ffd0b0';
          g.fillRect(ox + c * T + 3, oy + r * T + 3, 2, 2);
        } else if (ch === 'o' && pillsOn) {
          g.fillStyle = '#ffd0b0';
          g.fillRect(ox + c * T + 1, oy + r * T + 2, 6, 4);
          g.fillRect(ox + c * T + 2, oy + r * T + 1, 4, 6);
        }
      }
    }
  }
}

/** Zeichnet die Wände als Neon-Umrisse (einmalig vorberechnet). */
export function renderWalls(color: string, doorColor: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = MAZE_COLS * T;
  c.height = MAZE_ROWS * T;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  const wall = (cc: number, rr: number) => cc < 0 || cc >= MAZE_COLS || rr < 0 || rr >= MAZE_ROWS || LAYOUT[rr][cc] === '#';
  const I = 2;
  const E = T - 1 - I;

  for (let r = 0; r < MAZE_ROWS; r++) {
    for (let cc = 0; cc < MAZE_COLS; cc++) {
      if (!wall(cc, r)) continue;
      const x = cc * T;
      const y = r * T;
      const open = (dc: number, dr: number) => !wall(cc + dc, r + dr);
      const hline = (yy: number, x0: number, x1: number) => g.fillRect(x + x0, y + yy, x1 - x0 + 1, 1);
      const vline = (xx: number, y0: number, y1: number) => g.fillRect(x + xx, y + y0, 1, y1 - y0 + 1);

      if (open(0, -1)) hline(I, open(-1, 0) ? I : 0, open(1, 0) ? E : T - 1);
      if (open(0, 1)) hline(E, open(-1, 0) ? I : 0, open(1, 0) ? E : T - 1);
      if (open(-1, 0)) vline(I, open(0, -1) ? I : 0, open(0, 1) ? E : T - 1);
      if (open(1, 0)) vline(E, open(0, -1) ? I : 0, open(0, 1) ? E : T - 1);
      // Innenecken
      if (!open(0, -1) && !open(-1, 0) && open(-1, -1)) {
        vline(I, 0, I);
        hline(I, 0, I);
      }
      if (!open(0, -1) && !open(1, 0) && open(1, -1)) {
        vline(E, 0, I);
        hline(I, E, T - 1);
      }
      if (!open(0, 1) && !open(-1, 0) && open(-1, 1)) {
        vline(I, E, T - 1);
        hline(E, 0, I);
      }
      if (!open(0, 1) && !open(1, 0) && open(1, 1)) {
        vline(E, E, T - 1);
        hline(E, E, T - 1);
      }
    }
  }

  g.fillStyle = doorColor;
  for (let r = 0; r < MAZE_ROWS; r++) {
    for (let cc = 0; cc < MAZE_COLS; cc++) if (LAYOUT[r][cc] === '-') g.fillRect(cc * T, r * T + 3, T, 2);
  }
  return c;
}
