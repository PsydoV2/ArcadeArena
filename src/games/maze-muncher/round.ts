import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import type { Round, RoundEnv } from '../../engine/shell';
import { DEAD_LOOP, type LoopHandle } from '../../engine/sound';
import { SCREEN_H as H, SCREEN_W as W } from '../../engine/types';
import { Maze, MAZE_COLS, MAZE_ROWS, renderWalls, T, TUNNEL_ROW } from './maze';
import { sfx } from './sfx';
import {
  drawMuncher,
  FRUITS,
  fruitIndex,
  fruitPoints,
  IMP_SCARED,
  IMP_SCARED_FLASH,
  IMPS,
} from './sprites';

interface Dir {
  x: number;
  y: number;
}
const UP: Dir = { x: 0, y: -1 };
const LEFT: Dir = { x: -1, y: 0 };
const DOWN: Dir = { x: 0, y: 1 };
const RIGHT: Dir = { x: 1, y: 0 };
/** Reihenfolge entscheidet bei Gleichstand. */
const DIRS = [UP, LEFT, DOWN, RIGHT];

const OX = 80;
const OY = 24;
const MAZE_W = MAZE_COLS * T;
const MAZE_H = MAZE_ROWS * T;

const START_X = 112;
const START_Y = 20 * T + T / 2;
const DOOR_X = 112;
const ABOVE_DOOR_Y = 11 * T + T / 2;
const HOUSE_Y = 14 * T + T / 2;
const FRUIT_Y = 17 * T + T / 2;

const IMP_STARTS = [
  { x: DOOR_X, y: ABOVE_DOOR_Y },
  { x: DOOR_X, y: HOUSE_Y },
  { x: DOOR_X - 12, y: HOUSE_Y },
  { x: DOOR_X + 12, y: HOUSE_Y },
];
const RELEASE_TIMES = [0, 1, 4, 8];
const SCATTER: [number, number][] = [[25, -3], [2, -3], [27, 32], [0, 32]];
/** Wechsel zwischen Ausschwärmen und Jagen (Sekunden), beginnend mit Ausschwärmen. */
const MODE_SCHEDULE = [7, 20, 7, 20, 5, 20, 5, Infinity];
const FRUIT_AT_DOTS = [70, 170];
const EXTRA_LIFE_AT = 10000;

type Phase = 'ready' | 'play' | 'eat' | 'dying' | 'cleared';
type ImpState = 'house' | 'leaving' | 'active' | 'eyes' | 'entering';

interface Mover {
  x: number;
  y: number;
  dir: Dir;
}

interface Imp extends Mover {
  id: number;
  state: ImpState;
  scared: boolean;
  release: number;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  t: number;
  life: number;
  color: string;
}

const opposite = (a: Dir, b: Dir) => a.x === -b.x && a.y === -b.y;

/**
 * Bewegt eine Figur entlang der Gänge. An jeder Kachelmitte entscheidet `decide`
 * über die nächste Richtung (null = stehen bleiben).
 */
function advance(m: Mover, dist: number, decide: (c: number, r: number) => Dir | null): boolean {
  let moved = false;
  while (dist > 1e-6) {
    const c = Math.floor(m.x / T);
    const r = Math.floor(m.y / T);
    const cx = c * T + T / 2;
    const cy = r * T + T / 2;
    let to = m.dir.x ? (cx - m.x) * m.dir.x : (cy - m.y) * m.dir.y;
    if (Math.abs(to) < 1e-4) {
      m.x = cx;
      m.y = cy;
      const next = decide(c, r);
      if (!next) return moved;
      m.dir = next;
      to = T;
    } else if (to < 0) {
      to += T;
    }
    const s = Math.min(dist, to);
    m.x += m.dir.x * s;
    m.y += m.dir.y * s;
    dist -= s;
    moved = true;
    // Tunnel
    if (m.x < -T / 2) m.x += MAZE_W;
    else if (m.x >= MAZE_W + T / 2) m.x -= MAZE_W;
  }
  return moved;
}

/** Geradlinig zu einem Punkt (erst waagrecht, dann senkrecht). Liefert true bei Ankunft. */
function approach(m: Mover, tx: number, ty: number, dist: number): boolean {
  if (m.x !== tx) {
    const d = tx - m.x;
    const s = Math.min(Math.abs(d), dist);
    m.x += Math.sign(d) * s;
    m.dir = d < 0 ? LEFT : RIGHT;
    dist -= s;
  }
  if (m.x === tx && dist > 0 && m.y !== ty) {
    const d = ty - m.y;
    m.y += Math.sign(d) * Math.min(Math.abs(d), dist);
    m.dir = d < 0 ? UP : DOWN;
  }
  return m.x === tx && m.y === ty;
}

export class MazeMuncherRound implements Round {
  score = 0;
  over = false;

  private level = 1;
  private lives = 3;
  private phase: Phase = 'ready';
  private phaseT = 0;
  private readyTime = 4;
  private clock = 0;
  private playT = 0;

  private maze = new Maze();
  private walls = renderWalls(C.BLUE, '#ff8ad8');
  private wallsFlash = renderWalls(C.WHITE, '#ff8ad8');

  private player: Mover = { x: START_X, y: START_Y, dir: LEFT };
  private want: Dir = LEFT;
  private mouthT = 0;
  private munchAlt = false;
  private dotsEaten = 0;

  private imps: Imp[] = [];
  private modeIdx = 0;
  private modeT = 0;
  private frightT = 0;
  private chain = 0;
  private siren: LoopHandle = DEAD_LOOP;
  private sirenKind = '';

  private fruit: { t: number } | null = null;
  private popups: Popup[] = [];
  private extraLifeGiven = false;

  constructor(private env: RoundEnv) {
    this.resetPositions();
    sfx.start(this.sound);
  }

  private get sound() {
    return this.env.audio;
  }

  private get mode(): 'scatter' | 'chase' {
    return this.modeIdx % 2 === 0 ? 'scatter' : 'chase';
  }

  private get speedFactor() {
    return 1 + Math.min(0.25, (this.level - 1) * 0.05);
  }

  update(dt: number): void {
    this.clock += dt;
    this.phaseT += dt;
    this.popups = this.popups.filter((p) => (p.t += dt) < p.life);

    switch (this.phase) {
      case 'ready':
        if (this.phaseT > this.readyTime) this.setPhase('play');
        break;
      case 'play':
        this.step(dt);
        break;
      case 'eat':
        if (this.phaseT > 0.6) this.setPhase('play');
        break;
      case 'dying':
        if (this.phaseT > 2.4 && !this.over) {
          this.lives--;
          if (this.lives <= 0) {
            this.over = true;
          } else {
            this.resetPositions();
            this.readyTime = 1.8;
            this.setPhase('ready');
          }
        }
        break;
      case 'cleared':
        if (this.phaseT > 2.2) {
          this.level++;
          this.maze = new Maze();
          this.dotsEaten = 0;
          this.resetPositions();
          this.readyTime = 2;
          this.setPhase('ready');
        }
        break;
    }
    this.updateSiren();
  }

  /** Hintergrund-Sirene: steigt, je leerer das Labyrinth wird; eigener Klang bei blauen Imps. */
  private updateSiren() {
    let kind = '';
    if (this.phase === 'play') {
      if (this.frightT > 0) kind = 'scared';
      else if (this.imps.some((m) => m.state === 'eyes' || m.state === 'entering')) kind = 'eyes';
      else kind = 'normal';
    }
    if (kind !== this.sirenKind || (kind && !this.siren.alive)) {
      this.siren.stop();
      this.sirenKind = kind;
      if (kind === 'scared') {
        this.siren = this.sound.loop({ type: 'square', freq: 190, vol: 0.03, lfo: { rate: 8, depth: 50 } });
      } else if (kind === 'eyes') {
        this.siren = this.sound.loop({ type: 'square', freq: 900, vol: 0.025, lfo: { rate: 14, depth: 250 } });
      } else if (kind === 'normal') {
        this.siren = this.sound.loop({ type: 'triangle', freq: 440, vol: 0.06, lfo: { rate: 2.5, depth: 70 } });
      }
    }
    if (kind === 'normal') {
      const progress = this.dotsEaten / (this.dotsEaten + this.maze.dotsLeft);
      this.siren.set(440 + progress * 220);
    }
  }

  // ---------- Ablauf ----------

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  private resetPositions() {
    this.player = { x: START_X, y: START_Y, dir: LEFT };
    this.want = LEFT;
    this.mouthT = 0;
    const releaseScale = Math.max(0.4, 1 - (this.level - 1) * 0.15);
    this.imps = IMP_STARTS.map((s, id) => ({
      id,
      x: s.x,
      y: s.y,
      dir: id === 0 ? LEFT : id % 2 ? UP : DOWN,
      state: id === 0 ? 'active' : 'house',
      scared: false,
      release: RELEASE_TIMES[id] * releaseScale,
    }));
    this.playT = 0;
    this.modeIdx = 0;
    this.modeT = 0;
    this.frightT = 0;
    this.fruit = null;
  }

  private step(dt: number) {
    this.playT += dt;

    if (this.frightT > 0) {
      this.frightT -= dt;
      if (this.frightT <= 0) for (const m of this.imps) m.scared = false;
    } else {
      this.modeT += dt;
      if (this.modeT >= MODE_SCHEDULE[this.modeIdx]) {
        this.modeT = 0;
        this.modeIdx++;
        this.reverseImps();
      }
    }

    this.updatePlayer(dt);
    if (this.phase !== 'play') return;
    for (const m of this.imps) this.updateImp(m, dt);
    this.checkCollisions();

    if (this.fruit && (this.fruit.t += dt) > 9.5) this.fruit = null;
  }

  private addScore(n: number) {
    this.score += n;
    if (!this.extraLifeGiven && this.score >= EXTRA_LIFE_AT) {
      this.extraLifeGiven = true;
      this.lives++;
      sfx.extraLife(this.sound);
    }
  }

  // ---------- Spieler ----------

  private updatePlayer(dt: number) {
    const input = this.env.input;
    if (input.pressed('up')) this.want = UP;
    if (input.pressed('down')) this.want = DOWN;
    if (input.pressed('left')) this.want = LEFT;
    if (input.pressed('right')) this.want = RIGHT;

    const p = this.player;
    // Umdrehen geht jederzeit, auch mitten im Gang
    if (opposite(this.want, p.dir)) p.dir = this.want;

    const speed = 66 * this.speedFactor;
    const moved = advance(p, speed * dt, (c, r) => {
      if (!this.maze.blocked(c + this.want.x, r + this.want.y)) return this.want;
      if (!this.maze.blocked(c + p.dir.x, r + p.dir.y)) return p.dir;
      return null;
    });
    if (moved) this.mouthT += dt;

    const ch = this.maze.eat(Math.floor(p.x / T), Math.floor(p.y / T));
    if (!ch) return;
    this.dotsEaten++;
    if (ch === 'o') {
      this.addScore(50);
      this.frighten();
    } else {
      this.addScore(10);
      sfx.munch(this.sound, (this.munchAlt = !this.munchAlt));
    }
    if (FRUIT_AT_DOTS.includes(this.dotsEaten)) this.fruit = { t: 0 };
    if (this.maze.dotsLeft === 0) {
      this.fruit = null;
      sfx.levelClear(this.sound);
      this.setPhase('cleared');
    }
  }

  private frighten() {
    this.frightT = Math.max(1.5, 6 - (this.level - 1) * 0.8);
    this.chain = 0;
    sfx.power(this.sound);
    for (const m of this.imps) {
      if (m.state === 'eyes' || m.state === 'entering') continue;
      if (m.state === 'active') m.dir = { x: -m.dir.x, y: -m.dir.y };
      m.scared = true;
    }
  }

  private checkCollisions() {
    const p = this.player;
    for (const m of this.imps) {
      if (m.state !== 'active' && m.state !== 'leaving') continue;
      const dx = m.x - p.x;
      const dy = m.y - p.y;
      if (dx * dx + dy * dy >= 36) continue;
      if (m.scared) {
        const pts = 200 << this.chain;
        this.chain = Math.min(this.chain + 1, 3);
        this.addScore(pts);
        m.state = 'eyes';
        m.scared = false;
        this.popups.push({ x: m.x, y: m.y - 3, text: String(pts), t: 0, life: 1, color: C.CYAN });
        sfx.eatImp(this.sound);
        this.setPhase('eat');
      } else {
        this.fruit = null;
        sfx.death(this.sound);
        this.setPhase('dying');
      }
      return;
    }

    if (this.fruit) {
      const dx = START_X - p.x;
      const dy = FRUIT_Y - p.y;
      if (dx * dx + dy * dy < 36) {
        const pts = fruitPoints(this.level);
        this.addScore(pts);
        this.popups.push({ x: START_X, y: FRUIT_Y - 3, text: String(pts), t: 0, life: 1.5, color: C.MAGENTA });
        sfx.fruit(this.sound);
        this.fruit = null;
      }
    }
  }

  // ---------- Geister ----------

  private reverseImps() {
    for (const m of this.imps) if (m.state === 'active') m.dir = { x: -m.dir.x, y: -m.dir.y };
  }

  private updateImp(m: Imp, dt: number) {
    switch (m.state) {
      case 'house':
        m.y += m.dir.y * 30 * dt;
        if (m.y < HOUSE_Y - 4) m.dir = DOWN;
        if (m.y > HOUSE_Y + 4) m.dir = UP;
        if (this.playT >= m.release) m.state = 'leaving';
        break;
      case 'leaving':
        if (approach(m, DOOR_X, ABOVE_DOOR_Y, 40 * dt)) {
          m.state = 'active';
          m.dir = Math.random() < 0.5 ? LEFT : RIGHT;
        }
        break;
      case 'entering':
        if (approach(m, DOOR_X, HOUSE_Y, 130 * dt)) {
          m.state = 'leaving';
          m.scared = false;
        }
        break;
      case 'active':
      case 'eyes': {
        const inTunnel = Math.floor(m.y / T) === TUNNEL_ROW && (m.x < 6 * T || m.x > 22 * T);
        let speed = 62 * this.speedFactor;
        if (m.state === 'eyes') speed = 130;
        else if (inTunnel) speed = 32;
        else if (m.scared) speed = 38;
        advance(m, speed * dt, (c, r) => this.chooseDir(m, c, r));
        break;
      }
    }
  }

  private chooseDir(m: Imp, c: number, r: number): Dir | null {
    if (m.state === 'eyes' && r === 11 && (c === 13 || c === 14)) {
      m.state = 'entering';
      return null;
    }
    const back = { x: -m.dir.x, y: -m.dir.y };
    const options = DIRS.filter((d) => !opposite(d, m.dir) && !this.maze.blocked(c + d.x, r + d.y));
    if (!options.length) return back;
    if (m.state === 'active' && (m.scared || (m.id === 2 && this.mode === 'chase'))) {
      return options[Math.floor(Math.random() * options.length)];
    }
    const [tx, ty] = this.target(m);
    let best = options[0];
    let bestD = Infinity;
    for (const d of options) {
      const dd = (c + d.x - tx) ** 2 + (r + d.y - ty) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    return best;
  }

  private target(m: Imp): [number, number] {
    if (m.state === 'eyes') return [13, 11];
    if (this.mode === 'scatter') return SCATTER[m.id];
    const p = this.player;
    const pc = Math.floor(p.x / T);
    const pr = Math.floor(p.y / T);
    switch (m.id) {
      case 1: // schneidet den Weg ab: zielt 4 Felder vor den Spieler
        return [pc + p.dir.x * 4, pr + p.dir.y * 4];
      case 3: {
        // scheu: jagt nur aus der Ferne, flieht in seine Ecke, wenn es eng wird
        const dc = Math.floor(m.x / T) - pc;
        const dr = Math.floor(m.y / T) - pr;
        return dc * dc + dr * dr > 64 ? [pc, pr] : SCATTER[3];
      }
      default: // jagt direkt
        return [pc, pr];
    }
  }

  // ---------- Darstellung ----------

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = C.BLACK;
    g.fillRect(0, 0, W, H);

    const flash = this.phase === 'cleared' && Math.floor(this.phaseT * 4) % 2 === 1;
    g.drawImage(flash ? this.wallsFlash : this.walls, OX, OY);
    this.maze.drawDots(g, OX, OY, this.phase !== 'play' || this.clock % 0.5 < 0.3);

    g.save();
    g.beginPath();
    g.rect(OX, OY, MAZE_W, MAZE_H);
    g.clip();

    if (this.fruit) {
      const s = FRUITS[fruitIndex(this.level)];
      g.drawImage(s, OX + START_X - 5, OY + FRUIT_Y - 5);
    }

    const hideImps = (this.phase === 'dying' && this.phaseT > 0.6) || this.phase === 'cleared';
    if (!hideImps) for (const m of this.imps) this.drawImp(g, m);

    const p = this.player;
    const px = OX + Math.round(p.x);
    const py = OY + Math.round(p.y);
    if (this.phase === 'dying') {
      const mouth = this.phaseT < 0.6 ? 0.2 : 0.2 + ((this.phaseT - 0.6) / 1.2) * Math.PI;
      if (mouth < Math.PI) drawMuncher(g, px, py, 0, -1, mouth);
    } else if (this.phase !== 'eat') {
      const mouth = this.phase === 'ready' ? 0.5 : Math.abs(Math.sin(this.mouthT * 18)) * 0.85;
      drawMuncher(g, px, py, p.dir.x, p.dir.y, mouth);
    }

    for (const pop of this.popups) {
      drawText(g, pop.text, OX + pop.x, OY + pop.y, { color: pop.color, align: 'center' });
    }
    g.restore();

    if (this.phase === 'ready') {
      drawText(g, 'READY!', OX + START_X, OY + FRUIT_Y - 3, { color: C.YELLOW, align: 'center' });
    }

    this.renderHud(g);
  }

  private drawImp(g: CanvasRenderingContext2D, m: Imp) {
    const sx = OX + Math.round(m.x) - 7;
    const sy = OY + Math.round(m.y) - 7;
    const frame = Math.floor(this.clock * 6) % 2;

    if (m.state === 'eyes' || m.state === 'entering') {
      this.drawEyes(g, sx, sy, m.dir);
      return;
    }
    if (m.scared) {
      const flashing = this.frightT < 2 && Math.floor(this.clock * 5) % 2 === 0;
      g.drawImage((flashing ? IMP_SCARED_FLASH : IMP_SCARED)[frame], sx, sy);
      g.fillStyle = flashing ? C.RED : '#ffd0b0';
      g.fillRect(sx + 4, sy + 5, 2, 2);
      g.fillRect(sx + 8, sy + 5, 2, 2);
      for (let x = 2; x <= 11; x++) g.fillRect(sx + x, sy + 9 + (x % 2), 1, 1);
      return;
    }
    g.drawImage(IMPS[m.id][frame], sx, sy);
    this.drawEyes(g, sx, sy, m.dir);
  }

  private drawEyes(g: CanvasRenderingContext2D, sx: number, sy: number, d: Dir) {
    g.fillStyle = C.WHITE;
    g.fillRect(sx + 2, sy + 4, 4, 4);
    g.fillRect(sx + 8, sy + 4, 4, 4);
    g.fillStyle = '#1a2aa0';
    g.fillRect(sx + 3 + d.x, sy + 5 + d.y, 2, 2);
    g.fillRect(sx + 9 + d.x, sy + 5 + d.y, 2, 2);
  }

  private renderHud(g: CanvasRenderingContext2D) {
    const L = OX / 2;
    const R = W - OX / 2;
    drawText(g, 'MAZE MUNCHER', W / 2, 8, { color: C.YELLOW, align: 'center', glow: true });

    drawText(g, 'SCORE', L, 30, { color: C.DIM, align: 'center' });
    drawText(g, String(this.score), L, 42, { scale: 2, color: C.WHITE, align: 'center' });
    drawText(g, 'HIGH', L, 74, { color: C.DIM, align: 'center' });
    drawText(g, String(Math.max(this.env.hiScore, this.score)), L, 86, { scale: 2, color: C.YELLOW, align: 'center' });
    drawText(g, 'ESC = HALL', L, H - 14, { color: '#3e3566', align: 'center' });

    drawText(g, 'LIVES', R, 30, { color: C.DIM, align: 'center' });
    const n = Math.min(this.lives, 4);
    for (let i = 0; i < n; i++) drawMuncher(g, R - (n - 1) * 8 + i * 16, 50, -1, 0, 0.6);
    drawText(g, 'LEVEL', R, 74, { color: C.DIM, align: 'center' });
    drawText(g, String(this.level), R, 86, { scale: 2, color: C.CYAN, align: 'center' });
    const first = Math.max(1, this.level - 3);
    const count = this.level - first + 1;
    for (let i = 0; i < count; i++) {
      g.drawImage(FRUITS[fruitIndex(first + i)], R - (count * 14) / 2 + i * 14 + 2, 112);
    }
  }
}
