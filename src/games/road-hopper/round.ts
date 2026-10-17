import type { Action } from '../../engine/input';
import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import type { Round, RoundEnv } from '../../engine/shell';
import type { Sound } from '../../engine/sound';
import { SCREEN_H as H, SCREEN_W as W } from '../../engine/types';

const CELL = 16;
const COLS = W / CELL;
const ROWS = 13;
const Y0 = 24;
const START_ROW = 12;
const MEDIAN_ROW = 6;
const TIME_LIMIT = 30;
const HOP_TIME = 0.1;
const HOP_REPEAT = 0.22;
const HOME_X = [32, 104, 176, 248, 320];

type Kind = 'log' | 'turtle' | 'car' | 'truck';

interface LaneDef {
  row: number;
  kind: Kind;
  len: number;
  speed: number;
  count: number;
  color?: string;
  diving?: boolean;
}

/** Spuren: Fluss oben (Zeilen 1–5), Straße unten (Zeilen 7–11). Tempo in Pixel/s, negativ = nach links. */
const LANES: LaneDef[] = [
  { row: 1, kind: 'log', len: 4, speed: 32, count: 3 },
  { row: 2, kind: 'turtle', len: 2, speed: -45, count: 4, diving: true },
  { row: 3, kind: 'log', len: 6, speed: 48, count: 2 },
  { row: 4, kind: 'log', len: 3, speed: 26, count: 4 },
  { row: 5, kind: 'turtle', len: 3, speed: -36, count: 3 },
  { row: 7, kind: 'truck', len: 2, speed: -40, count: 2, color: '#d8d0f0' },
  { row: 8, kind: 'car', len: 1, speed: 80, count: 3, color: C.MAGENTA },
  { row: 9, kind: 'car', len: 1, speed: -48, count: 4, color: C.YELLOW },
  { row: 10, kind: 'car', len: 1, speed: 62, count: 3, color: C.CYAN },
  { row: 11, kind: 'car', len: 1, speed: -34, count: 3, color: C.ORANGE },
];

const PERIOD = W + 96;

interface Lane extends LaneDef {
  offsets: number[];
  shift: number;
}

type Phase = 'play' | 'dying' | 'home' | 'clear';

const DIRS: Record<string, { x: number; y: number }> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

const sfx = {
  hop(s: Sound) {
    s.tone({ freq: 300, to: 600, dur: 0.06, type: 'square', vol: 0.12 });
  },
  squash(s: Sound) {
    s.noise({ dur: 0.3, freq: 1800, to: 200, vol: 0.4 });
    s.tone({ freq: 200, to: 60, dur: 0.4, type: 'square', vol: 0.15 });
  },
  splash(s: Sound) {
    s.noise({ dur: 0.6, freq: 4000, to: 300, vol: 0.35 });
  },
  home(s: Sound) {
    s.seq([[659, 0.08], [784, 0.08], [988, 0.08], [1319, 0.18]], { type: 'square', vol: 0.15 });
  },
  levelClear(s: Sound) {
    s.seq([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.1], [784, 0.1], [1047, 0.35]], { type: 'triangle', vol: 0.35 });
  },
  tick(s: Sound) {
    s.tone({ freq: 1000, dur: 0.04, type: 'square', vol: 0.08 });
  },
};

const pad = (n: number) => String(n).padStart(6, '0');

export class RoadHopperRound implements Round {
  score = 0;
  over = false;

  private level = 1;
  private lives = 3;
  private phase: Phase = 'play';
  private phaseT = 0;
  private clock = 0;

  private lanes: Lane[] = [];
  private hx = 0;
  private row = START_ROW;
  private face = DIRS.up;
  private hopT = 0;
  private holdT = 0;
  private bestRow = START_ROW;
  private time = TIME_LIMIT;
  private homes = [false, false, false, false, false];
  private deathKind: 'squash' | 'splash' = 'squash';
  private lastTick = 0;

  constructor(private env: RoundEnv) {
    this.setupLevel();
  }

  private get sound() {
    return this.env.audio;
  }

  private get speedFactor() {
    return 1 + (this.level - 1) * 0.15;
  }

  update(dt: number): void {
    this.clock += dt;
    this.phaseT += dt;
    for (const l of this.lanes) l.shift += l.speed * this.speedFactor * dt;

    switch (this.phase) {
      case 'play':
        this.updateHopper(dt);
        break;
      case 'dying':
        if (this.phaseT > 1.4) {
          if (this.lives <= 0) this.over = true;
          else this.resetHopper();
        }
        break;
      case 'home':
        if (this.phaseT > 0.8) this.resetHopper();
        break;
      case 'clear':
        if (this.phaseT > 2.5) {
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

  private setupLevel() {
    this.lanes = LANES.map((d) => {
      const spacing = PERIOD / d.count;
      return { ...d, offsets: Array.from({ length: d.count }, (_, i) => i * spacing + Math.random() * spacing * 0.3), shift: 0 };
    });
    this.homes = [false, false, false, false, false];
    this.resetHopper();
  }

  private resetHopper() {
    this.hx = (COLS / 2) * CELL - CELL / 2;
    this.row = START_ROW;
    this.face = DIRS.up;
    this.bestRow = START_ROW;
    this.time = TIME_LIMIT;
    this.hopT = 0;
    this.setPhase('play');
  }

  /** Linke Kanten aller Objekte einer Spur (Pixel). */
  private itemsOf(l: Lane): number[] {
    return l.offsets.map((o) => (((o + l.shift) % PERIOD) + PERIOD) % PERIOD - 48);
  }

  /** Taucht diese Schildkrötengruppe gerade ab? */
  private submerged(l: Lane, i: number): boolean {
    if (!l.diving || i % 2 === 1) return false;
    const t = (this.clock + i * 1.7) % 6;
    return t > 4.3 && t < 5.5;
  }

  private warning(l: Lane, i: number): boolean {
    if (!l.diving || i % 2 === 1) return false;
    const t = (this.clock + i * 1.7) % 6;
    return t > 3.5 && t <= 4.3;
  }

  // ---------- Hüpfer ----------

  private updateHopper(dt: number) {
    const input = this.env.input;
    this.hopT = Math.max(0, this.hopT - dt);

    let dir: { x: number; y: number } | null = null;
    for (const a of ['up', 'down', 'left', 'right'] as Action[]) {
      if (input.pressed(a)) dir = DIRS[a];
    }
    // Gedrückt halten wiederholt den Sprung
    const held = (['up', 'down', 'left', 'right'] as Action[]).find((a) => input.held(a));
    if (!dir && held) {
      this.holdT += dt;
      if (this.holdT > HOP_REPEAT) dir = DIRS[held];
    }
    if (dir && this.hopT === 0) {
      this.holdT = 0;
      this.hop(dir);
      if (this.phase !== 'play') return;
    } else if (!held) {
      this.holdT = 0;
    }

    // Auf Baumstamm oder Schildkröte mitfahren
    const lane = this.lanes.find((l) => l.row === this.row);
    if (lane && (lane.kind === 'log' || lane.kind === 'turtle')) {
      const center = this.hx + CELL / 2;
      const items = this.itemsOf(lane);
      const on = items.findIndex((x, i) => center >= x + 2 && center <= x + lane.len * CELL - 2 && !this.submerged(lane, i));
      if (on < 0) return this.die('splash');
      this.hx += lane.speed * this.speedFactor * dt;
      if (this.hx < -4 || this.hx > W - CELL + 4) return this.die('splash');
    }

    if (lane && (lane.kind === 'car' || lane.kind === 'truck')) {
      const items = this.itemsOf(lane);
      if (items.some((x) => this.hx + 3 < x + lane.len * CELL && this.hx + CELL - 3 > x)) return this.die('squash');
    }

    this.time -= dt;
    if (this.time < 8 && Math.floor(this.time) !== this.lastTick) {
      this.lastTick = Math.floor(this.time);
      sfx.tick(this.sound);
    }
    if (this.time <= 0) this.die('squash');
  }

  private hop(d: { x: number; y: number }) {
    this.face = d;
    const nx = this.hx + d.x * CELL;
    const nr = this.row + d.y;
    if (nr > START_ROW || nx < -2 || nx > W - CELL + 2) return;
    this.hx = Math.max(0, Math.min(W - CELL, nx));
    this.row = nr;
    this.hopT = HOP_TIME;
    sfx.hop(this.sound);

    if (nr < this.bestRow) {
      this.bestRow = nr;
      this.score += 10;
    }

    if (nr === 0) {
      const center = this.hx + CELL / 2;
      const slot = HOME_X.findIndex((hx) => Math.abs(hx - center) <= 9);
      if (slot < 0 || this.homes[slot]) return this.die('squash');
      this.homes[slot] = true;
      this.hx = HOME_X[slot] - CELL / 2;
      this.score += 50 + Math.floor(this.time) * 10;
      if (this.homes.every(Boolean)) {
        this.score += 1000 * this.level;
        sfx.levelClear(this.sound);
        this.setPhase('clear');
      } else {
        sfx.home(this.sound);
        this.setPhase('home');
      }
    }
  }

  private die(kind: 'squash' | 'splash') {
    this.deathKind = kind;
    this.lives--;
    if (kind === 'splash') sfx.splash(this.sound);
    else sfx.squash(this.sound);
    this.setPhase('dying');
  }

  // ---------- Darstellung ----------

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#05030c';
    g.fillRect(0, 0, W, H);

    const ry = (r: number) => Y0 + r * CELL;
    // Fluss
    g.fillStyle = '#0a1a52';
    g.fillRect(0, ry(1), W, 5 * CELL);
    g.fillStyle = '#12267a';
    for (let r = 1; r <= 5; r++) {
      for (let x = (r * 37 + Math.floor(this.clock * 10)) % 24; x < W; x += 24) g.fillRect(x, ry(r) + 8, 6, 1);
    }
    // Ufer mit Buchten
    g.fillStyle = '#1f5a2a';
    g.fillRect(0, ry(0), W, CELL);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = '#0a1a52';
      g.fillRect(HOME_X[i] - 12, ry(0) + 2, 24, CELL - 2);
      if (this.homes[i]) this.drawHopper(g, HOME_X[i] - CELL / 2, ry(0), DIRS.down, C.GREEN);
    }
    // Mittelstreifen und Start
    for (const r of [MEDIAN_ROW, START_ROW]) {
      g.fillStyle = '#2a1650';
      g.fillRect(0, ry(r), W, CELL);
      g.fillStyle = '#3a2468';
      for (let x = 0; x < W; x += 8) g.fillRect(x, ry(r) + ((x / 8) % 2) * 8, 4, 4);
    }
    // Straße
    g.fillStyle = '#120e1c';
    g.fillRect(0, ry(7), W, 5 * CELL);
    g.fillStyle = '#4a4466';
    for (let r = 8; r <= 11; r++) for (let x = 0; x < W; x += 24) g.fillRect(x, ry(r), 12, 1);

    for (const l of this.lanes) {
      const y = ry(l.row);
      this.itemsOf(l).forEach((x, i) => this.drawItem(g, l, i, Math.round(x), y));
    }

    // Hüpfer
    const hy = ry(this.row);
    if (this.phase === 'dying') {
      this.drawDeath(g, Math.round(this.hx), hy);
    } else if (this.phase !== 'clear' && !(this.phase === 'home')) {
      const lift = this.hopT > 0 ? -2 : 0;
      this.drawHopper(g, Math.round(this.hx), hy + lift, this.face, '#7dff8a');
    }

    // Kopfzeile
    drawText(g, `SCORE ${pad(this.score)}`, 8, 6, { color: C.WHITE });
    drawText(g, `HI ${pad(Math.max(this.env.hiScore, this.score))}`, W / 2, 6, { color: C.YELLOW, align: 'center' });
    drawText(g, `LEVEL ${this.level}`, W - 8, 6, { color: C.CYAN, align: 'right' });

    // Fußzeile: Leben und Zeit
    const by = Y0 + ROWS * CELL + 8;
    drawText(g, 'LIVES', 8, by, { color: C.DIM });
    for (let i = 0; i < Math.min(this.lives, 8); i++) this.drawHopper(g, 44 + i * 16, by - 4, DIRS.up, C.GREEN, 0.75);
    drawText(g, 'TIME', W - 140, by, { color: C.DIM });
    const frac = Math.max(0, this.time / TIME_LIMIT);
    g.fillStyle = '#241a3a';
    g.fillRect(W - 110, by, 100, 7);
    g.fillStyle = frac > 0.3 ? C.GREEN : this.clock % 0.4 < 0.2 ? C.RED : C.ORANGE;
    g.fillRect(W - 110, by, Math.round(100 * frac), 7);
    drawText(g, 'ESC = HALL', W - 8, H - 12, { color: '#3e3566', align: 'right' });

    if (this.phase === 'clear') {
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillRect(0, ry(MEDIAN_ROW) - 10, W, 36);
      drawText(g, 'ALL HOME!', W / 2, ry(MEDIAN_ROW) - 6, { scale: 2, color: C.GREEN, align: 'center', glow: true });
      drawText(g, `BONUS ${1000 * this.level}`, W / 2, ry(MEDIAN_ROW) + 14, { color: C.YELLOW, align: 'center' });
    } else if (this.phase === 'play' && this.time > TIME_LIMIT - 1.5 && this.bestRow === START_ROW) {
      drawText(g, 'HOP HOME!', W / 2, ry(MEDIAN_ROW) + 4, { scale: 2, color: C.YELLOW, align: 'center', glow: true });
    }
  }

  private drawItem(g: CanvasRenderingContext2D, l: Lane, i: number, x: number, y: number) {
    const w = l.len * CELL;
    switch (l.kind) {
      case 'log':
        g.fillStyle = '#8a5a2a';
        g.fillRect(x, y + 3, w, CELL - 6);
        g.fillStyle = '#b07a3a';
        g.fillRect(x, y + 3, w, 2);
        g.fillStyle = '#5a3a1a';
        for (let k = 6; k < w - 4; k += 10) g.fillRect(x + k, y + 7, 4, 1);
        g.fillStyle = '#c89050';
        g.fillRect(x + w - 3, y + 4, 3, CELL - 8);
        break;
      case 'turtle': {
        if (this.submerged(l, i)) {
          g.fillStyle = '#1a3a8a';
          for (let k = 0; k < l.len; k++) g.fillRect(x + k * CELL + 4, y + 7, 8, 2);
          break;
        }
        const warn = this.warning(l, i) && this.clock % 0.3 < 0.15;
        for (let k = 0; k < l.len; k++) {
          const tx = x + k * CELL;
          g.fillStyle = warn ? C.RED : '#2a9a4a';
          g.fillRect(tx + 2, y + 3, 12, 10);
          g.fillStyle = warn ? '#ff9aa8' : '#5ad86a';
          g.fillRect(tx + 4, y + 5, 8, 6);
          g.fillStyle = '#2a9a4a';
          g.fillRect(tx + (l.speed < 0 ? 0 : 13), y + 6, 3, 4);
        }
        break;
      }
      case 'car': {
        const color = l.color ?? C.RED;
        g.fillStyle = color;
        g.fillRect(x + 1, y + 3, CELL - 2, CELL - 6);
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect(x + (l.speed > 0 ? 8 : 3), y + 5, 5, CELL - 10);
        g.fillStyle = '#222';
        g.fillRect(x + 2, y + 1, 4, 2);
        g.fillRect(x + CELL - 6, y + 1, 4, 2);
        g.fillRect(x + 2, y + CELL - 3, 4, 2);
        g.fillRect(x + CELL - 6, y + CELL - 3, 4, 2);
        g.fillStyle = C.YELLOW;
        g.fillRect(l.speed > 0 ? x + CELL - 2 : x + 1, y + 4, 1, 2);
        g.fillRect(l.speed > 0 ? x + CELL - 2 : x + 1, y + CELL - 6, 1, 2);
        break;
      }
      case 'truck': {
        const cab = l.speed > 0 ? x + w - 9 : x;
        g.fillStyle = l.color ?? C.WHITE;
        g.fillRect(x + 1, y + 2, w - 2, CELL - 4);
        g.fillStyle = C.RED;
        g.fillRect(cab + 1, y + 3, 8, CELL - 6);
        g.fillStyle = '#222';
        for (const wx of [x + 3, x + w - 7]) {
          g.fillRect(wx, y, 4, 2);
          g.fillRect(wx, y + CELL - 2, 4, 2);
        }
        break;
      }
    }
  }

  /** Eigene Figur: rundlicher Hüpfer mit großen Augen, die in Sprungrichtung schauen. */
  private drawHopper(g: CanvasRenderingContext2D, x: number, y: number, face: { x: number; y: number }, color: string, k = 1) {
    const s = (v: number) => Math.round(v * k);
    g.fillStyle = color;
    g.fillRect(x + s(3), y + s(3), s(10), s(10));
    g.fillRect(x + s(2), y + s(5), s(12), s(6));
    // Beine
    g.fillStyle = '#3ab04a';
    g.fillRect(x + s(1), y + s(2), s(3), s(3));
    g.fillRect(x + s(12), y + s(2), s(3), s(3));
    g.fillRect(x + s(1), y + s(11), s(3), s(3));
    g.fillRect(x + s(12), y + s(11), s(3), s(3));
    // Augen
    const ex = 8 + face.x * 3;
    const ey = 8 + face.y * 3;
    g.fillStyle = C.WHITE;
    g.fillRect(x + s(ex - 4), y + s(ey - 2), s(3), s(3));
    g.fillRect(x + s(ex + 1), y + s(ey - 2), s(3), s(3));
    g.fillStyle = C.BLACK;
    g.fillRect(x + s(ex - 3 + face.x), y + s(ey - 1 + face.y), Math.max(1, s(1)), Math.max(1, s(1)));
    g.fillRect(x + s(ex + 2 + face.x), y + s(ey - 1 + face.y), Math.max(1, s(1)), Math.max(1, s(1)));
  }

  private drawDeath(g: CanvasRenderingContext2D, x: number, y: number) {
    const f = Math.min(3, Math.floor(this.phaseT * 4));
    if (this.deathKind === 'splash') {
      g.fillStyle = C.WHITE;
      const r = 2 + f * 2;
      for (let a = 0; a < 8; a++) {
        g.fillRect(x + 8 + Math.round(Math.cos((a * Math.PI) / 4) * r), y + 8 + Math.round(Math.sin((a * Math.PI) / 4) * r), 2, 2);
      }
    } else {
      g.fillStyle = f % 2 ? C.RED : C.YELLOW;
      g.fillRect(x + 2, y + 6, 12, 4);
      g.fillRect(x + 6, y + 2, 4, 12);
      g.fillRect(x + 3, y + 3, 2, 2);
      g.fillRect(x + 11, y + 11, 2, 2);
      g.fillRect(x + 11, y + 3, 2, 2);
      g.fillRect(x + 3, y + 11, 2, 2);
    }
  }
}
