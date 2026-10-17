import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import type { Round, RoundEnv } from '../../engine/shell';
import type { Sound } from '../../engine/sound';
import { SCREEN_H as H, SCREEN_W as W } from '../../engine/types';

const TOP = 26;
const BOTTOM = H - 14;
const PADDLE_W = 5;
const PADDLE_H = 34;
const PLAYER_X = 18;
const CPU_X = W - 18 - PADDLE_W;
const PLAYER_SPEED = 230;
const BALL = 5;
const MAX_ANGLE = (50 * Math.PI) / 180;
const WIN_POINTS = 7;

/** Die vier Gegner – jeder etwas schneller und genauer. */
export const OPPONENTS = [
  { name: 'ROOKIE', speed: 120, error: 22, delay: 0.22 },
  { name: 'CHALLENGER', speed: 155, error: 15, delay: 0.16 },
  { name: 'PRO', speed: 190, error: 10, delay: 0.11 },
  { name: 'CHAMPION', speed: 230, error: 6, delay: 0.07 },
];

type Phase = 'serve' | 'play' | 'point' | 'match';

const sfx = {
  paddle(s: Sound) {
    s.tone({ freq: 460, dur: 0.05, type: 'square', vol: 0.2 });
  },
  wall(s: Sound) {
    s.tone({ freq: 230, dur: 0.04, type: 'square', vol: 0.15 });
  },
  scored(s: Sound) {
    s.tone({ freq: 700, dur: 0.25, type: 'square', vol: 0.18 });
  },
  conceded(s: Sound) {
    s.tone({ freq: 180, dur: 0.35, type: 'square', vol: 0.18 });
  },
  matchWon(s: Sound) {
    s.seq([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.15], [784, 0.08], [1047, 0.35]], { type: 'square', vol: 0.15 });
  },
};

export class PaddleDuelRound implements Round {
  score = 0;
  over = false;

  private match = 1;
  private phase: Phase = 'serve';
  private phaseT = 0;
  private clock = 0;

  private py = (TOP + BOTTOM) / 2;
  private cy = (TOP + BOTTOM) / 2;
  private ball = { x: W / 2, y: (TOP + BOTTOM) / 2, vx: 0, vy: 0 };
  private rally = 0;
  private playerPts = 0;
  private cpuPts = 0;
  private serveToPlayer = true;
  private cpuTarget = (TOP + BOTTOM) / 2;
  private cpuThinkT = 0;
  private lastWinner: 'player' | 'cpu' = 'player';

  constructor(private env: RoundEnv) {}

  private get sound() {
    return this.env.audio;
  }

  private get cpu() {
    return OPPONENTS[Math.min(this.match - 1, OPPONENTS.length - 1)];
  }

  update(dt: number): void {
    this.clock += dt;
    this.phaseT += dt;
    this.movePlayer(dt);
    this.moveCpu(dt);

    switch (this.phase) {
      case 'serve':
        this.ball.x = W / 2;
        this.ball.y = (TOP + BOTTOM) / 2 + Math.sin(this.clock * 2) * 40;
        if (this.phaseT > (this.playerPts + this.cpuPts === 0 ? 2 : 1)) this.serve();
        break;
      case 'play':
        this.moveBall(dt);
        break;
      case 'point':
        if (this.phaseT > 1) this.setPhase('serve');
        break;
      case 'match':
        if (this.phaseT > 3) {
          if (this.lastWinner === 'cpu') {
            this.over = true;
          } else {
            this.match++;
            this.playerPts = 0;
            this.cpuPts = 0;
            this.setPhase('serve');
          }
        }
        break;
    }
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  private serve() {
    const a = (Math.random() * 2 - 1) * 0.5;
    const v = 170 + (this.match - 1) * 12;
    const dir = this.serveToPlayer ? -1 : 1;
    this.ball.vx = Math.cos(a) * v * dir;
    this.ball.vy = Math.sin(a) * v;
    this.rally = 0;
    this.setPhase('play');
  }

  private movePlayer(dt: number) {
    const input = this.env.input;
    const dy = (input.held('down') ? 1 : 0) - (input.held('up') ? 1 : 0);
    this.py = Math.max(TOP + PADDLE_H / 2, Math.min(BOTTOM - PADDLE_H / 2, this.py + dy * PLAYER_SPEED * dt));
  }

  /** Der Computer schaut mit kurzer Verzögerung hin und zielt nicht ganz genau. */
  private moveCpu(dt: number) {
    const cpu = this.cpu;
    this.cpuThinkT -= dt;
    if (this.cpuThinkT <= 0) {
      this.cpuThinkT = cpu.delay;
      if (this.phase === 'play' && this.ball.vx > 0) {
        this.cpuTarget = this.predictY() + (Math.random() * 2 - 1) * cpu.error;
      } else {
        this.cpuTarget = (TOP + BOTTOM) / 2;
      }
    }
    const d = this.cpuTarget - this.cy;
    const step = Math.min(Math.abs(d), cpu.speed * dt);
    this.cy = Math.max(TOP + PADDLE_H / 2, Math.min(BOTTOM - PADDLE_H / 2, this.cy + Math.sign(d) * step));
  }

  /** Wo kommt der Ball auf der Computer-Seite an (mit Bande)? */
  private predictY(): number {
    const b = this.ball;
    const t = (CPU_X - b.x) / b.vx;
    let y = b.y + b.vy * t;
    const lo = TOP + BALL / 2;
    const hi = BOTTOM - BALL / 2;
    const span = hi - lo;
    y -= lo;
    y = ((y % (2 * span)) + 2 * span) % (2 * span);
    if (y > span) y = 2 * span - y;
    return y + lo;
  }

  private moveBall(dt: number) {
    const b = this.ball;
    const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 3));
    for (let i = 0; i < steps; i++) {
      b.x += (b.vx * dt) / steps;
      b.y += (b.vy * dt) / steps;
      if (b.y - BALL / 2 < TOP) {
        b.y = TOP + BALL / 2;
        b.vy = Math.abs(b.vy);
        sfx.wall(this.sound);
      } else if (b.y + BALL / 2 > BOTTOM) {
        b.y = BOTTOM - BALL / 2;
        b.vy = -Math.abs(b.vy);
        sfx.wall(this.sound);
      }
      if (b.vx < 0 && b.x - BALL / 2 <= PLAYER_X + PADDLE_W && b.x > PLAYER_X && Math.abs(b.y - this.py) <= PADDLE_H / 2 + BALL / 2) {
        this.bounce(this.py, 1);
        this.score += 10;
      }
      if (b.vx > 0 && b.x + BALL / 2 >= CPU_X && b.x < CPU_X + PADDLE_W && Math.abs(b.y - this.cy) <= PADDLE_H / 2 + BALL / 2) {
        this.bounce(this.cy, -1);
      }
      if (b.x < -10) return this.point('cpu');
      if (b.x > W + 10) return this.point('player');
    }
  }

  private bounce(paddleY: number, dir: number) {
    const b = this.ball;
    const offset = Math.max(-1, Math.min(1, (b.y - paddleY) / (PADDLE_H / 2)));
    this.rally++;
    const v = Math.min(430, Math.hypot(b.vx, b.vy) + 12);
    b.vx = Math.cos(offset * MAX_ANGLE) * v * dir;
    b.vy = Math.sin(offset * MAX_ANGLE) * v;
    b.x = dir > 0 ? PLAYER_X + PADDLE_W + BALL / 2 : CPU_X - BALL / 2;
    sfx.paddle(this.sound);
  }

  private point(winner: 'player' | 'cpu') {
    if (winner === 'player') {
      this.playerPts++;
      this.score += 100 * this.match + this.rally * 5;
      sfx.scored(this.sound);
    } else {
      this.cpuPts++;
      sfx.conceded(this.sound);
    }
    this.serveToPlayer = winner === 'player';
    this.lastWinner = winner;
    if (this.playerPts >= WIN_POINTS || this.cpuPts >= WIN_POINTS) {
      if (winner === 'player') {
        this.score += 1000 * this.match;
        sfx.matchWon(this.sound);
      }
      this.setPhase('match');
    } else {
      this.setPhase('point');
    }
  }

  // ---------- Darstellung ----------

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#04030a';
    g.fillRect(0, 0, W, H);

    g.fillStyle = C.WHITE;
    g.fillRect(0, TOP - 3, W, 3);
    g.fillRect(0, BOTTOM, W, 3);
    for (let y = TOP + 4; y < BOTTOM; y += 12) g.fillRect(W / 2 - 1, y, 2, 6);

    drawText(g, String(this.playerPts), W / 2 - 40, TOP + 10, { scale: 6, color: C.alpha(C.CYAN, 0.8), align: 'center' });
    drawText(g, String(this.cpuPts), W / 2 + 40, TOP + 10, { scale: 6, color: C.alpha(C.MAGENTA, 0.8), align: 'center' });

    drawText(g, `SCORE ${String(this.score).padStart(6, '0')}`, 8, 6, { color: C.WHITE });
    drawText(g, `MATCH ${this.match}: VS ${this.cpu.name}`, W / 2, 6, { color: C.YELLOW, align: 'center' });
    drawText(g, `HI ${String(Math.max(this.env.hiScore, this.score)).padStart(6, '0')}`, W - 8, 6, { color: C.DIM, align: 'right' });

    g.fillStyle = C.CYAN;
    g.fillRect(PLAYER_X, Math.round(this.py - PADDLE_H / 2), PADDLE_W, PADDLE_H);
    g.fillStyle = C.MAGENTA;
    g.fillRect(CPU_X, Math.round(this.cy - PADDLE_H / 2), PADDLE_W, PADDLE_H);

    const b = this.ball;
    if (this.phase !== 'point' || this.clock % 0.2 < 0.1) {
      g.fillStyle = C.WHITE;
      g.fillRect(Math.round(b.x - BALL / 2), Math.round(b.y - BALL / 2), BALL, BALL);
    }

    drawText(g, 'YOU', PLAYER_X, BOTTOM + 5, { color: C.CYAN });
    drawText(g, 'CPU', CPU_X + PADDLE_W, BOTTOM + 5, { color: C.MAGENTA, align: 'right' });
    drawText(g, `FIRST TO ${WIN_POINTS} WINS`, W / 2, BOTTOM + 5, { color: '#3e3566', align: 'center' });

    if (this.phase === 'match') {
      const won = this.lastWinner === 'player';
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillRect(0, 118, W, 46);
      drawText(g, won ? 'MATCH WON!' : 'MATCH LOST', W / 2, 124, { scale: 3, color: won ? C.GREEN : C.RED, align: 'center', glow: true });
      if (won) drawText(g, `NEXT: ${OPPONENTS[Math.min(this.match, OPPONENTS.length - 1)].name}`, W / 2, 150, { color: C.YELLOW, align: 'center' });
    } else if (this.phase === 'serve' && this.playerPts + this.cpuPts === 0) {
      drawText(g, `MATCH ${this.match}`, W / 2, 150, { scale: 2, color: C.CYAN, align: 'center', glow: true });
      drawText(g, `VS ${this.cpu.name}`, W / 2, 170, { color: C.YELLOW, align: 'center' });
    }
  }
}
