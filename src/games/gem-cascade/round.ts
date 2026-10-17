import { makeSprite, type Sprite } from '../../engine/draw';
import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import type { Round, RoundEnv } from '../../engine/shell';
import type { Sound } from '../../engine/sound';
import { SCREEN_H as H, SCREEN_W as W } from '../../engine/types';

const COLS = 6;
const ROWS = 13;
const CELL = 16;
const X0 = (W - COLS * CELL) / 2;
const Y0 = 36;
const GEMS_PER_LEVEL = 30;
const LOCK_DELAY = 0.35;
const DAS = 0.18;
const ARR = 0.07;

/** Jede Farbe hat auch eine eigene Form – auch bei Farbschwäche gut zu unterscheiden. */
const SHAPES = [
  ['....####....', '..########..', '.##########.', '.##########.', '############', '############', '############', '############', '.##########.', '.##########.', '..########..', '....####....'],
  ['.....##.....', '....####....', '...######...', '..########..', '.##########.', '############', '############', '.##########.', '..########..', '...######...', '....####....', '.....##.....'],
  ['.##########.', '############', '############', '############', '############', '############', '############', '############', '############', '############', '############', '.##########.'],
  ['.....##.....', '.....##.....', '....####....', '....####....', '...######...', '...######...', '..########..', '..########..', '.##########.', '.##########.', '############', '############'],
  ['....####....', '....####....', '....####....', '....####....', '############', '############', '############', '############', '....####....', '....####....', '....####....', '....####....'],
  ['############', '.##########.', '..########..', '...######...', '....####....', '.....##.....', '.....##.....', '....####....', '...######...', '..########..', '.##########.', '############'],
];
export const GEM_COLORS = [C.RED, C.YELLOW, C.GREEN, C.CYAN, C.MAGENTA, C.ORANGE];
export const GEMS: Sprite[] = SHAPES.map((rows, i) => makeSprite(rows, GEM_COLORS[i]));
const GEMS_WHITE: Sprite[] = SHAPES.map((rows) => makeSprite(rows, C.WHITE));

type Phase = 'falling' | 'clearing' | 'settling' | 'topout';

const sfx = {
  move(s: Sound) {
    s.tone({ freq: 440, dur: 0.03, type: 'square', vol: 0.06 });
  },
  rotate(s: Sound) {
    s.tone({ freq: 660, to: 880, dur: 0.05, type: 'square', vol: 0.08 });
  },
  land(s: Sound) {
    s.tone({ freq: 160, dur: 0.06, type: 'triangle', vol: 0.25 });
  },
  clear(s: Sound, chain: number) {
    const base = 523 * Math.pow(1.12, chain - 1);
    s.seq([[base, 0.06], [base * 1.25, 0.06], [base * 1.5, 0.12]], { type: 'square', vol: 0.14 });
  },
  level(s: Sound) {
    s.seq([[392, 0.1], [523, 0.1], [659, 0.1], [784, 0.25]], { type: 'triangle', vol: 0.35 });
  },
  topout(s: Sound) {
    s.tone({ freq: 600, to: 60, dur: 1.2, type: 'sawtooth', vol: 0.18 });
  },
};

const randGem = () => Math.floor(Math.random() * GEMS.length);
const pad = (n: number) => String(n).padStart(6, '0');

export class GemCascadeRound implements Round {
  score = 0;
  over = false;

  private level = 1;
  private gemsCleared = 0;
  private phase: Phase = 'falling';
  private phaseT = 0;
  private clock = 0;

  /** Spielfeld: -1 = leer, sonst Edelstein-Index. */
  private board: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(-1));
  private piece = [randGem(), randGem(), randGem()];
  private next = [randGem(), randGem(), randGem()];
  private px = 2;
  /** Zeile des untersten Steins der Säule (kann anfangs über dem Feld liegen). */
  private py = 0;
  private fallT = 0;
  private lockT = 0;
  private moveHeld = 0;
  private moveT = 0;
  private chain = 0;
  private clearing = new Set<number>();
  private lastClear = { pts: 0, chain: 0, t: 0 };

  constructor(private env: RoundEnv) {}

  private get sound() {
    return this.env.audio;
  }

  private get fallInterval() {
    return Math.max(0.08, 0.8 * Math.pow(0.85, this.level - 1));
  }

  update(dt: number): void {
    this.clock += dt;
    this.phaseT += dt;
    this.lastClear.t += dt;

    switch (this.phase) {
      case 'falling':
        this.updatePiece(dt);
        break;
      case 'clearing':
        if (this.phaseT > 0.35) {
          for (const k of this.clearing) this.board[Math.floor(k / COLS)][k % COLS] = -1;
          this.clearing.clear();
          this.collapse();
          this.setPhase('settling');
        }
        break;
      case 'settling':
        if (this.phaseT > 0.12) this.resolve();
        break;
      case 'topout':
        if (this.phaseT > 2) this.over = true;
        break;
    }
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  // ---------- Fallende Säule ----------

  private cellFree(c: number, r: number): boolean {
    if (c < 0 || c >= COLS || r >= ROWS) return false;
    return r < 0 || this.board[r][c] === -1;
  }

  private fits(c: number, bottom: number): boolean {
    return [0, 1, 2].every((i) => this.cellFree(c, bottom - i));
  }

  private updatePiece(dt: number) {
    const input = this.env.input;

    // Seitlich bewegen, gedrückt halten wiederholt
    const dx = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    const tapped = input.pressed('left') ? -1 : input.pressed('right') ? 1 : 0;
    if (tapped) {
      this.tryMove(tapped);
      this.moveHeld = 0;
      this.moveT = 0;
    } else if (dx) {
      this.moveHeld += dt;
      if (this.moveHeld > DAS) {
        this.moveT -= dt;
        if (this.moveT <= 0) {
          this.moveT = ARR;
          this.tryMove(dx);
        }
      }
    } else {
      this.moveHeld = 0;
    }

    // Reihenfolge durchwechseln
    if (input.pressed('a') || input.pressed('up')) {
      this.piece = [this.piece[2], this.piece[0], this.piece[1]];
      sfx.rotate(this.sound);
    }

    // Sofort fallen lassen
    if (input.pressed('b')) {
      let dropped = 0;
      while (this.fits(this.px, this.py + 1)) {
        this.py++;
        dropped++;
      }
      this.score += dropped * 2;
      this.lock();
      return;
    }

    const soft = input.held('down');
    this.fallT -= dt;
    const interval = soft ? Math.min(0.04, this.fallInterval) : this.fallInterval;
    if (this.fallT <= 0) {
      this.fallT = interval;
      if (this.fits(this.px, this.py + 1)) {
        this.py++;
        this.lockT = 0;
        if (soft) this.score += 1;
      }
    }
    if (!this.fits(this.px, this.py + 1)) {
      this.lockT += dt;
      if (this.lockT >= LOCK_DELAY || soft) this.lock();
    }
  }

  private tryMove(dx: number) {
    if (this.fits(this.px + dx, this.py)) {
      this.px += dx;
      sfx.move(this.sound);
    }
  }

  private lock() {
    sfx.land(this.sound);
    let overflow = false;
    for (let i = 0; i < 3; i++) {
      const r = this.py - i;
      if (r < 0) overflow = true;
      else this.board[r][this.px] = this.piece[i];
    }
    if (overflow) {
      sfx.topout(this.sound);
      this.setPhase('topout');
      return;
    }
    this.chain = 0;
    this.resolve();
  }

  // ---------- Treffer und Ketten ----------

  /** Sucht Dreier-Reihen (auch diagonal); nichts gefunden → nächste Säule. */
  private resolve() {
    const found = new Set<number>();
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const gem = this.board[r][c];
        if (gem < 0) continue;
        for (const [dc, dr] of dirs) {
          let n = 1;
          while (this.inBoard(c + dc * n, r + dr * n) && this.board[r + dr * n][c + dc * n] === gem) n++;
          if (n >= 3) for (let k = 0; k < n; k++) found.add((r + dr * k) * COLS + (c + dc * k));
        }
      }
    }

    if (!found.size) {
      this.spawn();
      return;
    }
    this.chain++;
    const pts = found.size * 10 * this.level * this.chain;
    this.score += pts;
    this.lastClear = { pts, chain: this.chain, t: 0 };
    this.gemsCleared += found.size;
    sfx.clear(this.sound, this.chain);
    if (this.gemsCleared >= this.level * GEMS_PER_LEVEL) {
      this.level++;
      sfx.level(this.sound);
    }
    this.clearing = found;
    this.setPhase('clearing');
  }

  private inBoard(c: number, r: number) {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS;
  }

  private collapse() {
    for (let c = 0; c < COLS; c++) {
      const col = [];
      for (let r = ROWS - 1; r >= 0; r--) if (this.board[r][c] >= 0) col.push(this.board[r][c]);
      for (let r = ROWS - 1, i = 0; r >= 0; r--, i++) this.board[r][c] = col[i] ?? -1;
    }
  }

  private spawn() {
    this.piece = this.next;
    this.next = [randGem(), randGem(), randGem()];
    this.px = 2;
    this.py = 0;
    this.fallT = this.fallInterval;
    this.lockT = 0;
    if (!this.fits(this.px, this.py)) {
      sfx.topout(this.sound);
      this.setPhase('topout');
      return;
    }
    this.setPhase('falling');
  }

  // ---------- Darstellung ----------

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#060410';
    g.fillRect(0, 0, W, H);

    // Rahmen und Feld
    g.fillStyle = '#2c2148';
    g.fillRect(X0 - 4, Y0 - 4, COLS * CELL + 8, ROWS * CELL + 8);
    g.fillStyle = '#0a0718';
    g.fillRect(X0, Y0, COLS * CELL, ROWS * CELL);
    g.fillStyle = '#120d26';
    for (let c = 1; c < COLS; c++) g.fillRect(X0 + c * CELL, Y0, 1, ROWS * CELL);
    for (let r = 1; r < ROWS; r++) g.fillRect(X0, Y0 + r * CELL, COLS * CELL, 1);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const gem = this.board[r][c];
        if (gem < 0) continue;
        const flash = this.clearing.has(r * COLS + c) && this.clock % 0.1 < 0.05;
        this.drawGem(g, gem, X0 + c * CELL, Y0 + r * CELL, flash);
      }
    }

    if (this.phase === 'falling') {
      // Schatten: wo landet die Säule?
      let ghost = this.py;
      while (this.fits(this.px, ghost + 1)) ghost++;
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(X0 + this.px * CELL, Y0 + (ghost - 2) * CELL, CELL, CELL * 3);

      g.save();
      g.beginPath();
      g.rect(X0, Y0, COLS * CELL, ROWS * CELL);
      g.clip();
      for (let i = 0; i < 3; i++) this.drawGem(g, this.piece[i], X0 + this.px * CELL, Y0 + (this.py - i) * CELL, false);
      g.restore();
    }

    // Linke Seite: Punkte
    const L = X0 / 2;
    drawText(g, 'SCORE', L, 40, { color: C.DIM, align: 'center' });
    drawText(g, pad(this.score), L, 52, { scale: 2, color: C.WHITE, align: 'center' });
    drawText(g, 'HIGH', L, 82, { color: C.DIM, align: 'center' });
    drawText(g, pad(Math.max(this.env.hiScore, this.score)), L, 94, { scale: 2, color: C.YELLOW, align: 'center' });
    drawText(g, 'LEVEL', L, 128, { color: C.DIM, align: 'center' });
    drawText(g, String(this.level), L, 140, { scale: 3, color: C.CYAN, align: 'center' });
    drawText(g, 'GEMS', L, 176, { color: C.DIM, align: 'center' });
    drawText(g, `${this.gemsCleared}`, L, 188, { scale: 2, color: C.GREEN, align: 'center' });

    // Rechte Seite: nächste Säule
    const R = X0 + COLS * CELL + (W - X0 - COLS * CELL) / 2;
    drawText(g, 'NEXT', R, 40, { color: C.DIM, align: 'center' });
    g.fillStyle = '#0a0718';
    g.fillRect(R - 12, 52, 24, 56);
    for (let i = 0; i < 3; i++) this.drawGem(g, this.next[i], R - 8, 52 + 4 + (2 - i) * CELL, false);

    if (this.lastClear.t < 1.5 && this.lastClear.chain > 0) {
      drawText(g, `+${this.lastClear.pts}`, R, 130, { scale: 2, color: C.YELLOW, align: 'center' });
      if (this.lastClear.chain > 1) drawText(g, `CHAIN X${this.lastClear.chain}`, R, 152, { color: C.MAGENTA, align: 'center' });
    }
    drawText(g, 'ESC = HALL', R, H - 14, { color: '#3e3566', align: 'center' });

    if (this.phase === 'topout') {
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(X0 - 4, 120, COLS * CELL + 8, 30);
      drawText(g, 'FULL!', W / 2, 128, { scale: 2, color: C.RED, align: 'center', glow: true });
    }
  }

  private drawGem(g: CanvasRenderingContext2D, gem: number, x: number, y: number, flash: boolean) {
    g.drawImage((flash ? GEMS_WHITE : GEMS)[gem], x + 2, y + 2);
    if (!flash) {
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(x + 5, y + 5, 2, 1);
    }
  }
}
