import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import type { Round, RoundEnv } from '../../engine/shell';
import { SCREEN_H as H, SCREEN_W as W } from '../../engine/types';
import { sfx } from './sfx';

const LEFT = 16;
const RIGHT = W - 16;
const TOP = 22;
const COLS = 12;
const BRICK_W = 28;
const BRICK_H = 8;
const BRICK_X0 = LEFT + Math.floor((RIGHT - LEFT - COLS * (BRICK_W + 1)) / 2) + 1;
const BRICK_Y0 = 44;
const PADDLE_Y = 262;
const PADDLE_H = 6;
const PADDLE_W = 40;
const WIDE_W = 62;
const PADDLE_SPEED = 230;
const BALL = 3;
const MAX_BOUNCE = (60 * Math.PI) / 180;
const EXTRA_LIFE_AT = 10000;

export const ROW_COLORS = [C.RED, C.ORANGE, C.YELLOW, C.GREEN, C.CYAN, C.BLUE, C.MAGENTA, '#b04dff'];
const HARD_COLOR = '#c8c4dc';
const STEEL_COLOR = '#6a6488';

/**
 * Eigene Levels: Ziffer = Farbe/Reihe (Punkte), H = harter Stein (2 Treffer), S = Stahl (unzerstörbar), . = leer.
 */
const LEVELS = [
  ['000000000000', '111111111111', '222222222222', '333333333333', '444444444444', '555555555555'],
  ['.....00.....', '....1111....', '...222222...', '..33333333..', '.4444444444.', '555555555555', 'HHHHHHHHHHHH'],
  ['0.0.0.0.0.0.', '.1.1.1.1.1.1', '2.2.2.2.2.2.', '.3.3.3.3.3.3', 'SS..SSSS..SS', '444444444444', '.5.5.5.5.5.5'],
  ['HHH......HHH', 'H00H....H00H', 'H11H....H11H', 'HHHH.SS.HHHH', '....2222....', '...333333...', '..44444444..', '.5555555555.'],
  ['S0000000000S', 'S1HHHHHHHH1S', 'S1222222221S', 'S1233333321S', 'S1234444321S', 'S1HHHHHHHH1S', 'S5555555555S', '............', '..66....66..'],
];

type PowerKind = 'wide' | 'multi' | 'slow' | 'life';
const POWER_INFO: Record<PowerKind, { letter: string; color: string }> = {
  wide: { letter: 'W', color: C.CYAN },
  multi: { letter: 'M', color: C.MAGENTA },
  slow: { letter: 'S', color: C.GREEN },
  life: { letter: 'L', color: C.RED },
};
export const POWER_LIST = Object.entries(POWER_INFO) as [PowerKind, { letter: string; color: string }][];

interface Brick {
  x: number;
  y: number;
  row: number;
  kind: 'normal' | 'hard' | 'steel';
  hits: number;
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  trail: { x: number; y: number }[];
}

interface Capsule {
  x: number;
  y: number;
  kind: PowerKind;
}

type Phase = 'serve' | 'play' | 'lost' | 'clear';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pad = (n: number) => String(n).padStart(6, '0');

export class BrickBlasterRound implements Round {
  score = 0;
  over = false;

  private level = 1;
  private lives = 3;
  private phase: Phase = 'serve';
  private phaseT = 0;
  private clock = 0;

  private px = W / 2;
  private wideT = 0;
  private bricks: Brick[] = [];
  private balls: Ball[] = [];
  private capsules: Capsule[] = [];
  private hits = 0;
  private extraLifeGiven = false;
  private popups: { x: number; y: number; text: string; t: number }[] = [];

  constructor(private env: RoundEnv) {
    this.setupLevel();
  }

  private get sound() {
    return this.env.audio;
  }

  private get paddleW() {
    return this.wideT > 0 ? WIDE_W : PADDLE_W;
  }

  /** Grundtempo des Balls; steigt mit Level und Anzahl der Treffer. */
  private get baseSpeed() {
    return Math.min(330, 170 + (this.level - 1) * 14 + Math.floor(this.hits / 10) * 8);
  }

  update(dt: number): void {
    this.clock += dt;
    this.phaseT += dt;
    this.popups = this.popups.filter((p) => (p.t += dt) < 1);
    this.wideT = Math.max(0, this.wideT - dt);

    switch (this.phase) {
      case 'serve':
        this.movePaddle(dt);
        this.balls[0].x = this.px;
        this.balls[0].y = PADDLE_Y - BALL - 1;
        // Leertaste startet; nach 3 Sekunden startet der Ball von selbst
        if (this.env.input.pressed('a') || this.env.input.held('a') || this.phaseT > 3) this.launch();
        break;
      case 'play':
        this.movePaddle(dt);
        this.moveBalls(dt);
        if (this.phase !== 'play') break;
        this.moveCapsules(dt);
        break;
      case 'lost':
        if (this.phaseT > 1.2) {
          if (this.lives <= 0) this.over = true;
          else this.serve();
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

  private setupLevel() {
    const layout = LEVELS[(this.level - 1) % LEVELS.length];
    this.bricks = [];
    layout.forEach((line, r) => {
      for (let c = 0; c < COLS; c++) {
        const ch = line[c];
        if (!ch || ch === '.') continue;
        const x = BRICK_X0 + c * (BRICK_W + 1);
        const y = BRICK_Y0 + r * (BRICK_H + 1);
        if (ch === 'H') this.bricks.push({ x, y, row: r, kind: 'hard', hits: 2 });
        else if (ch === 'S') this.bricks.push({ x, y, row: r, kind: 'steel', hits: Infinity });
        else this.bricks.push({ x, y, row: Number(ch), kind: 'normal', hits: 1 });
      }
    });
    this.capsules = [];
    this.wideT = 0;
    this.hits = 0;
    this.serve();
  }

  private serve() {
    this.balls = [{ x: this.px, y: PADDLE_Y - BALL - 1, vx: 0, vy: 0, trail: [] }];
    this.setPhase('serve');
  }

  private launch() {
    const a = rand(-0.35, 0.35);
    const v = this.baseSpeed;
    this.balls[0].vx = Math.sin(a) * v;
    this.balls[0].vy = -Math.cos(a) * v;
    this.setPhase('play');
  }

  private addScore(n: number) {
    this.score += n;
    if (!this.extraLifeGiven && this.score >= EXTRA_LIFE_AT) {
      this.extraLifeGiven = true;
      this.lives++;
      sfx.extraLife(this.sound);
    }
  }

  // ---------- Schläger und Bälle ----------

  private movePaddle(dt: number) {
    const input = this.env.input;
    const dx = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    const half = this.paddleW / 2;
    this.px = Math.max(LEFT + half, Math.min(RIGHT - half, this.px + dx * PADDLE_SPEED * dt));
  }

  private moveBalls(dt: number) {
    for (const b of this.balls) {
      b.trail.unshift({ x: b.x, y: b.y });
      b.trail.length = Math.min(b.trail.length, 4);
      // In kleinen Schritten bewegen, damit der Ball nicht durch Steine tunnelt
      const dist = Math.hypot(b.vx, b.vy) * dt;
      const steps = Math.max(1, Math.ceil(dist / 2));
      for (let i = 0; i < steps; i++) this.stepBall(b, dt / steps);
    }

    const before = this.balls.length;
    this.balls = this.balls.filter((b) => b.y < H + 4);
    if (this.balls.length === 0 && before > 0) {
      this.lives--;
      this.capsules = [];
      this.wideT = 0;
      sfx.lose(this.sound);
      this.setPhase('lost');
      return;
    }

    if (!this.bricks.some((b) => b.kind !== 'steel')) {
      sfx.levelClear(this.sound);
      this.addScore(1000 * this.level);
      this.setPhase('clear');
    }
  }

  private stepBall(b: Ball, dt: number) {
    const ox = b.x;
    const oy = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // Wände
    if (b.x - BALL / 2 < LEFT) {
      b.x = LEFT + BALL / 2;
      b.vx = Math.abs(b.vx);
      sfx.wall(this.sound);
    } else if (b.x + BALL / 2 > RIGHT) {
      b.x = RIGHT - BALL / 2;
      b.vx = -Math.abs(b.vx);
      sfx.wall(this.sound);
    }
    if (b.y - BALL / 2 < TOP) {
      b.y = TOP + BALL / 2;
      b.vy = Math.abs(b.vy);
      sfx.wall(this.sound);
    }

    // Schläger: Abprallwinkel hängt von der Trefferstelle ab
    const half = this.paddleW / 2;
    if (b.vy > 0 && b.y + BALL / 2 >= PADDLE_Y && oy + BALL / 2 <= PADDLE_Y + 2 && Math.abs(b.x - this.px) <= half + 1) {
      const offset = Math.max(-1, Math.min(1, (b.x - this.px) / half));
      const v = Math.max(this.baseSpeed, Math.hypot(b.vx, b.vy) * 0.98);
      b.vx = Math.sin(offset * MAX_BOUNCE) * v;
      b.vy = -Math.cos(offset * MAX_BOUNCE) * v;
      b.y = PADDLE_Y - BALL / 2;
      sfx.paddle(this.sound);
      return;
    }

    // Steine
    for (let i = 0; i < this.bricks.length; i++) {
      const k = this.bricks[i];
      if (b.x + BALL / 2 < k.x || b.x - BALL / 2 > k.x + BRICK_W || b.y + BALL / 2 < k.y || b.y - BALL / 2 > k.y + BRICK_H) continue;
      // Seite bestimmen: Lag der Ball vorher schon im waagrechten Bereich, kam er von oben/unten
      const wasInX = ox + BALL / 2 >= k.x && ox - BALL / 2 <= k.x + BRICK_W;
      if (wasInX) {
        b.vy = -b.vy;
        b.y = oy;
      } else {
        b.vx = -b.vx;
        b.x = ox;
      }
      this.hitBrick(i);
      return;
    }
  }

  private hitBrick(i: number) {
    const k = this.bricks[i];
    if (k.kind === 'steel') {
      sfx.steel(this.sound);
      return;
    }
    k.hits--;
    this.hits++;
    if (k.hits > 0) {
      sfx.hard(this.sound);
      return;
    }
    this.bricks.splice(i, 1);
    const pts = k.kind === 'hard' ? 100 : (8 - Math.min(k.row, 7)) * 10;
    this.addScore(pts);
    sfx.brick(this.sound, k.row);
    if (Math.random() < 0.13) {
      const roll = Math.random();
      const kind: PowerKind = roll < 0.06 ? 'life' : roll < 0.4 ? 'wide' : roll < 0.7 ? 'multi' : 'slow';
      this.capsules.push({ x: k.x + BRICK_W / 2, y: k.y + BRICK_H / 2, kind });
    }
  }

  // ---------- Power-ups ----------

  private moveCapsules(dt: number) {
    const half = this.paddleW / 2;
    this.capsules = this.capsules.filter((c) => {
      c.y += 60 * dt;
      if (c.y + 4 >= PADDLE_Y && c.y - 4 <= PADDLE_Y + PADDLE_H && Math.abs(c.x - this.px) <= half + 7) {
        this.collect(c);
        return false;
      }
      return c.y < H + 8;
    });
  }

  private collect(c: Capsule) {
    sfx.powerup(this.sound);
    this.addScore(50);
    const label = { wide: 'WIDE PADDLE', multi: 'MULTI BALL', slow: 'SLOW BALL', life: 'EXTRA LIFE' }[c.kind];
    this.popups.push({ x: c.x, y: PADDLE_Y - 16, text: label, t: 0 });
    switch (c.kind) {
      case 'wide':
        this.wideT = 15;
        break;
      case 'life':
        this.lives++;
        break;
      case 'slow':
        for (const b of this.balls) {
          const f = this.baseSpeed / Math.hypot(b.vx, b.vy);
          b.vx *= f;
          b.vy *= f;
        }
        this.hits = Math.max(0, this.hits - 20);
        break;
      case 'multi': {
        const src = this.balls[0];
        if (!src) break;
        const v = Math.hypot(src.vx, src.vy);
        for (const a of [-0.5, 0.5]) {
          const ang = Math.atan2(src.vx, -src.vy) + a;
          this.balls.push({ x: src.x, y: src.y, vx: Math.sin(ang) * v, vy: -Math.abs(Math.cos(ang) * v), trail: [] });
        }
        break;
      }
    }
  }

  // ---------- Darstellung ----------

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#05030c';
    g.fillRect(0, 0, W, H);

    // Rahmen
    g.fillStyle = '#2c2148';
    g.fillRect(LEFT - 4, TOP - 4, 4, H - TOP + 4);
    g.fillRect(RIGHT, TOP - 4, 4, H - TOP + 4);
    g.fillRect(LEFT - 4, TOP - 4, RIGHT - LEFT + 8, 4);
    g.fillStyle = C.alpha(C.ORANGE, 0.6);
    g.fillRect(LEFT - 1, TOP - 1, 1, H - TOP + 1);
    g.fillRect(RIGHT, TOP - 1, 1, H - TOP + 1);
    g.fillRect(LEFT - 1, TOP - 1, RIGHT - LEFT + 2, 1);

    drawText(g, `SCORE ${pad(this.score)}`, LEFT, 6, { color: C.WHITE });
    drawText(g, `HI ${pad(Math.max(this.env.hiScore, this.score))}`, W / 2, 6, { color: C.YELLOW, align: 'center' });
    drawText(g, `LEVEL ${this.level}`, RIGHT, 6, { color: C.CYAN, align: 'right' });

    for (const k of this.bricks) {
      const color = k.kind === 'steel' ? STEEL_COLOR : k.kind === 'hard' ? (k.hits > 1 ? HARD_COLOR : '#8a86a8') : ROW_COLORS[k.row % ROW_COLORS.length];
      g.fillStyle = color;
      g.fillRect(k.x, k.y, BRICK_W, BRICK_H);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(k.x, k.y, BRICK_W, 1);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(k.x, k.y + BRICK_H - 1, BRICK_W, 1);
      if (k.kind === 'steel') {
        g.fillStyle = '#4a4466';
        g.fillRect(k.x + 3, k.y + 3, 2, 2);
        g.fillRect(k.x + BRICK_W - 5, k.y + 3, 2, 2);
      }
    }

    for (const c of this.capsules) {
      const info = POWER_INFO[c.kind];
      g.fillStyle = info.color;
      g.fillRect(Math.round(c.x - 7), Math.round(c.y - 4), 14, 9);
      drawText(g, info.letter, c.x, c.y - 3, { color: C.BLACK, align: 'center' });
    }

    // Schläger
    const pw = this.paddleW;
    const px = Math.round(this.px - pw / 2);
    const wideEnding = this.wideT > 0 && this.wideT < 2 && this.clock % 0.3 < 0.15;
    g.fillStyle = wideEnding ? C.WHITE : C.ORANGE;
    g.fillRect(px, PADDLE_Y, pw, PADDLE_H);
    g.fillStyle = C.YELLOW;
    g.fillRect(px + 2, PADDLE_Y, pw - 4, 2);
    g.fillStyle = C.RED;
    g.fillRect(px, PADDLE_Y, 3, PADDLE_H);
    g.fillRect(px + pw - 3, PADDLE_Y, 3, PADDLE_H);

    for (const b of this.balls) {
      b.trail.forEach((p, i) => {
        g.fillStyle = C.alpha(C.CYAN, 0.35 - i * 0.08);
        g.fillRect(Math.round(p.x - 1), Math.round(p.y - 1), BALL, BALL);
      });
      g.fillStyle = C.WHITE;
      g.fillRect(Math.round(b.x - 1), Math.round(b.y - 1), BALL, BALL);
    }

    for (const p of this.popups) drawText(g, p.text, p.x, p.y - p.t * 10, { color: C.YELLOW, align: 'center' });

    // Leben unten links
    for (let i = 0; i < Math.min(this.lives, 6); i++) {
      g.fillStyle = C.ORANGE;
      g.fillRect(LEFT + 2 + i * 14, H - 8, 10, 3);
    }
    drawText(g, 'ESC = HALL', RIGHT - 2, H - 10, { color: '#3e3566', align: 'right' });

    if (this.phase === 'serve') {
      this.message(g, `LEVEL ${this.level}`, C.CYAN, 'PRESS SPACE TO LAUNCH');
    } else if (this.phase === 'clear') {
      this.message(g, 'LEVEL CLEAR!', C.GREEN, `BONUS ${1000 * this.level}`);
    }
  }

  private message(g: CanvasRenderingContext2D, text: string, color: string, sub: string) {
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(LEFT, 176, RIGHT - LEFT, 36);
    drawText(g, text, W / 2, 180, { scale: 2, color, align: 'center', glow: true });
    drawText(g, sub, W / 2, 200, { color: C.YELLOW, align: 'center' });
  }
}
