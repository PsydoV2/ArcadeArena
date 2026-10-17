import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import type { Round, RoundEnv } from '../../engine/shell';
import type { Sound } from '../../engine/sound';
import { SCREEN_H as H, SCREEN_W as W } from '../../engine/types';

const CELL = 8;
const COLS = W / CELL;
const TOP_ROW = 2;
const BOTTOM_ROW = 34;
const ZONE_TOP = 28;
const PLAYER_SPEED = 140;
const BULLET_SPEED = 520;
const MUSHROOM_HP = 4;
const EXTRA_LIFE_EVERY = 12000;

/** Farbpaare (Raupe, Pilz) – wechseln mit jeder Welle. */
export const WAVE_COLORS: [string, string][] = [
  [C.GREEN, C.MAGENTA],
  [C.CYAN, C.ORANGE],
  [C.YELLOW, C.RED],
  [C.MAGENTA, C.GREEN],
  [C.ORANGE, C.CYAN],
];

interface Cell {
  x: number;
  y: number;
}

/** Eine Raupe: Kopf vorne, die Glieder folgen exakt dem Pfad des Kopfes. */
interface Chain {
  path: Cell[];
  len: number;
  dir: number;
  vdir: number;
  stepT: number;
}

interface Spider {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
}

interface Flea {
  x: number;
  y: number;
  hp: number;
  lastRow: number;
}

type Phase = 'play' | 'dead' | 'wave';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const key = (x: number, y: number) => y * COLS + x;
const pad = (n: number) => String(n).padStart(6, '0');

const sfx = {
  shoot(s: Sound) {
    s.tone({ freq: 1600, to: 900, dur: 0.05, type: 'square', vol: 0.05 });
  },
  hitSegment(s: Sound) {
    s.noise({ dur: 0.12, freq: 3000, to: 500, vol: 0.25 });
    s.tone({ freq: 500, to: 200, dur: 0.1, type: 'square', vol: 0.1 });
  },
  mushroom(s: Sound) {
    s.tone({ freq: 220, dur: 0.03, type: 'square', vol: 0.06 });
  },
  spider(s: Sound) {
    s.seq([[880, 0.05], [1175, 0.05], [1568, 0.1]], { type: 'square', vol: 0.15 });
  },
  die(s: Sound) {
    s.noise({ dur: 1, freq: 2000, to: 80, vol: 0.5 });
    s.tone({ freq: 400, to: 50, dur: 1, type: 'sawtooth', vol: 0.18 });
  },
  restore(s: Sound) {
    s.tone({ freq: 1200, dur: 0.03, type: 'square', vol: 0.06 });
  },
  wave(s: Sound) {
    s.seq([[392, 0.08], [523, 0.08], [659, 0.08], [784, 0.2]], { type: 'square', vol: 0.15 });
  },
  extraLife(s: Sound) {
    s.seq([[784, 0.08], [988, 0.08], [1175, 0.08], [1568, 0.2]], { type: 'square', vol: 0.15 });
  },
};

export class GardenGuardRound implements Round {
  score = 0;
  over = false;

  private wave = 1;
  private lives = 3;
  private phase: Phase = 'play';
  private phaseT = 0;
  private clock = 0;

  private mushrooms = new Map<number, number>();
  private chains: Chain[] = [];
  private px = W / 2 - 4;
  private py = (BOTTOM_ROW - 1) * CELL;
  private bullet: { x: number; y: number } | null = null;
  private spider: Spider | null = null;
  private spiderT = 6;
  private flea: Flea | null = null;
  private popups: { x: number; y: number; text: string; t: number }[] = [];
  private sparks: { x: number; y: number; vx: number; vy: number; t: number; color: string }[] = [];
  private restoreQueue: number[] = [];
  private restoreT = 0;
  private nextLife = EXTRA_LIFE_EVERY;
  private segmentsLeftAtDeath = 0;

  constructor(private env: RoundEnv) {
    for (let i = 0; i < 46; i++) {
      const x = Math.floor(rand(1, COLS - 1));
      const y = Math.floor(rand(TOP_ROW + 2, ZONE_TOP));
      this.mushrooms.set(key(x, y), MUSHROOM_HP);
    }
    this.spawnWave();
  }

  private get sound() {
    return this.env.audio;
  }

  private get colors() {
    return WAVE_COLORS[(this.wave - 1) % WAVE_COLORS.length];
  }

  /** Sekunden pro Schritt (eine Zelle) der Raupen. */
  private get stepInterval() {
    return Math.max(0.035, 0.085 - (this.wave - 1) * 0.006);
  }

  update(dt: number): void {
    this.clock += dt;
    this.phaseT += dt;
    this.popups = this.popups.filter((p) => (p.t += dt) < 0.9);
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.t += dt;
    }
    this.sparks = this.sparks.filter((s) => s.t < 0.5);

    switch (this.phase) {
      case 'play':
        this.updatePlayer(dt);
        this.updateBullet(dt);
        this.updateChains(dt);
        this.updateSpider(dt);
        this.updateFlea(dt);
        if (this.phase === 'play' && this.chains.length === 0) {
          sfx.wave(this.sound);
          this.setPhase('wave');
        }
        break;
      case 'dead':
        this.restoreMushrooms(dt);
        if (this.phaseT > 1.5 && this.restoreQueue.length === 0) {
          if (this.lives <= 0) {
            this.over = true;
          } else {
            this.px = W / 2 - 4;
            this.py = (BOTTOM_ROW - 1) * CELL;
            this.chains = [this.newChain(this.segmentsLeftAtDeath, Math.floor(COLS / 2), 1)];
            this.setPhase('play');
          }
        }
        break;
      case 'wave':
        this.updatePlayer(dt);
        this.updateBullet(dt);
        if (this.phaseT > 1.5) {
          this.wave++;
          this.spawnWave();
          this.setPhase('play');
        }
        break;
    }
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  private addScore(n: number, x?: number, y?: number) {
    this.score += n;
    if (x !== undefined && y !== undefined && n >= 100) this.popups.push({ x, y, text: String(n), t: 0 });
    if (this.score >= this.nextLife) {
      this.nextLife += EXTRA_LIFE_EVERY;
      this.lives++;
      sfx.extraLife(this.sound);
    }
  }

  // ---------- Raupen ----------

  private newChain(len: number, x: number, dir: number): Chain {
    // Der Pfad liegt anfangs oberhalb des Feldes, die Glieder laufen nacheinander herein
    const path: Cell[] = [];
    for (let i = 0; i < len; i++) path.push({ x, y: TOP_ROW - 1 - i });
    return { path, len, dir, vdir: 1, stepT: 0 };
  }

  private spawnWave() {
    // Spätere Wellen: kürzere Raupe plus einzelne, schnelle Köpfe
    const extraHeads = Math.min(this.wave - 1, 5);
    this.chains = [this.newChain(12 - extraHeads, Math.floor(COLS / 2), Math.random() < 0.5 ? 1 : -1)];
    for (let i = 0; i < extraHeads; i++) {
      this.chains.push(this.newChain(1, Math.floor(rand(2, COLS - 2)), Math.random() < 0.5 ? 1 : -1));
    }
  }

  private blocked(x: number, y: number): boolean {
    return x < 0 || x >= COLS || (y >= TOP_ROW && this.mushrooms.has(key(x, y)));
  }

  private updateChains(dt: number) {
    for (const ch of this.chains) {
      ch.stepT += dt;
      const interval = this.stepInterval * (ch.len === 1 ? 0.75 : 1);
      while (ch.stepT >= interval) {
        ch.stepT -= interval;
        this.stepChain(ch);
      }
    }
    // Berührt eine Raupe den Spieler?
    for (const ch of this.chains) {
      for (let i = 0; i < ch.len; i++) {
        const p = this.segPos(ch, i);
        if (Math.abs(p.x - this.px) < 7 && Math.abs(p.y - this.py) < 7) return this.die();
      }
    }
  }

  private stepChain(ch: Chain) {
    const head = ch.path[0];
    let next: Cell;
    if (head.y < TOP_ROW) {
      next = { x: head.x, y: head.y + 1 };
    } else if (this.blocked(head.x + ch.dir, head.y)) {
      // Hindernis: eine Reihe runter (bzw. im Spielerbereich auch wieder hoch) und umdrehen
      if (head.y >= BOTTOM_ROW) ch.vdir = -1;
      else if (head.y <= ZONE_TOP && ch.vdir < 0) ch.vdir = 1;
      next = { x: head.x, y: head.y + ch.vdir };
      ch.dir = -ch.dir;
    } else {
      next = { x: head.x + ch.dir, y: head.y };
    }
    ch.path.unshift(next);
    ch.path.length = Math.min(ch.path.length, ch.len + 1);
  }

  /** Pixelposition eines Glieds, weich zwischen zwei Zellen interpoliert. */
  private segPos(ch: Chain, i: number): { x: number; y: number } {
    const f = Math.min(1, ch.stepT / this.stepInterval);
    const a = ch.path[i];
    const b = ch.path[i + 1] ?? a;
    return { x: (b.x + (a.x - b.x) * f) * CELL, y: (b.y + (a.y - b.y) * f) * CELL };
  }

  private hitSegment(ch: Chain, i: number) {
    const cell = ch.path[i];
    const p = this.segPos(ch, i);
    this.addScore(i === 0 ? 100 : 10, p.x + 4, p.y);
    this.burst(p.x + 4, p.y + 4, this.colors[0]);
    sfx.hitSegment(this.sound);
    if (cell.y >= TOP_ROW && cell.y <= BOTTOM_ROW) this.mushrooms.set(key(cell.x, cell.y), MUSHROOM_HP);

    // Raupe teilt sich: hinter dem Treffer entsteht ein neuer Kopf
    const idx = this.chains.indexOf(ch);
    this.chains.splice(idx, 1);
    if (i > 0) this.chains.push({ path: ch.path.slice(0, i + 1), len: i, dir: ch.dir, vdir: ch.vdir, stepT: ch.stepT });
    if (i < ch.len - 1) {
      const tail = ch.path.slice(i + 1);
      const h0 = tail[0];
      const h1 = tail[1] ?? h0;
      const dir = h0.x !== h1.x ? Math.sign(h0.x - h1.x) : -ch.dir;
      this.chains.push({ path: tail, len: ch.len - i - 1, dir, vdir: ch.vdir, stepT: ch.stepT });
    }
  }

  // ---------- Spieler ----------

  private updatePlayer(dt: number) {
    const input = this.env.input;
    const dx = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    const dy = (input.held('down') ? 1 : 0) - (input.held('up') ? 1 : 0);
    // Pilze blockieren den Weg – Achsen getrennt prüfen, damit man daran entlanggleiten kann
    const nx = Math.max(0, Math.min(W - CELL, this.px + dx * PLAYER_SPEED * dt));
    if (!this.mushroomAt(nx, this.py)) this.px = nx;
    const ny = Math.max(ZONE_TOP * CELL, Math.min(BOTTOM_ROW * CELL, this.py + dy * PLAYER_SPEED * dt));
    if (!this.mushroomAt(this.px, ny)) this.py = ny;

    if (input.held('a') && !this.bullet) {
      this.bullet = { x: this.px + 3, y: this.py - 2 };
      sfx.shoot(this.sound);
    }
  }

  private mushroomAt(x: number, y: number): boolean {
    for (const cx of [Math.floor((x + 1) / CELL), Math.floor((x + 6) / CELL)]) {
      for (const cy of [Math.floor((y + 1) / CELL), Math.floor((y + 6) / CELL)]) {
        if (this.mushrooms.has(key(cx, cy))) return true;
      }
    }
    return false;
  }

  private updateBullet(dt: number) {
    const b = this.bullet;
    if (!b) return;
    const steps = Math.ceil((BULLET_SPEED * dt) / 4);
    for (let s = 0; s < steps; s++) {
      b.y -= (BULLET_SPEED * dt) / steps;
      if (b.y < TOP_ROW * CELL) {
        this.bullet = null;
        return;
      }
      const cx = Math.floor((b.x + 1) / CELL);
      const cy = Math.floor(b.y / CELL);
      const k = key(cx, cy);
      const hp = this.mushrooms.get(k);
      if (hp !== undefined) {
        if (hp <= 1) {
          this.mushrooms.delete(k);
          this.addScore(1);
        } else {
          this.mushrooms.set(k, hp - 1);
        }
        sfx.mushroom(this.sound);
        this.bullet = null;
        return;
      }
      for (const ch of this.chains) {
        for (let i = 0; i < ch.len; i++) {
          const p = this.segPos(ch, i);
          if (b.x + 2 > p.x && b.x < p.x + CELL && b.y < p.y + CELL && b.y + 4 > p.y) {
            this.bullet = null;
            this.hitSegment(ch, i);
            return;
          }
        }
      }
      if (this.spider && Math.abs(this.spider.x + 5 - b.x) < 7 && Math.abs(this.spider.y + 4 - b.y) < 6) {
        const dist = Math.abs(this.spider.y - this.py);
        const pts = dist < 16 ? 900 : dist < 32 ? 600 : 300;
        this.addScore(pts, this.spider.x + 5, this.spider.y);
        this.burst(this.spider.x + 5, this.spider.y + 4, C.WHITE);
        sfx.spider(this.sound);
        this.spider = null;
        this.spiderT = rand(4, 8);
        this.bullet = null;
        return;
      }
      if (this.flea && Math.abs(this.flea.x + 4 - b.x) < 6 && Math.abs(this.flea.y + 4 - b.y) < 6) {
        this.flea.hp--;
        if (this.flea.hp <= 0) {
          this.addScore(200, this.flea.x + 4, this.flea.y);
          this.burst(this.flea.x + 4, this.flea.y + 4, C.CYAN);
          sfx.hitSegment(this.sound);
          this.flea = null;
        }
        this.bullet = null;
        return;
      }
    }
  }

  // ---------- Spinne und Floh ----------

  private updateSpider(dt: number) {
    if (!this.spider) {
      this.spiderT -= dt;
      if (this.spiderT <= 0) {
        const left = Math.random() < 0.5;
        this.spider = { x: left ? -10 : W, y: ZONE_TOP * CELL + 8, vx: (left ? 1 : -1) * rand(45, 70), vy: 80, t: 0 };
      }
      return;
    }
    const s = this.spider;
    s.t += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    // Zickzack im Spielerbereich
    if (s.y < (ZONE_TOP - 2) * CELL || s.y > BOTTOM_ROW * CELL) s.vy = -s.vy;
    if (Math.random() < dt * 1.5) s.vy = (Math.random() < 0.5 ? -1 : 1) * rand(50, 110);
    // Frisst Pilze, über die sie läuft
    this.mushrooms.delete(key(Math.floor((s.x + 5) / CELL), Math.floor((s.y + 4) / CELL)));
    if (s.x < -20 || s.x > W + 10) {
      this.spider = null;
      this.spiderT = rand(3, 7);
      return;
    }
    if (Math.abs(s.x + 1 - this.px) < 8 && Math.abs(s.y - this.py) < 7) this.die();
  }

  private updateFlea(dt: number) {
    if (!this.flea) {
      if (this.wave < 2) return;
      let inZone = 0;
      for (const k of this.mushrooms.keys()) if (Math.floor(k / COLS) >= ZONE_TOP) inZone++;
      if (inZone < 5 && Math.random() < dt * 0.5) {
        this.flea = { x: Math.floor(rand(1, COLS - 1)) * CELL, y: TOP_ROW * CELL, hp: 2, lastRow: TOP_ROW };
      }
      return;
    }
    const f = this.flea;
    f.y += (f.hp === 2 ? 110 : 220) * dt;
    const row = Math.floor(f.y / CELL);
    if (row !== f.lastRow) {
      f.lastRow = row;
      if (row < BOTTOM_ROW && Math.random() < 0.3) this.mushrooms.set(key(f.x / CELL, row), MUSHROOM_HP);
    }
    if (f.y > H) this.flea = null;
    else if (Math.abs(f.x - this.px) < 7 && Math.abs(f.y - this.py) < 7) this.die();
  }

  // ---------- Tod und Neustart ----------

  private die() {
    if (this.phase !== 'play') return;
    this.lives--;
    this.segmentsLeftAtDeath = Math.max(1, this.chains.reduce((n, c) => n + c.len, 0));
    this.chains = [];
    this.spider = null;
    this.flea = null;
    this.bullet = null;
    this.burst(this.px + 4, this.py + 4, C.YELLOW);
    this.burst(this.px + 4, this.py + 4, C.RED);
    sfx.die(this.sound);
    // Beschädigte Pilze werden nacheinander repariert (je 5 Punkte)
    this.restoreQueue = [...this.mushrooms.entries()].filter(([, hp]) => hp < MUSHROOM_HP).map(([k]) => k);
    this.restoreT = 0.6;
    this.setPhase('dead');
  }

  private restoreMushrooms(dt: number) {
    this.restoreT -= dt;
    if (this.restoreT > 0 || !this.restoreQueue.length) return;
    this.restoreT = 0.06;
    const k = this.restoreQueue.shift()!;
    this.mushrooms.set(k, MUSHROOM_HP);
    this.addScore(5);
    sfx.restore(this.sound);
  }

  private burst(x: number, y: number, color: string) {
    for (let i = 0; i < 10; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(30, 100);
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, color });
    }
  }

  // ---------- Darstellung ----------

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#05030c';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#0c0818';
    g.fillRect(0, ZONE_TOP * CELL, W, (BOTTOM_ROW - ZONE_TOP + 1) * CELL);

    const [bugColor, shroomColor] = this.colors;
    for (const [k, hp] of this.mushrooms) {
      const x = (k % COLS) * CELL;
      const y = Math.floor(k / COLS) * CELL;
      // Pilz wird mit jedem Treffer kleiner
      const cut = MUSHROOM_HP - hp;
      g.fillStyle = shroomColor;
      g.fillRect(x + 1, y + 1, 6, 4 - Math.min(2, cut));
      g.fillRect(x, y + 2, 8, Math.max(1, 2 - cut));
      g.fillStyle = '#d8d0f0';
      if (cut < 3) g.fillRect(x + 3, y + 5, 2, 3 - Math.max(0, cut - 1));
    }

    for (const ch of this.chains) {
      for (let i = ch.len - 1; i >= 0; i--) {
        const p = this.segPos(ch, i);
        if (p.y < TOP_ROW * CELL - 4) continue;
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        g.fillStyle = bugColor;
        g.fillRect(x + 1, y + 1, 6, 6);
        g.fillRect(x, y + 2, 8, 4);
        // Beinchen
        g.fillStyle = C.alpha(bugColor, 0.6);
        const leg = Math.floor(this.clock * 10 + i) % 2;
        g.fillRect(x + 1, y + (leg ? 7 : 0), 1, 1);
        g.fillRect(x + 6, y + (leg ? 0 : 7), 1, 1);
        if (i === 0) {
          g.fillStyle = C.RED;
          g.fillRect(x + (ch.dir > 0 ? 5 : 1), y + 2, 2, 2);
        }
      }
    }

    if (this.spider) {
      const s = this.spider;
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      const leg = Math.floor(this.clock * 12) % 2;
      g.fillStyle = C.WHITE;
      g.fillRect(x + 3, y + 2, 5, 4);
      g.fillStyle = '#c8c4dc';
      for (const lx of [0, 9]) {
        g.fillRect(x + lx, y + (leg ? 1 : 5), 2, 1);
        g.fillRect(x + lx, y + 3, 2, 1);
      }
      g.fillStyle = C.RED;
      g.fillRect(x + 4, y + 3, 1, 1);
      g.fillRect(x + 6, y + 3, 1, 1);
    }

    if (this.flea) {
      const x = Math.round(this.flea.x);
      const y = Math.round(this.flea.y);
      g.fillStyle = C.CYAN;
      g.fillRect(x + 2, y, 4, 6);
      g.fillRect(x, y + 6, 2, 2);
      g.fillRect(x + 6, y + 6, 2, 2);
    }

    if (this.bullet) {
      g.fillStyle = C.WHITE;
      g.fillRect(Math.round(this.bullet.x), Math.round(this.bullet.y), 2, 5);
    }

    if (this.phase !== 'dead') {
      // Der Gärtner-Blaster
      const x = Math.round(this.px);
      const y = Math.round(this.py);
      g.fillStyle = C.YELLOW;
      g.fillRect(x + 2, y + 2, 4, 6);
      g.fillRect(x, y + 5, 8, 3);
      g.fillStyle = C.WHITE;
      g.fillRect(x + 3, y, 2, 3);
    }

    for (const s of this.sparks) {
      g.fillStyle = s.color;
      g.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
    }
    for (const p of this.popups) drawText(g, p.text, p.x, p.y - p.t * 12, { color: C.WHITE, align: 'center' });

    drawText(g, pad(this.score), 8, 4, { color: C.WHITE });
    drawText(g, `HI ${pad(Math.max(this.env.hiScore, this.score))}`, W / 2, 4, { color: C.YELLOW, align: 'center' });
    for (let i = 0; i < Math.min(this.lives, 6); i++) {
      g.fillStyle = C.YELLOW;
      g.fillRect(W - 12 - i * 10, 5, 6, 5);
    }
    drawText(g, `WAVE ${this.wave}`, W - 80, 4, { color: C.CYAN, align: 'right' });
    drawText(g, 'ESC = HALL', W - 8, H - 9, { color: '#3e3566', align: 'right' });

    if (this.phase === 'wave') {
      drawText(g, 'WAVE CLEARED!', W / 2, 110, { scale: 2, color: bugColor, align: 'center', glow: true });
    }
  }
}
