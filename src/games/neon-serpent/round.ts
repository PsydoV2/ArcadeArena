import type { Action } from '../../engine/input';
import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import type { Round, RoundEnv } from '../../engine/shell';
import type { Sound } from '../../engine/sound';
import { SCREEN_H as H, SCREEN_W as W } from '../../engine/types';

const CELL = 8;
const COLS = 46;
const ROWS = 30;
const X0 = (W - COLS * CELL) / 2;
const Y0 = 24;
const APPLES_PER_LEVEL = 10;
const START_LEN = 4;

/** Mauern je Level (zusätzlich zum Rand), als Rechtecke in Zellen: [x, y, w, h]. */
const LAYOUTS: [number, number, number, number][][] = [
  [],
  [
    [10, 9, 26, 1],
    [10, 20, 26, 1],
  ],
  [
    [22, 4, 2, 9],
    [22, 17, 2, 9],
    [6, 14, 12, 2],
    [28, 14, 12, 2],
  ],
  [
    [6, 5, 8, 6],
    [32, 5, 8, 6],
    [6, 19, 8, 6],
    [32, 19, 8, 6],
    [19, 13, 8, 4],
  ],
  [
    [8, 0, 1, 20],
    [16, 10, 1, 20],
    [24, 0, 1, 20],
    [32, 10, 1, 20],
    [40, 0, 1, 20],
  ],
];

interface Cell {
  x: number;
  y: number;
}

type Phase = 'ready' | 'play' | 'dying' | 'clear';

const DIRS: Record<string, Cell> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const pad = (n: number) => String(n).padStart(6, '0');

const sfx = {
  eat(s: Sound) {
    s.tone({ freq: 520, to: 1040, dur: 0.08, type: 'square', vol: 0.15, jitter: 0.04 });
  },
  star(s: Sound) {
    s.seq([[784, 0.05], [988, 0.05], [1319, 0.05], [1568, 0.12]], { type: 'square', vol: 0.15 });
  },
  starAppear(s: Sound) {
    s.tone({ freq: 1200, to: 1800, dur: 0.15, type: 'triangle', vol: 0.15 });
  },
  die(s: Sound) {
    s.noise({ dur: 0.4, freq: 2000, to: 200, vol: 0.3 });
    s.tone({ freq: 400, to: 60, dur: 0.7, type: 'sawtooth', vol: 0.18 });
  },
  levelClear(s: Sound) {
    s.seq([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.3]], { type: 'triangle', vol: 0.35 });
  },
};

export class NeonSerpentRound implements Round {
  score = 0;
  over = false;

  private level = 1;
  private lives = 3;
  private phase: Phase = 'ready';
  private phaseT = 0;
  private clock = 0;

  private walls = new Set<number>();
  private snake: Cell[] = [];
  private dir: Cell = DIRS.right;
  private queue: Cell[] = [];
  private grow = 0;
  private stepT = 0;
  private apple: Cell = { x: 0, y: 0 };
  private star: (Cell & { t: number }) | null = null;
  private applesThisLevel = 0;
  private applesTotal = 0;
  private popups: { x: number; y: number; text: string; t: number }[] = [];

  constructor(private env: RoundEnv) {
    this.setupLevel();
  }

  private get sound() {
    return this.env.audio;
  }

  /** Sekunden pro Schritt: schneller mit jedem Apfel und Level. */
  private get interval() {
    return Math.max(0.05, 0.13 - this.applesTotal * 0.0015 - (this.level - 1) * 0.006);
  }

  update(dt: number): void {
    this.clock += dt;
    this.phaseT += dt;
    this.popups = this.popups.filter((p) => (p.t += dt) < 1);
    this.readInput();

    switch (this.phase) {
      case 'ready':
        if (this.phaseT > 1.6) this.setPhase('play');
        break;
      case 'play':
        if (this.star && (this.star.t -= dt) <= 0) this.star = null;
        this.stepT -= dt;
        while (this.stepT <= 0 && this.phase === 'play') {
          this.stepT += this.interval;
          this.step();
        }
        break;
      case 'dying':
        if (this.phaseT > 1.5) {
          if (this.lives <= 0) this.over = true;
          else this.resetSnake();
        }
        break;
      case 'clear':
        if (this.phaseT > 2.2) {
          this.level++;
          this.setupLevel();
        }
        break;
    }
  }

  // ---------- Ablauf ----------

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  private key(x: number, y: number) {
    return y * COLS + x;
  }

  private setupLevel() {
    this.walls.clear();
    for (let x = 0; x < COLS; x++) {
      this.walls.add(this.key(x, 0));
      this.walls.add(this.key(x, ROWS - 1));
    }
    for (let y = 0; y < ROWS; y++) {
      this.walls.add(this.key(0, y));
      this.walls.add(this.key(COLS - 1, y));
    }
    for (const [rx, ry, rw, rh] of LAYOUTS[(this.level - 1) % LAYOUTS.length]) {
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) this.walls.add(this.key(x, y));
    }
    this.applesThisLevel = 0;
    this.star = null;
    this.resetSnake();
    this.placeApple();
  }

  private resetSnake() {
    // Start links unten, nach oben schauend – Spalte 3 ist in allen Layouts frei
    this.snake = [];
    for (let i = 0; i < START_LEN; i++) this.snake.push({ x: 3, y: ROWS - 3 - START_LEN + i });
    this.dir = DIRS.up;
    this.queue = [];
    this.grow = 0;
    this.stepT = 0;
    this.setPhase('ready');
  }

  private blocked(x: number, y: number, ignoreTail = false): boolean {
    if (this.walls.has(this.key(x, y))) return true;
    const body = ignoreTail ? this.snake.slice(0, -1) : this.snake;
    return body.some((c) => c.x === x && c.y === y);
  }

  private freeCell(): Cell {
    for (;;) {
      const c = { x: 1 + Math.floor(Math.random() * (COLS - 2)), y: 1 + Math.floor(Math.random() * (ROWS - 2)) };
      if (!this.blocked(c.x, c.y) && !(this.apple.x === c.x && this.apple.y === c.y)) return c;
    }
  }

  private placeApple() {
    this.apple = { x: -1, y: -1 };
    this.apple = this.freeCell();
  }

  // ---------- Steuerung ----------

  private readInput() {
    const input = this.env.input;
    for (const a of ['up', 'down', 'left', 'right'] as Action[]) {
      if (!input.pressed(a)) continue;
      // Bis zu zwei Abbiegungen vormerken; Umkehr in den eigenen Körper wird ignoriert
      const last = this.queue[this.queue.length - 1] ?? this.dir;
      const d = DIRS[a];
      if ((d.x === -last.x && d.y === -last.y) || (d.x === last.x && d.y === last.y)) continue;
      if (this.queue.length < 2) this.queue.push(d);
    }
  }

  private step() {
    const next = this.queue.shift();
    if (next) this.dir = next;
    const head = this.snake[0];
    const nx = head.x + this.dir.x;
    const ny = head.y + this.dir.y;

    if (this.blocked(nx, ny, this.grow === 0)) {
      this.lives--;
      sfx.die(this.sound);
      this.setPhase('dying');
      return;
    }

    this.snake.unshift({ x: nx, y: ny });
    if (this.grow > 0) this.grow--;
    else this.snake.pop();

    if (nx === this.apple.x && ny === this.apple.y) {
      const pts = 10 * this.level;
      this.score += pts;
      this.grow += 3;
      this.applesThisLevel++;
      this.applesTotal++;
      sfx.eat(this.sound);
      if (this.applesThisLevel >= APPLES_PER_LEVEL) {
        this.score += 500 * this.level;
        sfx.levelClear(this.sound);
        this.setPhase('clear');
        return;
      }
      this.placeApple();
      if (this.applesThisLevel % 4 === 0 && !this.star) {
        this.star = { ...this.freeCell(), t: 7 };
        sfx.starAppear(this.sound);
      }
    }

    if (this.star && nx === this.star.x && ny === this.star.y) {
      // Je schneller eingesammelt, desto mehr Punkte
      const pts = Math.max(50, Math.round(this.star.t * 30) * 10) * this.level;
      this.score += pts;
      this.popups.push({ x: X0 + nx * CELL + 4, y: Y0 + ny * CELL - 4, text: String(pts), t: 0 });
      sfx.star(this.sound);
      this.star = null;
    }
  }

  // ---------- Darstellung ----------

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#05030c';
    g.fillRect(0, 0, W, H);

    drawText(g, `SCORE ${pad(this.score)}`, X0, 8, { color: C.WHITE });
    drawText(g, `HI ${pad(Math.max(this.env.hiScore, this.score))}`, W / 2, 8, { color: C.YELLOW, align: 'center' });
    drawText(g, `LEVEL ${this.level}`, W - X0, 8, { color: C.CYAN, align: 'right' });

    // dezentes Raster
    g.fillStyle = '#0d0a1c';
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if ((x + y) % 2 === 0) g.fillRect(X0 + x * CELL, Y0 + y * CELL, CELL, CELL);

    for (const k of this.walls) {
      const x = X0 + (k % COLS) * CELL;
      const y = Y0 + Math.floor(k / COLS) * CELL;
      g.fillStyle = '#3a2a78';
      g.fillRect(x, y, CELL, CELL);
      g.fillStyle = '#5a48b0';
      g.fillRect(x, y, CELL, 1);
      g.fillRect(x, y, 1, CELL);
    }

    // Apfel
    const ax = X0 + this.apple.x * CELL;
    const ay = Y0 + this.apple.y * CELL;
    g.fillStyle = C.RED;
    g.fillRect(ax + 1, ay + 2, 6, 5);
    g.fillRect(ax + 2, ay + 1, 4, 7);
    g.fillStyle = C.GREEN;
    g.fillRect(ax + 4, ay, 2, 2);
    g.fillStyle = '#ffb0c0';
    g.fillRect(ax + 2, ay + 3, 1, 1);

    if (this.star && (this.star.t > 2 || this.clock % 0.3 < 0.18)) {
      const sx = X0 + this.star.x * CELL;
      const sy = Y0 + this.star.y * CELL;
      g.fillStyle = C.YELLOW;
      g.fillRect(sx + 3, sy, 2, 8);
      g.fillRect(sx, sy + 3, 8, 2);
      g.fillRect(sx + 2, sy + 2, 4, 4);
    }

    const dead = this.phase === 'dying';
    this.snake.forEach((c, i) => {
      const x = X0 + c.x * CELL;
      const y = Y0 + c.y * CELL;
      const flash = dead && this.clock % 0.2 < 0.1;
      g.fillStyle = flash ? C.WHITE : i === 0 ? '#9dffaa' : i % 2 ? C.GREEN : '#3ad84e';
      g.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      if (i === 0) {
        // Augen in Blickrichtung
        g.fillStyle = C.BLACK;
        const ex = this.dir.x === 0 ? [2, 5] : [this.dir.x > 0 ? 5 : 2, this.dir.x > 0 ? 5 : 2];
        const ey = this.dir.y === 0 ? [2, 5] : [this.dir.y > 0 ? 5 : 2, this.dir.y > 0 ? 5 : 2];
        g.fillRect(x + ex[0], y + ey[0], 1, 1);
        g.fillRect(x + ex[1], y + ey[1], 1, 1);
      }
    });

    for (const p of this.popups) drawText(g, p.text, p.x, p.y - p.t * 10, { color: C.YELLOW, align: 'center' });

    const by = Y0 + ROWS * CELL + 4;
    drawText(g, 'LIVES', X0, by, { color: C.DIM });
    for (let i = 0; i < Math.min(this.lives, 8); i++) {
      g.fillStyle = C.GREEN;
      g.fillRect(X0 + 36 + i * 10, by + 1, 6, 6);
    }
    drawText(g, `APPLES ${this.applesThisLevel}/${APPLES_PER_LEVEL}`, W / 2, by, { color: C.RED, align: 'center' });
    drawText(g, 'ESC = HALL', W - X0, by, { color: '#3e3566', align: 'right' });

    if (this.phase === 'ready') this.message(g, `LEVEL ${this.level}`, C.CYAN, 'GET READY');
    else if (this.phase === 'clear') this.message(g, 'LEVEL CLEAR!', C.GREEN, `BONUS ${500 * this.level}`);
  }

  private message(g: CanvasRenderingContext2D, text: string, color: string, sub: string) {
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.fillRect(0, 118, W, 38);
    drawText(g, text, W / 2, 122, { scale: 2, color, align: 'center', glow: true });
    drawText(g, sub, W / 2, 143, { color: C.YELLOW, align: 'center' });
  }
}
