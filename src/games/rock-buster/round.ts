import { line } from '../../engine/draw';
import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import type { Round, RoundEnv } from '../../engine/shell';
import { DEAD_LOOP, type LoopHandle, type Sound } from '../../engine/sound';
import { SCREEN_H as H, SCREEN_W as W } from '../../engine/types';

const TURN_SPEED = 4.2;
const THRUST = 190;
const DRAG = 0.55;
const MAX_SPEED = 230;
const SHIP_R = 6;
const BULLET_SPEED = 330;
const BULLET_LIFE = 0.9;
const MAX_BULLETS = 5;
const FIRE_DELAY = 0.2;
const ROCK_R = [22, 12, 6];
const ROCK_POINTS = [20, 50, 100];
const EXTRA_LIFE_EVERY = 10000;

/** Asteroiden-Umriss: Punkte im Einheitskreis mit zufälligem Radius. */
function rockShape(): [number, number][] {
  const n = 11;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const r = 0.72 + Math.random() * 0.32;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
}

export const SHIP_SHAPE: [number, number][] = [
  [8, 0],
  [-6, -5],
  [-3, 0],
  [-6, 5],
];

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Rock extends Body {
  size: number;
  shape: [number, number][];
  rot: number;
  spin: number;
}

interface Bullet extends Body {
  life: number;
  enemy: boolean;
}

interface Saucer extends Body {
  small: boolean;
  fireT: number;
  turnT: number;
}

interface Spark extends Body {
  life: number;
  color: string;
}

type Phase = 'ready' | 'play' | 'dead' | 'wave';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const wrap = (v: number, max: number) => ((v % max) + max) % max;
const pad = (n: number) => String(n).padStart(6, '0');

/** Kürzester Abstand auf dem "umlaufenden" Bildschirm. */
function wrapDist(a: Body, b: Body): number {
  let dx = Math.abs(a.x - b.x);
  let dy = Math.abs(a.y - b.y);
  dx = Math.min(dx, W - dx);
  dy = Math.min(dy, H - dy);
  return Math.hypot(dx, dy);
}

const sfx = {
  fire(s: Sound) {
    s.tone({ freq: 1400, to: 500, dur: 0.1, type: 'square', vol: 0.08, jitter: 0.05 });
  },
  boom(s: Sound, size: number) {
    s.noise({ dur: [0.6, 0.4, 0.25][size], freq: [1200, 2200, 3500][size], to: 80, vol: [0.5, 0.4, 0.3][size] });
  },
  beat(s: Sound, high: boolean) {
    s.tone({ freq: high ? 160 : 130, to: 45, dur: 0.14, type: 'sine', vol: 0.55 });
  },
  shipBoom(s: Sound) {
    s.noise({ dur: 1.2, freq: 1500, to: 60, vol: 0.6 });
    s.tone({ freq: 220, to: 40, dur: 1, type: 'sawtooth', vol: 0.2 });
  },
  warp(s: Sound) {
    s.tone({ freq: 200, to: 1600, dur: 0.25, type: 'sine', vol: 0.2 });
  },
  saucerShot(s: Sound) {
    s.tone({ freq: 900, to: 300, dur: 0.12, type: 'sawtooth', vol: 0.07 });
  },
  extraLife(s: Sound) {
    s.seq([[784, 0.08], [988, 0.08], [1175, 0.08], [1568, 0.2]], { type: 'square', vol: 0.15 });
  },
};

export class RockBusterRound implements Round {
  score = 0;
  over = false;

  private wave = 1;
  private lives = 3;
  private phase: Phase = 'ready';
  private phaseT = 0;
  private clock = 0;

  private ship: Body & { a: number } = { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2 };
  private thrusting = false;
  private invulnT = 0;
  private fireT = 0;
  private warpT = 0;

  private rocks: Rock[] = [];
  private bullets: Bullet[] = [];
  private saucer: Saucer | null = null;
  private saucerT = 20;
  private sparks: Spark[] = [];
  private debris: { x: number; y: number; vx: number; vy: number; a: number; spin: number; len: number }[] = [];

  private beatT = 1;
  private beatHigh = false;
  private nextLife = EXTRA_LIFE_EVERY;
  private thrustHum: LoopHandle = DEAD_LOOP;
  private saucerHum: LoopHandle = DEAD_LOOP;
  private stars = Array.from({ length: 40 }, () => ({ x: rand(0, W) | 0, y: rand(0, H) | 0 }));

  constructor(private env: RoundEnv) {
    this.spawnWave();
  }

  private get sound() {
    return this.env.audio;
  }

  update(dt: number): void {
    this.clock += dt;
    this.phaseT += dt;
    this.updateEffects(dt);
    this.moveRocks(dt);

    switch (this.phase) {
      case 'ready':
        // Erst starten, wenn die Mitte frei ist
        if (this.phaseT > 1.5 && this.centerIsSafe()) {
          this.invulnT = 2;
          this.setPhase('play');
        }
        break;
      case 'play':
        this.updateShip(dt);
        this.updateBullets(dt);
        this.updateSaucer(dt);
        if (this.phase !== 'play') break;
        this.checkCollisions();
        if (this.phase === 'play' && this.rocks.length === 0 && !this.saucer) {
          this.setPhase('wave');
        }
        this.heartbeat(dt);
        break;
      case 'dead':
        this.updateBullets(dt);
        if (this.phaseT > 2.2) {
          if (this.lives <= 0) this.over = true;
          else this.resetShip();
        }
        break;
      case 'wave':
        this.updateShip(dt);
        this.updateBullets(dt);
        if (this.phaseT > 2) {
          this.wave++;
          this.spawnWave();
          this.setPhase('play');
        }
        break;
    }
    this.updateLoops();
  }

  // ---------- Ablauf ----------

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  private spawnWave() {
    const count = Math.min(11, 3 + this.wave);
    for (let i = 0; i < count; i++) {
      // Am Rand erscheinen, weg vom Schiff
      const edge = Math.random() < 0.5;
      const x = edge ? rand(0, W) : Math.random() < 0.5 ? 0 : W - 1;
      const y = edge ? (Math.random() < 0.5 ? 0 : H - 1) : rand(0, H);
      this.addRock(x, y, 0);
    }
    this.saucerT = rand(18, 26);
  }

  private addRock(x: number, y: number, size: number) {
    const speed = rand(20, 45) * (1 + size * 0.45) * (1 + (this.wave - 1) * 0.06);
    const a = rand(0, Math.PI * 2);
    this.rocks.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, size, shape: rockShape(), rot: rand(0, 6), spin: rand(-1.2, 1.2) });
  }

  private resetShip() {
    this.ship = { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2 };
    this.bullets = this.bullets.filter((b) => b.enemy);
    this.setPhase('ready');
  }

  private centerIsSafe() {
    const c = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    return this.rocks.every((r) => wrapDist(r, c) > ROCK_R[r.size] + 50) && !this.saucer;
  }

  private addScore(n: number) {
    this.score += n;
    if (this.score >= this.nextLife) {
      this.nextLife += EXTRA_LIFE_EVERY;
      this.lives++;
      sfx.extraLife(this.sound);
    }
  }

  // ---------- Schiff ----------

  private updateShip(dt: number) {
    const input = this.env.input;
    const s = this.ship;
    const turn = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    s.a += turn * TURN_SPEED * dt;

    this.thrusting = input.held('up');
    if (this.thrusting) {
      s.vx += Math.cos(s.a) * THRUST * dt;
      s.vy += Math.sin(s.a) * THRUST * dt;
    }
    const drag = Math.max(0, 1 - DRAG * dt);
    s.vx *= drag;
    s.vy *= drag;
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > MAX_SPEED) {
      s.vx *= MAX_SPEED / sp;
      s.vy *= MAX_SPEED / sp;
    }
    s.x = wrap(s.x + s.vx * dt, W);
    s.y = wrap(s.y + s.vy * dt, H);
    this.invulnT = Math.max(0, this.invulnT - dt);

    this.fireT -= dt;
    const own = this.bullets.filter((b) => !b.enemy).length;
    if (input.held('a') && this.fireT <= 0 && own < MAX_BULLETS) {
      this.fireT = FIRE_DELAY;
      this.bullets.push({
        x: s.x + Math.cos(s.a) * 8,
        y: s.y + Math.sin(s.a) * 8,
        vx: s.vx + Math.cos(s.a) * BULLET_SPEED,
        vy: s.vy + Math.sin(s.a) * BULLET_SPEED,
        life: BULLET_LIFE,
        enemy: false,
      });
      sfx.fire(this.sound);
    }

    // Hyperraum: Sprung an eine freie Stelle, kurz unverwundbar
    this.warpT -= dt;
    if (input.pressed('b') && this.warpT <= 0) {
      this.warpT = 2;
      for (let i = 0; i < 20; i++) {
        s.x = rand(20, W - 20);
        s.y = rand(30, H - 20);
        if (this.rocks.every((r) => wrapDist(r, s) > ROCK_R[r.size] + 30)) break;
      }
      s.vx = 0;
      s.vy = 0;
      this.invulnT = Math.max(this.invulnT, 1);
      sfx.warp(this.sound);
    }
  }

  private updateBullets(dt: number) {
    for (const b of this.bullets) {
      b.x = wrap(b.x + b.vx * dt, W);
      b.y = wrap(b.y + b.vy * dt, H);
      b.life -= dt;
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  // ---------- Asteroiden und UFO ----------

  private moveRocks(dt: number) {
    for (const r of this.rocks) {
      r.x = wrap(r.x + r.vx * dt, W);
      r.y = wrap(r.y + r.vy * dt, H);
      r.rot += r.spin * dt;
    }
  }

  private updateSaucer(dt: number) {
    if (!this.saucer) {
      this.saucerT -= dt;
      if (this.saucerT <= 0 && this.wave >= 2) {
        const fromLeft = Math.random() < 0.5;
        // Das kleine UFO zielt – es kommt erst später und häufiger, je höher die Punktzahl
        const small = this.score > 8000 ? Math.random() < 0.6 : Math.random() < 0.2;
        this.saucer = { x: fromLeft ? 0 : W - 1, y: rand(40, H - 40), vx: (fromLeft ? 1 : -1) * (small ? 75 : 55), vy: 0, small, fireT: 1, turnT: 1.5 };
      }
      return;
    }
    const u = this.saucer;
    u.x += u.vx * dt;
    u.y = wrap(u.y + u.vy * dt, H);
    u.turnT -= dt;
    if (u.turnT <= 0) {
      u.turnT = rand(1, 2);
      u.vy = [-40, 0, 40][Math.floor(Math.random() * 3)];
    }
    u.fireT -= dt;
    if (u.fireT <= 0) {
      u.fireT = u.small ? 1 : 1.4;
      let a = rand(0, Math.PI * 2);
      if (u.small && this.phase === 'play') {
        a = Math.atan2(this.ship.y - u.y, this.ship.x - u.x) + rand(-0.15, 0.15);
      }
      this.bullets.push({ x: u.x, y: u.y, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, life: 1.2, enemy: true });
      sfx.saucerShot(this.sound);
    }
    if (u.x < -20 || u.x > W + 20) {
      this.saucer = null;
      this.saucerT = rand(15, 22);
    }
  }

  // ---------- Kollisionen ----------

  private checkCollisions() {
    const s = this.ship;

    for (const b of [...this.bullets]) {
      if (b.enemy) continue;
      const hit = this.rocks.find((r) => wrapDist(r, b) < ROCK_R[r.size]);
      if (hit) {
        this.bullets.splice(this.bullets.indexOf(b), 1);
        this.breakRock(hit);
        continue;
      }
      if (this.saucer && wrapDist(this.saucer, b) < (this.saucer.small ? 6 : 10)) {
        this.bullets.splice(this.bullets.indexOf(b), 1);
        this.addScore(this.saucer.small ? 1000 : 200);
        this.burst(this.saucer.x, this.saucer.y, C.RED, 20);
        sfx.boom(this.sound, 1);
        this.saucer = null;
        this.saucerT = rand(15, 22);
      }
    }

    // UFO-Schüsse und UFO selbst zerstören auch Asteroiden
    for (const b of [...this.bullets]) {
      if (!b.enemy) continue;
      const hit = this.rocks.find((r) => wrapDist(r, b) < ROCK_R[r.size]);
      if (hit) {
        this.bullets.splice(this.bullets.indexOf(b), 1);
        this.breakRock(hit, false);
      }
    }

    if (this.invulnT > 0) return;
    const crash = this.rocks.find((r) => wrapDist(r, s) < ROCK_R[r.size] * 0.85 + SHIP_R);
    if (crash) {
      this.breakRock(crash);
      this.killShip();
      return;
    }
    if (this.bullets.some((b) => b.enemy && wrapDist(b, s) < SHIP_R)) {
      this.killShip();
      return;
    }
    if (this.saucer && wrapDist(this.saucer, s) < SHIP_R + 9) {
      this.burst(this.saucer.x, this.saucer.y, C.RED, 20);
      this.saucer = null;
      this.saucerT = rand(15, 22);
      this.killShip();
    }
  }

  private breakRock(r: Rock, scored = true) {
    this.rocks.splice(this.rocks.indexOf(r), 1);
    if (scored) this.addScore(ROCK_POINTS[r.size]);
    this.burst(r.x, r.y, C.ORANGE, 8 + (2 - r.size) * 6);
    sfx.boom(this.sound, r.size);
    if (r.size < 2) {
      this.addRock(r.x, r.y, r.size + 1);
      this.addRock(r.x, r.y, r.size + 1);
    }
  }

  private killShip() {
    const s = this.ship;
    this.lives--;
    sfx.shipBoom(this.sound);
    this.burst(s.x, s.y, C.CYAN, 24);
    // Das Schiff zerfällt in seine Linien
    for (let i = 0; i < SHIP_SHAPE.length; i++) {
      const a = rand(0, Math.PI * 2);
      this.debris.push({ x: s.x, y: s.y, vx: Math.cos(a) * rand(15, 40) + s.vx * 0.3, vy: Math.sin(a) * rand(15, 40) + s.vy * 0.3, a: rand(0, 6), spin: rand(-3, 3), len: rand(5, 9) });
    }
    this.setPhase('dead');
  }

  private burst(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(20, 110);
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.3, 0.9), color });
    }
  }

  private updateEffects(dt: number) {
    for (const p of this.sparks) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.sparks = this.sparks.filter((p) => p.life > 0);
    for (const d of this.debris) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.a += d.spin * dt;
    }
    if (this.phase !== 'dead') this.debris = [];
  }

  // ---------- Klang ----------

  /** Der typische Herzschlag: zwei tiefe Töne, schneller je weniger Felsen übrig sind. */
  private heartbeat(dt: number) {
    this.beatT -= dt;
    if (this.beatT > 0) return;
    this.beatT = Math.max(0.28, 0.25 + this.rocks.length * 0.07);
    this.beatHigh = !this.beatHigh;
    sfx.beat(this.sound, this.beatHigh);
  }

  private updateLoops() {
    const thrust = this.thrusting && (this.phase === 'play' || this.phase === 'wave');
    if (thrust && !this.thrustHum.alive) this.thrustHum = this.sound.loop({ noise: true, freq: 500, vol: 0.12 });
    else if (!thrust && this.thrustHum.alive) this.thrustHum.stop();

    const ufo = !!this.saucer && this.phase === 'play';
    if (ufo && !this.saucerHum.alive) {
      const small = this.saucer!.small;
      this.saucerHum = this.sound.loop({ type: 'square', freq: small ? 900 : 600, vol: 0.03, lfo: { rate: small ? 10 : 6, depth: 80 } });
    } else if (!ufo && this.saucerHum.alive) {
      this.saucerHum.stop();
    }
  }

  // ---------- Darstellung ----------

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#03020a';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#2a2648';
    for (const s of this.stars) g.fillRect(s.x, s.y, 1, 1);

    for (const r of this.rocks) {
      const rad = ROCK_R[r.size];
      this.drawShape(g, r.shape, r.x, r.y, r.rot, rad, r.size === 0 ? C.ORANGE : r.size === 1 ? '#ffb86a' : '#ffd8a8');
    }

    if (this.saucer) this.drawSaucer(g, this.saucer);

    for (const b of this.bullets) {
      g.fillStyle = b.enemy ? C.RED : C.WHITE;
      g.fillRect(Math.round(b.x) - (b.enemy ? 1 : 0), Math.round(b.y) - (b.enemy ? 1 : 0), b.enemy ? 2 : 2, 2);
    }

    const s = this.ship;
    const showShip = this.phase === 'play' || this.phase === 'wave' || (this.phase === 'ready' && this.phaseT > 1.5);
    if (showShip && !(this.invulnT > 0 && this.clock % 0.2 < 0.08)) {
      this.drawShape(g, SHIP_SHAPE, s.x, s.y, s.a, 1, C.CYAN);
      if (this.thrusting && this.clock % 0.1 < 0.06) {
        this.drawShape(g, [[-4, -2.5], [-10, 0], [-4, 2.5]], s.x, s.y, s.a, 1, C.YELLOW, false);
      }
    }

    for (const d of this.debris) {
      const cx = Math.cos(d.a) * d.len * 0.5;
      const cy = Math.sin(d.a) * d.len * 0.5;
      line(g, d.x - cx, d.y - cy, d.x + cx, d.y + cy, C.CYAN);
    }
    for (const p of this.sparks) {
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }

    drawText(g, pad(this.score), 8, 6, { color: C.WHITE, scale: 2 });
    drawText(g, `HI ${pad(Math.max(this.env.hiScore, this.score))}`, W / 2, 6, { color: C.YELLOW, align: 'center' });
    for (let i = 0; i < Math.min(this.lives, 8); i++) {
      this.drawShape(g, SHIP_SHAPE, W - 12 - i * 14, 13, -Math.PI / 2, 0.9, C.CYAN);
    }
    drawText(g, `WAVE ${this.wave}`, W / 2, 16, { color: C.DIM, align: 'center' });
    drawText(g, 'ESC = HALL', W - 8, H - 12, { color: '#3e3566', align: 'right' });

    if (this.phase === 'wave') this.message(g, `WAVE ${this.wave} CLEAR!`, C.GREEN, `NEXT: WAVE ${this.wave + 1}`);
    else if (this.phase === 'ready' && this.phaseT < 1.5) this.message(g, `WAVE ${this.wave}`, C.CYAN, 'GET READY');
  }

  /** Umriss zeichnen – auch mehrfach, wenn er über den Bildrand ragt (Wrap). */
  private drawShape(g: CanvasRenderingContext2D, shape: [number, number][], x: number, y: number, a: number, scale: number, color: string, closed = true) {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const pts = shape.map(([px, py]) => [px * scale * ca - py * scale * sa, px * scale * sa + py * scale * ca]);
    const reach = Math.max(...pts.map(([px, py]) => Math.hypot(px, py)));
    const offsets: [number, number][] = [[0, 0]];
    if (x < reach) offsets.push([W, 0]);
    if (x > W - reach) offsets.push([-W, 0]);
    if (y < reach) offsets.push([0, H]);
    if (y > H - reach) offsets.push([0, -H]);
    for (const [ox, oy] of offsets) {
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        line(g, x + ox + p[0], y + oy + p[1], x + ox + q[0], y + oy + q[1], color);
      }
    }
  }

  private drawSaucer(g: CanvasRenderingContext2D, u: Saucer) {
    const k = u.small ? 0.6 : 1;
    const shape: [number, number][] = [[-10, 0], [-4, -4], [4, -4], [10, 0], [4, 4], [-4, 4]];
    this.drawShape(g, shape, u.x, u.y, 0, k, C.RED);
    line(g, u.x - 10 * k, u.y, u.x + 10 * k, u.y, C.RED);
    this.drawShape(g, [[-3, -4], [-2, -7], [2, -7], [3, -4]], u.x, u.y, 0, k, C.RED, false);
  }

  private message(g: CanvasRenderingContext2D, text: string, color: string, sub: string) {
    drawText(g, text, W / 2, 96, { scale: 2, color, align: 'center', glow: true });
    drawText(g, sub, W / 2, 116, { color: C.YELLOW, align: 'center' });
  }
}
