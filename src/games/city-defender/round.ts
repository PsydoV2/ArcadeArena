import { fillCircle, line } from '../../engine/draw';
import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import type { Round, RoundEnv } from '../../engine/shell';
import type { Sound } from '../../engine/sound';
import { SCREEN_H as H, SCREEN_W as W } from '../../engine/types';

const GROUND_Y = 262;
const SKY_TOP = 22;
const CURSOR_SPEED = 210;
const AMMO = 10;
const BLAST_R = 22;
const BLAST_TIME = 1.1;
const BASES_X = [24, W / 2, W - 24];
export const CITIES_X = [70, 110, 150, 234, 274, 314];
const BONUS_CITY_EVERY = 10000;

interface Missile {
  sx: number;
  sy: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  speed: number;
  splitAt?: number;
}

interface Shot {
  sx: number;
  sy: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  speed: number;
}

interface Blast {
  x: number;
  y: number;
  t: number;
  enemy: boolean;
}

type Phase = 'ready' | 'play' | 'tally' | 'end';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pad = (n: number) => String(n).padStart(6, '0');

const sfx = {
  launch(s: Sound) {
    s.tone({ freq: 300, to: 900, dur: 0.18, type: 'sawtooth', vol: 0.08, jitter: 0.05 });
  },
  blast(s: Sound) {
    s.noise({ dur: 0.5, freq: 2500, to: 150, vol: 0.3 });
  },
  hitGround(s: Sound) {
    s.noise({ dur: 0.7, freq: 900, to: 60, vol: 0.45 });
  },
  empty(s: Sound) {
    s.tone({ freq: 120, dur: 0.08, type: 'square', vol: 0.1 });
  },
  tally(s: Sound) {
    s.tone({ freq: 880, dur: 0.04, type: 'square', vol: 0.1 });
  },
  wave(s: Sound) {
    s.seq([[392, 0.1], [523, 0.1], [659, 0.1], [784, 0.25]], { type: 'square', vol: 0.15 });
  },
  bonusCity(s: Sound) {
    s.seq([[784, 0.08], [988, 0.08], [1175, 0.08], [1568, 0.2]], { type: 'square', vol: 0.15 });
  },
};

export class CityDefenderRound implements Round {
  score = 0;
  over = false;

  private wave = 1;
  private phase: Phase = 'ready';
  private phaseT = 0;
  private clock = 0;

  private cx = W / 2;
  private cy = 120;
  private ammo = [AMMO, AMMO, AMMO];
  private baseAlive = [true, true, true];
  private cities = CITIES_X.map(() => true);
  private reserveCities = 0;
  private nextBonus = BONUS_CITY_EVERY;

  private missiles: Missile[] = [];
  private shots: Shot[] = [];
  private blasts: Blast[] = [];
  private toLaunch = 0;
  private launchT = 0;
  private fireT = 0;

  private tally = { ammo: 0, cities: 0, step: 0, t: 0 };

  constructor(private env: RoundEnv) {
    this.startWave();
  }

  private get sound() {
    return this.env.audio;
  }

  /** Punktefaktor wie beim Vorbild: steigt alle zwei Wellen. */
  private get multiplier() {
    return Math.min(6, Math.floor((this.wave + 1) / 2));
  }

  update(dt: number): void {
    this.clock += dt;
    this.phaseT += dt;
    this.moveCursor(dt);

    switch (this.phase) {
      case 'ready':
        if (this.phaseT > 2) this.setPhase('play');
        break;
      case 'play':
        this.fire(dt);
        this.spawn(dt);
        this.moveMissiles(dt);
        this.moveShots(dt);
        this.updateBlasts(dt);
        if (this.toLaunch === 0 && this.missiles.length === 0 && this.blasts.length === 0 && this.shots.length === 0) {
          this.tally = { ammo: 0, cities: 0, step: 0, t: 0 };
          this.setPhase('tally');
        }
        break;
      case 'tally':
        this.runTally(dt);
        break;
      case 'end':
        this.updateBlasts(dt);
        if (this.phaseT > 3) this.over = true;
        break;
    }
  }

  // ---------- Ablauf ----------

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  private startWave() {
    this.ammo = [AMMO, AMMO, AMMO];
    this.baseAlive = [true, true, true];
    this.toLaunch = Math.min(30, 10 + this.wave * 2);
    this.launchT = 1;
    this.missiles = [];
    this.shots = [];
    this.blasts = [];
    this.setPhase('ready');
  }

  private addScore(n: number) {
    this.score += n;
    while (this.score >= this.nextBonus) {
      this.nextBonus += BONUS_CITY_EVERY;
      this.reserveCities++;
      sfx.bonusCity(this.sound);
    }
  }

  /** Nach der Welle: übrige Raketen und Städte einzeln zählen. */
  private runTally(dt: number) {
    const t = this.tally;
    t.t -= dt;
    if (t.t > 0) return;
    t.t = 0.08;
    const totalAmmo = this.ammo.reduce((a, b) => a + b, 0);
    if (t.step === 0) {
      if (t.ammo < totalAmmo) {
        t.ammo++;
        this.addScore(5 * this.multiplier);
        sfx.tally(this.sound);
        return;
      }
      t.step = 1;
      t.t = 0.4;
      return;
    }
    if (t.step === 1) {
      const alive = this.cities.filter(Boolean).length;
      if (t.cities < alive) {
        t.cities++;
        t.t = 0.2;
        this.addScore(100 * this.multiplier);
        sfx.tally(this.sound);
        return;
      }
      t.step = 2;
      t.t = 1.2;
      return;
    }
    // Zerstörte Städte aus der Reserve ersetzen
    while (this.reserveCities > 0 && this.cities.some((c) => !c)) {
      this.cities[this.cities.indexOf(false)] = true;
      this.reserveCities--;
    }
    if (!this.cities.some(Boolean)) {
      this.setPhase('end');
      return;
    }
    this.wave++;
    sfx.wave(this.sound);
    this.startWave();
  }

  // ---------- Spieler ----------

  private moveCursor(dt: number) {
    const input = this.env.input;
    const dx = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    const dy = (input.held('down') ? 1 : 0) - (input.held('up') ? 1 : 0);
    this.cx = Math.max(6, Math.min(W - 6, this.cx + dx * CURSOR_SPEED * dt));
    this.cy = Math.max(SKY_TOP + 4, Math.min(GROUND_Y - 30, this.cy + dy * CURSOR_SPEED * dt));
  }

  /** Feuert von der nächstgelegenen Basis, die noch Raketen hat. */
  private fire(dt: number) {
    this.fireT -= dt;
    if (!this.env.input.held('a') || this.fireT > 0) return;
    this.fireT = 0.25;
    const order = [0, 1, 2]
      .filter((i) => this.baseAlive[i] && this.ammo[i] > 0)
      .sort((a, b) => Math.abs(BASES_X[a] - this.cx) - Math.abs(BASES_X[b] - this.cx));
    if (!order.length) {
      sfx.empty(this.sound);
      return;
    }
    const b = order[0];
    this.ammo[b]--;
    const sy = GROUND_Y - 14;
    this.shots.push({ sx: BASES_X[b], sy, x: BASES_X[b], y: sy, tx: this.cx, ty: this.cy, speed: b === 1 ? 420 : 300 });
    sfx.launch(this.sound);
  }

  private moveShots(dt: number) {
    this.shots = this.shots.filter((s) => {
      const d = Math.hypot(s.tx - s.x, s.ty - s.y);
      const step = s.speed * dt;
      if (d <= step) {
        this.blasts.push({ x: s.tx, y: s.ty, t: 0, enemy: false });
        sfx.blast(this.sound);
        return false;
      }
      s.x += ((s.tx - s.x) / d) * step;
      s.y += ((s.ty - s.y) / d) * step;
      return true;
    });
  }

  // ---------- Angreifer ----------

  private targets(): number[] {
    const t: number[] = [];
    this.cities.forEach((alive, i) => alive && t.push(CITIES_X[i]));
    this.baseAlive.forEach((alive, i) => alive && t.push(BASES_X[i]));
    return t.length ? t : [W / 2];
  }

  private spawn(dt: number) {
    if (this.toLaunch <= 0) return;
    this.launchT -= dt;
    if (this.launchT > 0) return;
    this.launchT = Math.max(0.35, 1.5 - this.wave * 0.1) * rand(0.6, 1.4);
    const salvo = Math.min(this.toLaunch, 1 + Math.floor(Math.random() * Math.min(3, 1 + this.wave / 2)));
    for (let i = 0; i < salvo; i++) {
      const tg = this.targets();
      const tx = tg[Math.floor(Math.random() * tg.length)] + rand(-4, 4);
      const sx = rand(10, W - 10);
      // Ab Welle 3 teilen sich manche Raketen unterwegs
      const split = this.wave >= 3 && Math.random() < 0.15 + this.wave * 0.02 ? rand(70, 150) : undefined;
      this.missiles.push({ sx, sy: SKY_TOP, x: sx, y: SKY_TOP, tx, ty: GROUND_Y - 4, speed: Math.min(70, 16 + this.wave * 5), splitAt: split });
    }
    this.toLaunch -= salvo;
  }

  private moveMissiles(dt: number) {
    const spawned: Missile[] = [];
    this.missiles = this.missiles.filter((m) => {
      const d = Math.hypot(m.tx - m.x, m.ty - m.y);
      const step = m.speed * dt;
      if (d <= step) {
        this.impact(m.tx);
        return false;
      }
      m.x += ((m.tx - m.x) / d) * step;
      m.y += ((m.ty - m.y) / d) * step;

      if (m.splitAt !== undefined && m.y >= m.splitAt) {
        m.splitAt = undefined;
        const tg = this.targets();
        for (let k = 0; k < 2; k++) {
          const tx = tg[Math.floor(Math.random() * tg.length)];
          spawned.push({ sx: m.x, sy: m.y, x: m.x, y: m.y, tx, ty: GROUND_Y - 4, speed: m.speed });
        }
      }
      // In einer Explosion zerstört?
      const hit = this.blasts.some((b) => Math.hypot(b.x - m.x, b.y - m.y) <= this.blastRadius(b));
      if (hit) {
        this.addScore(25 * this.multiplier);
        this.blasts.push({ x: m.x, y: m.y, t: 0.15, enemy: true });
        return false;
      }
      return true;
    });
    this.missiles.push(...spawned);
  }

  private impact(x: number) {
    this.blasts.push({ x, y: GROUND_Y - 6, t: 0, enemy: true });
    sfx.hitGround(this.sound);
    const city = CITIES_X.findIndex((cx, i) => this.cities[i] && Math.abs(cx - x) < 12);
    if (city >= 0) this.cities[city] = false;
    const base = BASES_X.findIndex((bx, i) => this.baseAlive[i] && Math.abs(bx - x) < 12);
    if (base >= 0) {
      this.baseAlive[base] = false;
      this.ammo[base] = 0;
    }
  }

  private blastRadius(b: Blast): number {
    const half = BLAST_TIME / 2;
    const f = b.t < half ? b.t / half : 1 - (b.t - half) / half;
    return Math.max(0, f) * (b.enemy ? BLAST_R * 0.7 : BLAST_R);
  }

  private updateBlasts(dt: number) {
    for (const b of this.blasts) b.t += dt;
    this.blasts = this.blasts.filter((b) => b.t < BLAST_TIME);
  }

  // ---------- Darstellung ----------

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#03020c';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#0a0620';
    g.fillRect(0, GROUND_Y - 60, W, 60);

    for (const m of this.missiles) {
      line(g, m.sx, m.sy, m.x, m.y, '#a02040');
      g.fillStyle = this.clock % 0.2 < 0.1 ? C.WHITE : C.RED;
      g.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
    }
    for (const s of this.shots) {
      line(g, s.sx, s.sy, s.x, s.y, '#2a6aa0');
      g.fillStyle = C.WHITE;
      g.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
      // Zielmarkierung
      g.fillStyle = C.CYAN;
      g.fillRect(Math.round(s.tx) - 2, Math.round(s.ty), 5, 1);
      g.fillRect(Math.round(s.tx), Math.round(s.ty) - 2, 1, 5);
    }
    const colors = [C.WHITE, C.YELLOW, C.ORANGE, C.MAGENTA, C.CYAN];
    for (const b of this.blasts) {
      const r = Math.round(this.blastRadius(b));
      if (r > 0) fillCircle(g, Math.round(b.x), Math.round(b.y), r, colors[Math.floor(this.clock * 20 + b.x) % colors.length]);
    }

    // Boden mit Hügeln für die Basen
    g.fillStyle = '#5a2a8a';
    g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    for (const bx of BASES_X) {
      for (let k = 0; k < 10; k++) g.fillRect(bx - 18 + k * 2, GROUND_Y - k, 36 - k * 4, 1);
    }
    this.baseAlive.forEach((alive, i) => {
      const bx = BASES_X[i];
      if (!alive) return;
      // Munition als kleine Pyramide
      for (let k = 0; k < this.ammo[i]; k++) {
        const row = k < 4 ? 0 : k < 7 ? 1 : k < 9 ? 2 : 3;
        const idx = [0, 4, 7, 9][row];
        const inRow = [4, 3, 2, 1][row];
        const x = bx - (inRow - 1) * 2.5 + (k - idx) * 5;
        g.fillStyle = C.CYAN;
        g.fillRect(Math.round(x), GROUND_Y + 2 - row * 4, 2, 3);
      }
    });
    if (this.phase === 'play') {
      this.ammo.forEach((a, i) => {
        if (this.baseAlive[i] && a <= 3) {
          drawText(g, a === 0 ? 'OUT' : 'LOW', BASES_X[i], GROUND_Y + 12, { color: C.RED, align: 'center' });
        }
      });
    }

    this.cities.forEach((alive, i) => this.drawCity(g, CITIES_X[i], alive));

    // Fadenkreuz
    if (this.phase === 'play' || this.phase === 'ready') {
      const x = Math.round(this.cx);
      const y = Math.round(this.cy);
      g.fillStyle = C.WHITE;
      g.fillRect(x - 6, y, 4, 1);
      g.fillRect(x + 3, y, 4, 1);
      g.fillRect(x, y - 6, 1, 4);
      g.fillRect(x, y + 3, 1, 4);
    }

    drawText(g, pad(this.score), 8, 6, { color: C.WHITE });
    drawText(g, `HI ${pad(Math.max(this.env.hiScore, this.score))}`, W / 2, 6, { color: C.YELLOW, align: 'center' });
    drawText(g, `WAVE ${this.wave}  X${this.multiplier}`, W - 8, 6, { color: C.CYAN, align: 'right' });
    drawText(g, 'ESC = HALL', 8, 16, { color: '#3e3566' });
    if (this.reserveCities > 0) drawText(g, `+${this.reserveCities} CITY`, W - 8, 16, { color: C.GREEN, align: 'right' });

    if (this.phase === 'ready') {
      this.message(g, `WAVE ${this.wave}`, C.CYAN, `DEFEND THE CITIES - X${this.multiplier} POINTS`);
    } else if (this.phase === 'tally') {
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(70, 80, W - 140, 64);
      drawText(g, 'BONUS POINTS', W / 2, 86, { scale: 2, color: C.YELLOW, align: 'center' });
      drawText(g, `MISSILES ${this.tally.ammo} X ${5 * this.multiplier}`, W / 2, 108, { color: C.CYAN, align: 'center' });
      drawText(g, `CITIES ${this.tally.cities} X ${100 * this.multiplier}`, W / 2, 122, { color: C.GREEN, align: 'center' });
    } else if (this.phase === 'end') {
      this.message(g, 'THE END', C.RED, 'ALL CITIES ARE LOST');
    }
  }

  private drawCity(g: CanvasRenderingContext2D, x: number, alive: boolean) {
    const y = GROUND_Y;
    if (!alive) {
      g.fillStyle = '#3a1a4a';
      g.fillRect(x - 10, y - 3, 20, 3);
      g.fillStyle = '#5a2a2a';
      g.fillRect(x - 6, y - 5, 4, 2);
      g.fillRect(x + 3, y - 4, 3, 1);
      return;
    }
    const towers = [[-10, 6], [-6, 10], [-2, 14], [2, 8], [6, 12], [9, 5]];
    for (const [dx, h] of towers) {
      g.fillStyle = C.CYAN;
      g.fillRect(x + dx, y - h, 3, h);
      g.fillStyle = C.YELLOW;
      for (let wy = y - h + 2; wy < y - 1; wy += 3) g.fillRect(x + dx + 1, wy, 1, 1);
    }
  }

  private message(g: CanvasRenderingContext2D, text: string, color: string, sub: string) {
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(0, 92, W, 40);
    drawText(g, text, W / 2, 96, { scale: 2, color, align: 'center', glow: true });
    drawText(g, sub, W / 2, 118, { color: C.YELLOW, align: 'center' });
  }
}
