import { fillCircle, line } from '../../engine/draw';
import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import type { Round, RoundEnv } from '../../engine/shell';
import { DEAD_LOOP, type LoopHandle } from '../../engine/sound';
import { SCREEN_H as H, SCREEN_W as W } from '../../engine/types';
import { LEFT_BOX, RADAR, renderCockpit, RIGHT_BOX } from './cockpit';
import { CX, CY, drawModel, FIGHTER, FOCAL, makeRock, type Model, project } from './models';
import { sfx } from './sfx';

/** Ab hier gilt ein Objekt als "beim Schiff angekommen". */
const ZHIT = 20;
const SPAWN_Z = 1000;
const SHIP_R = 7;
const BOUND_X = 70;
const BOUND_Y = 45;
const BOLT_SPEED = 1100;
const BOLT_CONVERGE = 450;
const FIRE_DELAY = 0.16;
const FIGHTER_R = 14;
const PLANET_COLORS = ['#c86a3d', '#3d8ac8', '#a03dc8', '#3dc87a'];

type Phase = 'ready' | 'play' | 'clear' | 'dead';

interface Rock {
  x: number;
  y: number;
  z: number;
  r: number;
  hp: number;
  model: Model;
  yaw: number;
  pitch: number;
  spinY: number;
  spinP: number;
  flash: number;
}

interface Fighter {
  x: number;
  y: number;
  z: number;
  bx: number;
  by: number;
  t: number;
  phase: 'in' | 'hold' | 'out';
  holdZ: number;
  holdT: number;
  fireT: number;
  ax: number;
  ay: number;
  fx: number;
  roll: number;
}

interface Plasma {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** Laserzaun: sperrt eine Bildhälfte (0 links, 1 rechts, 2 oben, 3 unten). */
interface Gate {
  z: number;
  side: number;
}

interface Bolt {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  life: number;
  color: string;
}

interface Boom {
  x: number;
  y: number;
  z: number;
  t: number;
  size: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const GATE_HINTS = ['GO RIGHT →', '← GO LEFT', 'GO DOWN ↓', 'GO UP ↑'];

export class StarRunRound implements Round {
  score = 0;
  over = false;

  private sector = 1;
  private phase: Phase = 'ready';
  private phaseT = 0;
  private clock = 0;
  private sectorT = 0;

  private shield = 100;
  private bombs = 2;
  private cam = { x: 0, y: 0 };
  private vx = 0;
  private vy = 0;
  private fireT = 0;
  private gun = 1;

  private rocks: Rock[] = [];
  private fighters: Fighter[] = [];
  private plasmas: Plasma[] = [];
  private gates: Gate[] = [];
  private bolts: Bolt[] = [];
  private particles: Particle[] = [];
  private booms: Boom[] = [];
  private stars = Array.from({ length: 140 }, () => ({ x: rand(-500, 500), y: rand(-400, 400), z: rand(20, 1000) }));

  private rockT = 1;
  private fighterT = 4;
  private gateT = 6;
  private hurtT = 0;
  private bombFlash = 0;
  private warnT = 0;
  private lowBeepT = 0;
  private bonus = 0;

  private cockpit = renderCockpit();
  private rumble: LoopHandle = DEAD_LOOP;
  private engine: LoopHandle = DEAD_LOOP;

  constructor(private env: RoundEnv) {}

  private get sound() {
    return this.env.audio;
  }

  private get speed() {
    return 260 + (this.sector - 1) * 25;
  }

  private get sectorLength() {
    return Math.min(75, 45 + (this.sector - 1) * 5);
  }

  update(dt: number): void {
    this.clock += dt;
    this.phaseT += dt;
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.bombFlash = Math.max(0, this.bombFlash - dt);
    this.updateStars(dt);
    this.updateEffects(dt);

    switch (this.phase) {
      case 'ready':
        this.updateShip(dt);
        if (this.phaseT > 2.5) this.setPhase('play');
        break;
      case 'play':
        this.updateShip(dt);
        this.updateWeapons(dt);
        this.spawn(dt);
        this.updateObjects(dt);
        if (this.phase !== 'play') break;
        this.updateBolts(dt);
        this.checkSectorEnd();
        if (this.shield < 30) {
          this.lowBeepT -= dt;
          if (this.lowBeepT <= 0) {
            sfx.shieldLow(this.sound);
            this.lowBeepT = 1.2;
          }
        }
        break;
      case 'clear':
        this.updateShip(dt);
        if (this.phaseT > 4) {
          this.sector++;
          this.sectorT = 0;
          this.rockT = 1;
          this.fighterT = 3;
          this.gateT = 5;
          this.setPhase('ready');
        }
        break;
      case 'dead':
        if (this.phaseT > 2.6) this.over = true;
        break;
    }
    this.updateEngineSound();
  }

  /** Triebwerksbrummen, das beim Lenken anschwillt. */
  private updateEngineSound() {
    if (this.phase === 'dead') {
      this.rumble.stop();
      this.engine.stop();
      return;
    }
    if (!this.rumble.alive) this.rumble = this.sound.loop({ noise: true, freq: 260, vol: 0.07 });
    if (!this.engine.alive) this.engine = this.sound.loop({ type: 'sawtooth', freq: 55, vol: 0.025, lfo: { rate: 0.4, depth: 3 } });
    const boost = Math.min(1, Math.hypot(this.vx, this.vy) / 160);
    this.rumble.set(240 + this.sector * 20 + boost * 260, 0.07 + boost * 0.03);
    this.engine.set(55 + boost * 14);
  }

  // ---------- Ablauf ----------

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  private damage(n: number) {
    if (this.phase === 'dead') return;
    this.shield = Math.max(0, this.shield - n);
    this.hurtT = 0.4;
    sfx.hurt(this.sound);
    if (this.shield === 0) {
      sfx.shipDown(this.sound);
      this.burst(this.cam.x, this.cam.y, 60, C.ORANGE, 40, 200);
      this.burst(this.cam.x, this.cam.y, 80, C.YELLOW, 30, 150);
      this.setPhase('dead');
    }
  }

  private checkSectorEnd() {
    if (this.sectorT < this.sectorLength) return;
    if (this.rocks.length || this.fighters.length || this.plasmas.length || this.gates.length) return;
    this.bonus = 500 * this.sector + this.shield * 10;
    this.score += this.bonus;
    this.shield = Math.min(100, this.shield + 25);
    this.bombs = Math.min(3, this.bombs + 1);
    sfx.sectorClear(this.sound);
    this.setPhase('clear');
  }

  // ---------- Schiff und Waffen ----------

  private updateShip(dt: number) {
    const input = this.env.input;
    const ix = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    const iy = (input.held('down') ? 1 : 0) - (input.held('up') ? 1 : 0);
    const k = Math.min(1, dt * 6);
    this.vx += (ix * 130 - this.vx) * k;
    this.vy += (iy * 100 - this.vy) * k;
    this.cam.x = clamp(this.cam.x + this.vx * dt, -BOUND_X, BOUND_X);
    this.cam.y = clamp(this.cam.y + this.vy * dt, -BOUND_Y, BOUND_Y);
  }

  private updateWeapons(dt: number) {
    const input = this.env.input;
    this.fireT -= dt;
    if (input.held('a') && this.fireT <= 0) {
      this.fireT = FIRE_DELAY;
      this.gun = -this.gun;
      const gx = this.gun * 12;
      const gy = 9;
      const t = (BOLT_CONVERGE - 8) / BOLT_SPEED;
      this.bolts.push({ x: this.cam.x + gx, y: this.cam.y + gy, z: 8, vx: -gx / t, vy: -gy / t });
      sfx.laser(this.sound);
    }

    if (input.pressed('b') && this.bombs > 0) {
      this.bombs--;
      this.bombFlash = 0.8;
      sfx.bomb(this.sound);
      for (const r of this.rocks) {
        this.score += r.r > 15 ? 150 : 50;
        this.burst(r.x, r.y, r.z, C.ORANGE, 10, 90);
      }
      for (const f of this.fighters) {
        this.score += 150;
        this.burst(f.x, f.y, f.z, C.MAGENTA, 14, 110);
      }
      this.rocks = [];
      this.fighters = [];
      this.plasmas = [];
    }
  }

  private updateBolts(dt: number) {
    this.bolts = this.bolts.filter((b) => {
      const z0 = b.z;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += BOLT_SPEED * dt;
      return b.z <= SPAWN_Z + 100 && !this.boltHits(b, z0);
    });
  }

  /** Prüft Treffer zwischen alter und neuer Position des Schusses. */
  private boltHits(b: Bolt, z0: number): boolean {
    const near = (x: number, y: number, z: number, r: number) =>
      z >= z0 - r && z <= b.z + r && (x - b.x) ** 2 + (y - b.y) ** 2 < (r + 2) ** 2;

    for (let i = 0; i < this.fighters.length; i++) {
      const f = this.fighters[i];
      if (!near(f.x, f.y, f.z, FIGHTER_R)) continue;
      this.fighters.splice(i, 1);
      this.score += 150;
      this.burst(f.x, f.y, f.z, C.MAGENTA, 18, 120);
      this.booms.push({ x: f.x, y: f.y, z: f.z, t: 0, size: 20 });
      sfx.explode(this.sound);
      return true;
    }
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i];
      if (!near(r.x, r.y, r.z, r.r)) continue;
      r.hp--;
      r.flash = 0.08;
      if (r.hp <= 0) {
        this.rocks.splice(i, 1);
        const big = r.r > 15;
        this.score += big ? 150 : 50;
        this.burst(r.x, r.y, r.z, big ? C.ORANGE : '#d8a060', big ? 24 : 12, big ? 140 : 90);
        this.booms.push({ x: r.x, y: r.y, z: r.z, t: 0, size: r.r * 1.5 });
        sfx.explode(this.sound, big);
      } else {
        sfx.hitRock(this.sound);
      }
      return true;
    }
    for (let i = 0; i < this.plasmas.length; i++) {
      const p = this.plasmas[i];
      if (!near(p.x, p.y, p.z, 6)) continue;
      this.plasmas.splice(i, 1);
      this.score += 10;
      this.burst(p.x, p.y, p.z, C.GREEN, 6, 60);
      sfx.hitRock(this.sound);
      return true;
    }
    for (const gt of this.gates) {
      if (gt.z >= z0 && gt.z <= b.z && this.inGate(gt.side, b.x, b.y, 0)) {
        this.burst(b.x, b.y, gt.z, C.YELLOW, 4, 40);
        return true;
      }
    }
    return false;
  }

  private inGate(side: number, x: number, y: number, margin: number): boolean {
    switch (side) {
      case 0:
        return x < margin;
      case 1:
        return x > -margin;
      case 2:
        return y < margin;
      default:
        return y > -margin;
    }
  }

  // ---------- Gegner und Hindernisse ----------

  private spawn(dt: number) {
    this.sectorT += dt;
    if (this.sectorT >= this.sectorLength) return;
    const s = this.sector;

    this.rockT -= dt;
    if (this.rockT <= 0) {
      this.rockT = Math.max(0.4, 1.3 - 0.12 * (s - 1)) * rand(0.7, 1.3);
      const big = Math.random() < Math.min(0.5, 0.15 + 0.07 * s);
      const aimed = Math.random() < 0.4;
      const r = big ? 22 : 10;
      this.rocks.push({
        x: aimed ? this.cam.x + rand(-12, 12) : rand(-110, 110),
        y: aimed ? this.cam.y + rand(-10, 10) : rand(-75, 75),
        z: SPAWN_Z,
        r,
        hp: big ? 4 : 1,
        model: makeRock(r),
        yaw: rand(0, 6),
        pitch: rand(0, 6),
        spinY: rand(-1.5, 1.5),
        spinP: rand(-1, 1),
        flash: 0,
      });
    }

    this.fighterT -= dt;
    if (this.fighterT <= 0) {
      this.fighterT = Math.max(3, 8 - 0.8 * (s - 1)) * rand(0.8, 1.2);
      const count = 1 + Math.floor(Math.random() * Math.min(3, s));
      for (let i = 0; i < count; i++) {
        const bx = rand(-80, 80);
        const by = rand(-50, 40);
        this.fighters.push({
          x: bx,
          y: by,
          z: SPAWN_Z + i * 60,
          bx,
          by,
          t: rand(0, 6),
          phase: 'in',
          holdZ: rand(280, 450),
          holdT: rand(4, 6),
          fireT: rand(1, 2),
          ax: rand(20, 50),
          ay: rand(10, 25),
          fx: rand(0.8, 1.6),
          roll: 0,
        });
      }
    }

    if (s >= 2) {
      this.gateT -= dt;
      if (this.gateT <= 0) {
        this.gateT = Math.max(5, 11 - (s - 2)) * rand(0.8, 1.2);
        this.gates.push({ z: SPAWN_Z, side: Math.floor(Math.random() * 4) });
      }
    }
  }

  private updateObjects(dt: number) {
    const S = this.speed;
    const cam = this.cam;
    const hitsShip = (x: number, y: number, r: number) => (x - cam.x) ** 2 + (y - cam.y) ** 2 < (r + SHIP_R) ** 2;

    for (const r of this.rocks) {
      r.z -= S * dt;
      r.yaw += r.spinY * dt;
      r.pitch += r.spinP * dt;
      r.flash = Math.max(0, r.flash - dt);
    }
    this.rocks = this.rocks.filter((r) => {
      if (r.z > ZHIT) return true;
      if (hitsShip(r.x, r.y, r.r)) {
        this.burst(r.x, r.y, 30, C.ORANGE, 10, 100);
        this.damage(r.r > 15 ? 30 : 15);
      }
      return false;
    });
    if (this.phase !== 'play') return;

    const plasmaSpeed = 280 + this.sector * 15;
    const fireScale = Math.max(0.5, 1 - 0.08 * (this.sector - 1));
    for (const f of this.fighters) {
      f.t += dt;
      if (f.phase === 'in') {
        f.z -= 320 * dt;
        if (f.z <= f.holdZ) f.phase = 'hold';
      } else if (f.phase === 'hold') {
        f.holdT -= dt;
        f.fireT -= dt;
        if (f.fireT <= 0) {
          f.fireT = rand(1.6, 2.8) * fireScale;
          const dx = cam.x - f.x;
          const dy = cam.y - f.y;
          const dz = -f.z;
          const len = Math.hypot(dx, dy, dz);
          this.plasmas.push({
            x: f.x,
            y: f.y,
            z: f.z,
            vx: (dx / len) * plasmaSpeed,
            vy: (dy / len) * plasmaSpeed,
            vz: (dz / len) * plasmaSpeed,
          });
          sfx.plasma(this.sound);
        }
        if (f.holdT <= 0) f.phase = 'out';
      } else {
        f.z -= 450 * dt;
      }
      f.x = f.bx + f.ax * Math.sin(f.t * f.fx);
      f.y = f.by + f.ay * Math.sin(f.t * f.fx * 1.3);
      f.roll = -Math.cos(f.t * f.fx) * f.ax * f.fx * 0.012;
    }
    this.fighters = this.fighters.filter((f) => {
      if (f.z > ZHIT) return true;
      if (hitsShip(f.x, f.y, 12)) this.damage(25);
      return false;
    });
    if (this.phase !== 'play') return;

    for (const p of this.plasmas) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
    this.plasmas = this.plasmas.filter((p) => {
      if (p.z > ZHIT) return true;
      if (hitsShip(p.x, p.y, 4)) this.damage(10);
      return false;
    });
    if (this.phase !== 'play') return;

    for (const gt of this.gates) gt.z -= S * dt;
    this.gates = this.gates.filter((gt) => {
      if (gt.z > ZHIT) return true;
      if (this.inGate(gt.side, cam.x, cam.y, SHIP_R)) this.damage(25);
      return false;
    });

    this.warnT -= dt;
    if (this.gates.some((gt) => gt.z < 800) && this.warnT <= 0) {
      sfx.warn(this.sound);
      this.warnT = 0.4;
    }
  }

  // ---------- Effekte ----------

  private burst(x: number, y: number, z: number, color: string, n: number, speed: number) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const b = rand(-1, 1);
      const v = rand(speed * 0.3, speed);
      const c = Math.sqrt(1 - b * b);
      this.particles.push({
        x,
        y,
        z,
        vx: Math.cos(a) * c * v,
        vy: b * v,
        vz: Math.sin(a) * c * v,
        t: 0,
        life: rand(0.5, 1),
        color,
      });
    }
  }

  private updateEffects(dt: number) {
    const drift = this.phase === 'dead' ? 0 : this.speed * 0.3;
    for (const p of this.particles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += (p.vz - drift) * dt;
    }
    this.particles = this.particles.filter((p) => p.t < p.life && p.z > 4);
    for (const b of this.booms) b.t += dt;
    this.booms = this.booms.filter((b) => b.t < 0.3);
  }

  private updateStars(dt: number) {
    const v = this.phase === 'dead' ? 40 : this.speed * 1.6;
    for (const s of this.stars) {
      s.z -= v * dt;
      if (s.z < 20) {
        s.z += 980;
        s.x = rand(-500, 500);
        s.y = rand(-400, 400);
      }
    }
  }

  // ---------- Darstellung ----------

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#02010a';
    g.fillRect(0, 0, W, H);

    let sx = 0;
    let sy = 0;
    if (this.hurtT > 0 || (this.phase === 'dead' && this.phaseT < 1.5)) {
      sx = Math.round(rand(-3, 3));
      sy = Math.round(rand(-2, 2));
    }
    g.save();
    g.translate(sx, sy);

    this.drawPlanet(g);
    this.drawStars(g);
    for (const gt of [...this.gates].sort((a, b) => b.z - a.z)) this.drawGate(g, gt);

    type Item = { z: number; draw: () => void };
    const items: Item[] = [
      ...this.rocks.map((r) => ({ z: r.z, draw: () => this.drawRock(g, r) })),
      ...this.fighters.map((f) => ({ z: f.z, draw: () => this.drawFighter(g, f) })),
      ...this.plasmas.map((p) => ({ z: p.z, draw: () => this.drawPlasma(g, p) })),
    ];
    items.sort((a, b) => b.z - a.z).forEach((it) => it.draw());

    for (const b of this.booms) {
      const pts: [number, number][] = [];
      const rr = b.size * (0.5 + b.t * 6);
      for (let k = 0; k <= 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const p = project(this.cam, b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr, b.z);
        if (p) pts.push(p);
      }
      for (let k = 1; k < pts.length; k++) line(g, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1], C.WHITE);
    }
    for (const p of this.particles) {
      const s = project(this.cam, p.x, p.y, p.z);
      if (!s) continue;
      g.fillStyle = p.color;
      const size = p.z < 150 ? 2 : 1;
      g.fillRect(Math.round(s[0]), Math.round(s[1]), size, size);
    }
    for (const b of this.bolts) {
      const head = project(this.cam, b.x, b.y, b.z);
      const tail = project(this.cam, b.x - b.vx * 0.03, b.y - b.vy * 0.03, Math.max(4, b.z - BOLT_SPEED * 0.03));
      if (head && tail) line(g, tail[0], tail[1], head[0], head[1], C.CYAN);
      if (head) {
        g.fillStyle = C.WHITE;
        g.fillRect(Math.round(head[0]), Math.round(head[1]), 1, 1);
      }
    }
    if (this.phase !== 'dead') this.drawCrosshair(g);
    g.restore();

    g.drawImage(this.cockpit, 0, 0);
    this.drawDashboard(g);

    if (this.hurtT > 0) {
      g.fillStyle = `rgba(255,40,60,${this.hurtT * 0.6})`;
      g.fillRect(0, 0, W, H);
    }
    if (this.bombFlash > 0) {
      g.fillStyle = `rgba(255,255,255,${Math.min(1, this.bombFlash)})`;
      g.fillRect(0, 0, W, H);
    }
    if (this.phase === 'dead') {
      g.fillStyle = `rgba(255,140,40,${Math.max(0, 0.7 - this.phaseT * 0.4)})`;
      g.fillRect(0, 0, W, H);
    }
    this.drawMessages(g);
  }

  private drawPlanet(g: CanvasRenderingContext2D) {
    const color = PLANET_COLORS[(this.sector - 1) % PLANET_COLORS.length];
    const cx = Math.round(CX + 100 - this.cam.x * 0.4);
    const cy = Math.round(CY - 40 - this.cam.y * 0.4);
    const r = 22;
    const ring = (front: boolean) => {
      let prev: [number, number] | null = null;
      for (let k = 0; k <= 40; k++) {
        const a = (k / 40) * Math.PI * 2;
        const p: [number, number] = [cx + Math.cos(a) * r * 1.8, cy + Math.sin(a) * r * 0.35];
        if (prev && Math.sin(a) >= 0 === front) line(g, prev[0], prev[1], p[0], p[1], '#8a7ab0');
        prev = p;
      }
    };
    ring(false);
    for (let dy = -r; dy <= r; dy++) {
      const half = Math.floor(Math.sqrt(r * r - dy * dy));
      g.fillStyle = color;
      g.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(cx + Math.round(half * 0.25), cy + dy, Math.round(half * 0.75) + 1, 1);
      if (dy % 6 === 0) {
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
      }
    }
    ring(true);
  }

  private drawStars(g: CanvasRenderingContext2D) {
    const cam = { x: this.cam.x * 0.5, y: this.cam.y * 0.5 };
    const len = this.phase === 'dead' ? 0.01 : 0.04;
    for (const s of this.stars) {
      const a = project(cam, s.x, s.y, s.z);
      const b = project(cam, s.x, s.y, s.z + this.speed * len);
      if (!a || !b) continue;
      const color = s.z < 300 ? C.WHITE : s.z < 600 ? '#9a9ac8' : '#4a4a70';
      line(g, b[0], b[1], a[0], a[1], color);
    }
  }

  private drawGate(g: CanvasRenderingContext2D, gt: Gate) {
    const vertical = gt.side < 2;
    const sign = gt.side === 0 || gt.side === 2 ? -1 : 1;
    // Rechteck der gesperrten Hälfte in Weltkoordinaten
    const corner = (a: number, b: number) => (vertical ? project(this.cam, a, b, gt.z) : project(this.cam, b, a, gt.z));
    const near = 0;
    const far = sign * 400;
    const p1 = corner(near, -300);
    const p2 = corner(far, -300);
    const p3 = corner(far, 300);
    const p4 = corner(near, 300);
    if (!p1 || !p2 || !p3 || !p4) return;

    g.fillStyle = 'rgba(255,61,90,0.13)';
    g.beginPath();
    g.moveTo(p1[0], p1[1]);
    g.lineTo(p2[0], p2[1]);
    g.lineTo(p3[0], p3[1]);
    g.lineTo(p4[0], p4[1]);
    g.closePath();
    g.fill();

    for (let k = -700; k <= 300; k += 40) {
      const a = corner(near, k);
      const b = corner(far, k + 400);
      if (a && b) line(g, a[0], a[1], b[0], b[1], C.RED);
    }
    const blink = this.clock % 0.3 < 0.15 ? C.YELLOW : C.WHITE;
    line(g, p1[0], p1[1], p4[0], p4[1], blink);
    const e1 = corner(sign * 3, -300);
    const e2 = corner(sign * 3, 300);
    if (e1 && e2) line(g, e1[0], e1[1], e2[0], e2[1], blink);
  }

  private drawRock(g: CanvasRenderingContext2D, r: Rock) {
    const color = r.flash > 0 ? C.WHITE : r.r > 15 ? C.ORANGE : '#d8a060';
    drawModel(g, this.cam, r.model, r.x, r.y, r.z, { yaw: r.yaw, pitch: r.pitch }, color);
  }

  private drawFighter(g: CanvasRenderingContext2D, f: Fighter) {
    drawModel(g, this.cam, FIGHTER, f.x, f.y, f.z, { roll: f.roll }, C.MAGENTA);
    const e = project(this.cam, f.x, f.y + 2, f.z + 8);
    if (e && this.clock % 0.2 < 0.12) {
      g.fillStyle = C.ORANGE;
      g.fillRect(Math.round(e[0]), Math.round(e[1]), 2, 2);
    }
  }

  private drawPlasma(g: CanvasRenderingContext2D, p: Plasma) {
    const s = project(this.cam, p.x, p.y, p.z);
    if (!s) return;
    const r = Math.min(14, Math.max(1, Math.round((5 * FOCAL) / p.z)));
    const x = Math.round(s[0]);
    const y = Math.round(s[1]);
    fillCircle(g, x, y, r, this.clock % 0.16 < 0.08 ? C.GREEN : '#2acc4a');
    if (r > 2) fillCircle(g, x, y, Math.floor(r / 2), C.WHITE);
  }

  private drawCrosshair(g: CanvasRenderingContext2D) {
    const locked = [...this.rocks.map((r) => ({ x: r.x, y: r.y, z: r.z, r: r.r })), ...this.fighters.map((f) => ({ x: f.x, y: f.y, z: f.z, r: FIGHTER_R }))].some(
      (o) => o.z < 900 && Math.abs(o.x - this.cam.x) < o.r + 3 && Math.abs(o.y - this.cam.y) < o.r + 3,
    );
    const c = locked ? C.RED : C.CYAN;
    g.fillStyle = c;
    g.fillRect(CX - 12, CY, 7, 1);
    g.fillRect(CX + 6, CY, 7, 1);
    g.fillRect(CX, CY - 12, 1, 7);
    g.fillRect(CX, CY + 6, 1, 7);
    g.fillRect(CX, CY, 1, 1);
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = CX + dx * 18;
      const y = CY + dy * 14;
      g.fillRect(dx < 0 ? x : x - 4, y, 5, 1);
      g.fillRect(x, dy < 0 ? y : y - 4, 1, 5);
    }
  }

  private drawDashboard(g: CanvasRenderingContext2D) {
    drawText(g, 'STAR RUN', W / 2, 3, { color: C.CYAN });
    drawText(g, 'ESC = HALL', W - 64, 2, { color: '#5a4a80' });

    const L = LEFT_BOX;
    drawText(g, 'SHIELD', L.x + 8, L.y + 5, { color: C.DIM });
    const low = this.shield < 30;
    drawText(g, `${this.shield}%`, L.x + L.w - 8, L.y + 5, { color: low ? C.RED : C.WHITE, align: 'right' });
    const color = this.shield > 50 ? C.GREEN : this.shield > 25 ? C.YELLOW : C.RED;
    const filled = Math.ceil(this.shield / 10);
    for (let i = 0; i < 10; i++) {
      const on = i < filled && !(low && this.clock % 0.5 < 0.2);
      g.fillStyle = on ? color : '#241a3a';
      g.fillRect(L.x + 8 + i * 10, L.y + 16, 9, 8);
    }
    drawText(g, 'BOMB', L.x + 8, L.y + 32, { color: C.DIM });
    for (let i = 0; i < 3; i++) fillCircle(g, L.x + 50 + i * 14, L.y + 35, 4, i < this.bombs ? C.ORANGE : '#3a2a5a');
    drawText(g, 'SHIFT = BOMB', L.x + 8, L.y + 46, { color: '#5a4a80' });

    const R = RIGHT_BOX;
    drawText(g, 'SCORE', R.x + 8, R.y + 5, { color: C.DIM });
    drawText(g, String(this.score).padStart(6, '0'), R.x + 8, R.y + 15, { scale: 2, color: C.WHITE });
    drawText(g, `SECTOR ${this.sector}`, R.x + 8, R.y + 34, { color: C.CYAN });
    drawText(g, `HI ${Math.max(this.env.hiScore, this.score)}`, R.x + 8, R.y + 46, { color: C.YELLOW });

    // Radar: unten = nah, oben = fern
    const rr = RADAR.r;
    const a = this.clock * 3;
    line(g, RADAR.x, RADAR.y, RADAR.x + Math.cos(a) * (rr - 1), RADAR.y + Math.sin(a) * (rr - 1), '#1f6a3a');
    const blip = (x: number, z: number, color: string, size: number) => {
      const bx = RADAR.x + ((x - this.cam.x) / 160) * rr;
      const by = RADAR.y + rr - (z / SPAWN_Z) * rr * 2;
      if ((bx - RADAR.x) ** 2 + (by - RADAR.y) ** 2 > (rr - 1) ** 2) return;
      g.fillStyle = color;
      g.fillRect(Math.round(bx), Math.round(by), size, size);
    };
    for (const r of this.rocks) blip(r.x, r.z, C.ORANGE, r.r > 15 ? 2 : 1);
    for (const f of this.fighters) blip(f.x, f.z, C.RED, 2);
    for (const p of this.plasmas) blip(p.x, p.z, C.GREEN, 1);
    for (const gt of this.gates) {
      const by = Math.round(RADAR.y + rr - (gt.z / SPAWN_Z) * rr * 2);
      g.fillStyle = C.RED;
      if (gt.side === 0) g.fillRect(RADAR.x - 18, by, 18 - Math.round((this.cam.x / 160) * rr), 1);
      else if (gt.side === 1) g.fillRect(RADAR.x - Math.round((this.cam.x / 160) * rr), by, 18, 1);
      else g.fillRect(RADAR.x - 18, by, 36, 1);
    }
    g.fillStyle = C.GREEN;
    g.fillRect(RADAR.x - 1, RADAR.y + rr - 3, 3, 1);
    g.fillRect(RADAR.x, RADAR.y + rr - 4, 1, 1);
  }

  private drawMessages(g: CanvasRenderingContext2D) {
    if (this.phase === 'ready') {
      drawText(g, `SECTOR ${this.sector}`, CX, 50, { scale: 3, color: C.CYAN, align: 'center', glow: true });
      drawText(g, 'GET READY', CX, 80, { color: C.YELLOW, align: 'center' });
      if (this.sector === 1) {
        drawText(g, 'ARROWS STEER - SPACE FIRES', CX, 160, { color: C.WHITE, align: 'center' });
        drawText(g, 'DODGE ROCKS AND LASER FENCES', CX, 172, { color: C.WHITE, align: 'center' });
      }
    } else if (this.phase === 'clear') {
      drawText(g, 'SECTOR CLEAR!', CX, 46, { scale: 3, color: C.GREEN, align: 'center', glow: true });
      drawText(g, `BONUS ${this.bonus}`, CX, 76, { scale: 2, color: C.YELLOW, align: 'center' });
      drawText(g, '+25% SHIELD   +1 BOMB', CX, 98, { color: C.WHITE, align: 'center' });
    } else if (this.phase === 'play') {
      const gate = this.gates.find((gt) => gt.z < 800);
      if (gate && this.clock % 0.5 < 0.35) {
        drawText(g, GATE_HINTS[gate.side], CX, 150, { scale: 2, color: C.YELLOW, align: 'center', glow: true });
      }
      if (this.shield < 30 && this.clock % 1 < 0.6) {
        drawText(g, 'SHIELD LOW!', CX, 190, { scale: 2, color: C.RED, align: 'center' });
      }
    }
  }
}
