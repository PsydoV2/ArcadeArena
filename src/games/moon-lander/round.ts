import { line } from '../../engine/draw';
import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import type { Round, RoundEnv } from '../../engine/shell';
import { DEAD_LOOP, type LoopHandle, type Sound } from '../../engine/sound';
import { SCREEN_H as H, SCREEN_W as W } from '../../engine/types';

const GRAVITY = 20;
const THRUST = 48;
const TURN_SPEED = 2.6;
const FUEL_START = 1000;
const FUEL_PER_SEC = 55;
const SAFE_VY = 16;
const SAFE_VX = 10;
const SAFE_ANGLE = 0.2;
const LANDER_H = 9;

interface Pad {
  x0: number;
  x1: number;
  y: number;
  mult: number;
}

/** Lander-Umriss (Nase nach oben bei Winkel 0). */
export const LANDER_LINES: [number, number, number, number][] = [
  [-4, -6, 4, -6],
  [4, -6, 5, -2],
  [5, -2, -5, -2],
  [-5, -2, -4, -6],
  [-5, -2, -6, 2],
  [-6, 2, -5, 2],
  [5, -2, 6, 2],
  [6, 2, 5, 2],
  [-2, -2, -3, 1],
  [2, -2, 3, 1],
  [-3, 1, 3, 1],
  [-2, -6, 0, -9],
  [0, -9, 2, -6],
];

type Phase = 'fly' | 'landed' | 'crashed';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

const sfx = {
  crash(s: Sound) {
    s.noise({ dur: 1, freq: 1500, to: 60, vol: 0.55 });
    s.tone({ freq: 200, to: 40, dur: 0.8, type: 'sawtooth', vol: 0.2 });
  },
  landed(s: Sound) {
    s.seq([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.3]], { type: 'triangle', vol: 0.35 });
  },
  lowFuel(s: Sound) {
    s.tone({ freq: 880, dur: 0.08, type: 'square', vol: 0.08 });
  },
};

export class MoonLanderRound implements Round {
  score = 0;
  over = false;

  private mission = 1;
  private landers = 3;
  private phase: Phase = 'fly';
  private phaseT = 0;
  private clock = 0;

  private x = 40;
  private y = 40;
  private vx = 30;
  private vy = 0;
  private a = 0;
  private fuel = FUEL_START;
  private thrusting = false;
  private terrain: [number, number][] = [];
  private pads: Pad[] = [];
  private result = { text: '', pts: 0, perfect: false };
  private beepT = 0;
  private hum: LoopHandle = DEAD_LOOP;
  private stars = Array.from({ length: 50 }, () => ({ x: rand(0, W) | 0, y: rand(20, 160) | 0 }));
  private debris: { x: number; y: number; vx: number; vy: number }[] = [];

  constructor(private env: RoundEnv) {
    this.newMission();
  }

  private get sound() {
    return this.env.audio;
  }

  update(dt: number): void {
    this.clock += dt;
    this.phaseT += dt;

    switch (this.phase) {
      case 'fly':
        this.fly(dt);
        break;
      case 'landed':
        if (this.phaseT > 3) {
          this.mission++;
          this.fuel = Math.min(FUEL_START, this.fuel + 400);
          this.newMission();
        }
        break;
      case 'crashed':
        for (const d of this.debris) {
          d.vy += GRAVITY * dt;
          d.x += d.vx * dt;
          d.y += d.vy * dt;
        }
        if (this.phaseT > 2.5) {
          if (this.landers <= 0) this.over = true;
          else {
            this.fuel = FUEL_START;
            this.newMission();
          }
        }
        break;
    }

    const wantHum = this.thrusting && this.phase === 'fly';
    if (wantHum && !this.hum.alive) this.hum = this.sound.loop({ noise: true, freq: 380, vol: 0.14 });
    else if (!wantHum && this.hum.alive) this.hum.stop();
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  /** Neue Mondlandschaft mit Landeplätzen – je höher die Mission, desto schmaler. */
  private newMission() {
    const shrink = Math.max(0.55, 1 - (this.mission - 1) * 0.08);
    const padDefs = [
      { w: 46 * shrink, mult: 2 },
      { w: 30 * shrink, mult: 3 },
      { w: 20 * shrink, mult: 5 },
    ];
    // Plätze zufällig verteilen, ohne Überlappung
    const slots = [0.18, 0.5, 0.82].sort(() => Math.random() - 0.5);
    this.pads = padDefs.map((p, i) => {
      const cx = slots[i] * W + rand(-20, 20);
      return { x0: Math.round(cx - p.w / 2), x1: Math.round(cx + p.w / 2), y: Math.round(rand(190, 250)), mult: p.mult };
    });

    this.terrain = [];
    let x = 0;
    let y = rand(200, 250);
    while (x <= W) {
      const pad = this.pads.find((p) => x >= p.x0 - 8 && x < p.x1);
      if (pad) {
        this.terrain.push([pad.x0, pad.y], [pad.x1, pad.y]);
        x = pad.x1 + 8;
        y = pad.y;
        continue;
      }
      y = Math.max(140, Math.min(272, y + rand(-28, 28)));
      this.terrain.push([x, y]);
      x += rand(8, 18);
    }
    this.terrain.sort((a, b) => a[0] - b[0]);

    this.x = rand(30, 80);
    this.y = 36;
    this.vx = rand(20, 40);
    this.vy = 0;
    this.a = 0;
    this.debris = [];
    this.setPhase('fly');
  }

  private groundAt(x: number): number {
    const t = this.terrain;
    for (let i = 1; i < t.length; i++) {
      if (x <= t[i][0]) {
        const [x0, y0] = t[i - 1];
        const [x1, y1] = t[i];
        const f = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
        return y0 + (y1 - y0) * f;
      }
    }
    return t[t.length - 1][1];
  }

  private fly(dt: number) {
    const input = this.env.input;
    const turn = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    this.a = Math.max(-1.4, Math.min(1.4, this.a + turn * TURN_SPEED * dt));
    this.thrusting = (input.held('a') || input.held('up')) && this.fuel > 0;
    if (this.thrusting) {
      this.vx += Math.sin(this.a) * THRUST * dt;
      this.vy -= Math.cos(this.a) * THRUST * dt;
      this.fuel = Math.max(0, this.fuel - FUEL_PER_SEC * dt);
    }
    this.vy += GRAVITY * (1 + (this.mission - 1) * 0.05) * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Am Rand wieder hereinkommen
    if (this.x < 0) this.x += W;
    if (this.x > W) this.x -= W;
    if (this.y < 10) {
      this.y = 10;
      this.vy = Math.max(0, this.vy);
    }

    if (this.fuel < 150 && this.fuel > 0) {
      this.beepT -= dt;
      if (this.beepT <= 0) {
        sfx.lowFuel(this.sound);
        this.beepT = 0.6;
      }
    }

    // Bodenkontakt: Füße links und rechts prüfen
    const feet = [-5, 5].map((dx) => this.y + 2 >= this.groundAt(this.x + dx));
    if (!feet[0] && !feet[1]) return;
    const pad = this.pads.find((p) => this.x - 5 >= p.x0 && this.x + 5 <= p.x1);
    const soft = Math.abs(this.vy) <= SAFE_VY && Math.abs(this.vx) <= SAFE_VX && Math.abs(this.a) <= SAFE_ANGLE;
    if (pad && soft) {
      const perfect = Math.abs(this.vy) < 7 && Math.abs(this.a) < 0.08;
      const pts = (perfect ? 100 : 50) * pad.mult * this.mission + Math.round(this.fuel / 4);
      this.score += pts;
      this.result = { text: perfect ? 'PERFECT LANDING!' : 'THE EAGLE HAS LANDED', pts, perfect };
      this.y = pad.y - 2;
      sfx.landed(this.sound);
      this.setPhase('landed');
    } else {
      this.landers--;
      this.result = { text: pad ? 'TOO FAST!' : 'CRASHED', pts: 0, perfect: false };
      for (let i = 0; i < 16; i++) {
        const ang = rand(-Math.PI, 0);
        const v = rand(20, 70);
        this.debris.push({ x: this.x, y: this.y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v });
      }
      sfx.crash(this.sound);
      this.setPhase('crashed');
    }
  }

  // ---------- Darstellung ----------

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#02010a';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#3a3660';
    for (const s of this.stars) g.fillRect(s.x, s.y, 1, 1);
    // Erde am Himmel
    g.fillStyle = '#2a5aa8';
    g.fillRect(330, 40, 14, 14);
    g.fillRect(328, 42, 18, 10);
    g.fillStyle = '#3a9a5a';
    g.fillRect(332, 44, 5, 4);
    g.fillRect(339, 48, 4, 3);

    // Boden
    const t = this.terrain;
    g.fillStyle = '#1a1430';
    for (let x = 0; x < W; x++) {
      const gy = Math.round(this.groundAt(x));
      g.fillRect(x, gy, 1, H - gy);
    }
    for (let i = 1; i < t.length; i++) line(g, t[i - 1][0], t[i - 1][1], t[i][0], t[i][1], '#b8acd8');
    for (const p of this.pads) {
      g.fillStyle = this.clock % 1 < 0.7 ? C.GREEN : '#2a8a3a';
      g.fillRect(p.x0, p.y - 1, p.x1 - p.x0 + 1, 2);
      drawText(g, `X${p.mult}`, (p.x0 + p.x1) / 2, p.y + 4, { color: C.GREEN, align: 'center' });
    }

    if (this.phase === 'crashed') {
      g.fillStyle = C.ORANGE;
      for (const d of this.debris) g.fillRect(Math.round(d.x), Math.round(d.y), 2, 2);
    } else {
      this.drawLander(g, this.x, this.y - LANDER_H / 2 + 2, this.a, C.WHITE);
      if (this.thrusting && this.clock % 0.08 < 0.05) {
        const len = 6 + Math.random() * 5;
        const bx = this.x - Math.sin(this.a) * 2;
        const by = this.y - LANDER_H / 2 + 2 + Math.cos(this.a) * 2;
        line(g, bx - Math.cos(this.a) * 2, by - Math.sin(this.a) * 2, bx - Math.sin(this.a) * len, by + Math.cos(this.a) * len, C.YELLOW);
        line(g, bx + Math.cos(this.a) * 2, by + Math.sin(this.a) * 2, bx - Math.sin(this.a) * len, by + Math.cos(this.a) * len, C.ORANGE);
      }
    }

    this.renderHud(g);
  }

  private drawLander(g: CanvasRenderingContext2D, x: number, y: number, a: number, color: string) {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const p = (px: number, py: number): [number, number] => [x + px * ca - py * sa, y + px * sa + py * ca];
    for (const [x0, y0, x1, y1] of LANDER_LINES) {
      const [ax, ay] = p(x0, y0);
      const [bx, by] = p(x1, y1);
      line(g, ax, ay, bx, by, color);
    }
  }

  private renderHud(g: CanvasRenderingContext2D) {
    const alt = Math.max(0, Math.round(this.groundAt(this.x) - this.y));
    const vxOk = Math.abs(this.vx) <= SAFE_VX;
    const vyOk = Math.abs(this.vy) <= SAFE_VY;
    const aOk = Math.abs(this.a) <= SAFE_ANGLE;

    drawText(g, `SCORE ${String(this.score).padStart(6, '0')}`, 8, 4, { color: C.WHITE });
    drawText(g, `HI ${String(Math.max(this.env.hiScore, this.score)).padStart(6, '0')}`, 8, 14, { color: C.YELLOW });
    drawText(g, `MISSION ${this.mission}`, W / 2, 4, { color: C.CYAN, align: 'center' });
    drawText(g, `LANDERS ${this.landers}`, W / 2, 14, { color: C.DIM, align: 'center' });

    const rx = W - 112;
    drawText(g, `ALTITUDE ${alt}`, rx, 4, { color: C.WHITE });
    drawText(g, `ACROSS ${Math.round(this.vx)} ${this.vx > 1 ? '→' : this.vx < -1 ? '←' : ''}`, rx, 14, { color: vxOk ? C.GREEN : C.RED });
    drawText(g, `DOWN ${Math.round(this.vy)} ${this.vy > 1 ? '↓' : this.vy < -1 ? '↑' : ''}`, rx, 24, { color: vyOk ? C.GREEN : C.RED });
    drawText(g, aOk ? 'UPRIGHT' : 'TILTED', rx, 34, { color: aOk ? C.GREEN : C.RED });

    drawText(g, 'FUEL', 8, 26, { color: C.DIM });
    g.fillStyle = '#241a3a';
    g.fillRect(36, 26, 80, 6);
    const low = this.fuel < 150;
    g.fillStyle = low ? (this.clock % 0.4 < 0.2 ? C.RED : C.ORANGE) : C.ORANGE;
    g.fillRect(36, 26, Math.round((80 * this.fuel) / FUEL_START), 6);
    if (this.fuel <= 0 && this.phase === 'fly') drawText(g, 'OUT OF FUEL!', W / 2, 60, { scale: 2, color: C.RED, align: 'center' });

    if (this.phase === 'landed' || this.phase === 'crashed') {
      const ok = this.phase === 'landed';
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(0, 84, W, 44);
      drawText(g, this.result.text, W / 2, 90, { scale: 2, color: ok ? C.GREEN : C.RED, align: 'center', glow: true });
      drawText(g, ok ? `+${this.result.pts} POINTS   +400 FUEL` : `${this.landers} LANDERS LEFT`, W / 2, 112, { color: C.YELLOW, align: 'center' });
    } else if (this.phaseT < 2.5) {
      drawText(g, 'LAND SOFTLY ON A GREEN PAD', W / 2, 70, { color: C.YELLOW, align: 'center' });
    }
    drawText(g, 'ESC = HALL', W - 8, H - 10, { color: '#5a4a80', align: 'right' });
  }
}
