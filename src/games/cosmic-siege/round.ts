import type { Sprite } from '../../engine/draw';
import { drawText } from '../../engine/font';
import * as C from '../../engine/palette';
import type { Round, RoundEnv } from '../../engine/shell';
import { DEAD_LOOP, type LoopHandle } from '../../engine/sound';
import { SCREEN_H as H, SCREEN_W as W } from '../../engine/types';
import { sfx } from './sfx';
import { Shield, SHIELD_W } from './shield';
import { ALIEN_H, ALIEN_W, SPR } from './sprites';

const COLS = 11;
const ROWS = 5;
const ROW_TYPES = [0, 1, 1, 2, 2];
const POINTS = [30, 20, 10];
const CELL_W = 18;
const CELL_H = 16;
const FORM_TOP = 44;
const STEP_X = 3;
const STEP_Y = 8;
const MARGIN = 8;

const UFO_Y = 20;
const UFO_W = 16;
const UFO_H = 7;
const UFO_SPEED = 55;
/** Wer mitzählt, kann die 300 Punkte gezielt abholen – wie beim Vorbild. */
const UFO_POINTS = [100, 50, 50, 100, 150, 100, 100, 50, 300, 100, 100, 100, 50, 150, 100];

const SHIELD_Y = 210;
const PLAYER_Y = 236;
const PLAYER_W = 13;
const PLAYER_SPEED = 100;
const SHOT_SPEED = 300;
const SHOT_H = 4;
const TOP_LIMIT = 14;
const GROUND_Y = 250;
const EXTRA_LIFE_AT = 1500;

type Phase = 'ready' | 'play' | 'dying' | 'cleared';

interface Alien {
  col: number;
  row: number;
  type: number;
  alive: boolean;
}

interface Bomb {
  x: number;
  y: number;
  speed: number;
  kind: number;
  t: number;
}

interface Effect {
  x: number;
  y: number;
  t: number;
  life: number;
  sprite?: Sprite;
  text?: string;
  color?: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pad = (n: number) => String(n).padStart(5, '0');

export class CosmicSiegeRound implements Round {
  score = 0;
  over = false;

  private lives = 3;
  private wave = 1;
  private phase: Phase = 'ready';
  private phaseT = 0;
  private clock = 0;

  private px = (W - PLAYER_W) / 2;
  private shot: { x: number; y: number } | null = null;
  private shotsFired = 0;
  private bombs: Bomb[] = [];
  private bombT = 0;

  private aliens: Alien[] = [];
  private fx = 0;
  private fy = 0;
  private dir = 1;
  private frame = 0;
  private stepT = 0;
  private marchStep = 0;
  private lastMarch = 0;

  private ufo: { x: number; dir: number } | null = null;
  private ufoT = 0;
  private ufoHum: LoopHandle = DEAD_LOOP;

  private shields: Shield[] = [];
  private effects: Effect[] = [];
  private extraLifeGiven = false;
  private stars = Array.from({ length: 50 }, () => ({
    x: Math.floor(rand(0, W)),
    y: Math.floor(rand(16, GROUND_Y)),
    color: Math.random() < 0.3 ? '#3a3360' : '#221e3a',
  }));

  constructor(private env: RoundEnv) {
    this.setupWave();
  }

  private get input() {
    return this.env.input;
  }

  private get sound() {
    return this.env.audio;
  }

  update(dt: number): void {
    this.clock += dt;
    this.phaseT += dt;
    this.effects = this.effects.filter((e) => (e.t += dt) < e.life);

    switch (this.phase) {
      case 'ready':
        this.updatePlayer(dt, false);
        if (this.phaseT > 1.8) this.setPhase('play');
        break;
      case 'play':
        this.updatePlayer(dt, true);
        this.updateShot(dt);
        if (this.phase !== 'play') break;
        this.updateFormation(dt);
        if (this.phase !== 'play') break;
        this.updateBombs(dt);
        if (this.phase !== 'play') break;
        this.updateUfo(dt);
        break;
      case 'dying':
        if (this.phaseT > 1.6 && !this.over) {
          this.lives--;
          if (this.lives <= 0) {
            this.over = true;
          } else {
            this.px = (W - PLAYER_W) / 2;
            this.setPhase('ready');
          }
        }
        break;
      case 'cleared':
        if (this.phaseT > 2.4) {
          this.wave++;
          this.setupWave();
        }
        break;
    }

    // Heulton, solange das UFO fliegt
    const wantHum = !!this.ufo && this.phase === 'play';
    if (wantHum && !this.ufoHum.alive) {
      this.ufoHum = this.sound.loop({ type: 'sawtooth', freq: 690, vol: 0.035, lfo: { rate: 7, depth: 90 } });
    } else if (!wantHum && this.ufoHum.alive) {
      this.ufoHum.stop();
    }
  }

  // ---------- Ablauf ----------

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  private setupWave() {
    this.aliens = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) this.aliens.push({ col, row, type: ROW_TYPES[row], alive: true });
    }
    this.fx = Math.round((W - COLS * CELL_W) / 2);
    // Spätere Wellen starten etwas tiefer
    this.fy = FORM_TOP + Math.min(this.wave - 1, 5) * 8;
    this.dir = 1;
    this.frame = 0;
    this.stepT = 0.5;
    this.shields = [0, 1, 2, 3].map((i) => new Shield(Math.round((W * (i + 1)) / 5 - SHIELD_W / 2), SHIELD_Y, C.ORANGE));
    this.bombs = [];
    this.shot = null;
    this.ufo = null;
    this.ufoT = rand(15, 25);
    this.bombT = 1.5;
    this.setPhase('ready');
  }

  private die() {
    this.shot = null;
    this.bombs = [];
    this.ufo = null;
    sfx.playerDeath(this.sound);
    this.setPhase('dying');
  }

  private addScore(n: number) {
    this.score += n;
    if (!this.extraLifeGiven && this.score >= EXTRA_LIFE_AT) {
      this.extraLifeGiven = true;
      this.lives++;
      sfx.extraLife(this.sound);
      this.effects.push({ x: W / 2, y: 228, t: 0, life: 2, text: 'EXTRA LIFE!', color: C.GREEN });
    }
  }

  // ---------- Spieler ----------

  private updatePlayer(dt: number, canFire: boolean) {
    const dx = (this.input.held('right') ? 1 : 0) - (this.input.held('left') ? 1 : 0);
    this.px = Math.max(MARGIN, Math.min(W - MARGIN - PLAYER_W, this.px + dx * PLAYER_SPEED * dt));
    // Halten genügt: es fliegt immer nur ein Schuss gleichzeitig
    if (canFire && !this.shot && this.input.held('a')) {
      this.shot = { x: Math.round(this.px) + (PLAYER_W >> 1), y: PLAYER_Y - SHOT_H };
      this.shotsFired++;
      sfx.shoot(this.sound);
    }
  }

  private updateShot(dt: number) {
    const s = this.shot;
    if (!s) return;
    const steps = Math.max(1, Math.round(SHOT_SPEED * dt));
    for (let i = 0; i < steps; i++) {
      s.y--;
      if (this.shieldHit(s.x, s.y)) {
        this.shot = null;
        return;
      }
      if (s.y <= TOP_LIMIT) {
        this.effects.push({ x: s.x - 3, y: s.y, t: 0, life: 0.2, sprite: SPR.splat });
        this.shot = null;
        return;
      }
    }

    const r = { x: s.x, y: s.y, w: 1, h: SHOT_H + steps };
    for (const a of this.aliens) {
      if (a.alive && overlap(r, this.alienRect(a))) {
        this.killAlien(a);
        this.shot = null;
        return;
      }
    }
    if (this.ufo && overlap(r, { x: this.ufo.x, y: UFO_Y, w: UFO_W, h: UFO_H })) {
      this.hitUfo();
      this.shot = null;
      return;
    }
    const wide = { x: s.x - 1, y: s.y, w: 3, h: SHOT_H + steps };
    const i = this.bombs.findIndex((b) => overlap(wide, { x: b.x - 1, y: b.y, w: 3, h: 7 }));
    if (i >= 0) {
      const b = this.bombs[i];
      this.bombs.splice(i, 1);
      this.effects.push({ x: b.x - 3, y: b.y, t: 0, life: 0.2, sprite: SPR.splat });
      sfx.bombHit(this.sound);
      this.shot = null;
    }
  }

  private shieldHit(x: number, y: number): boolean {
    return this.shields.some((sh) => sh.hit(x, y));
  }

  // ---------- Aliens ----------

  private alienRect(a: Alien): Rect {
    const w = ALIEN_W[a.type];
    return { x: this.fx + a.col * CELL_W + ((CELL_W - w) >> 1), y: this.fy + a.row * CELL_H, w, h: ALIEN_H };
  }

  private killAlien(a: Alien) {
    a.alive = false;
    const r = this.alienRect(a);
    this.addScore(POINTS[a.type]);
    this.effects.push({ x: r.x + (r.w >> 1) - 6, y: r.y, t: 0, life: 0.3, sprite: SPR.booms[a.type] });
    sfx.alienHit(this.sound);
  }

  private updateFormation(dt: number) {
    const alive = this.aliens.filter((a) => a.alive);
    if (!alive.length) {
      this.shot = null;
      this.bombs = [];
      this.ufo = null;
      sfx.waveClear(this.sound);
      this.setPhase('cleared');
      return;
    }

    this.stepT -= dt;
    if (this.stepT > 0) return;
    // Je weniger Aliens, desto schneller – und jede Welle startet etwas flotter
    const slow = Math.max(0.3, 0.55 - (this.wave - 1) * 0.04);
    this.stepT = 0.035 + (slow - 0.035) * Math.pow(alive.length / this.aliens.length, 1.5);

    let minX = Infinity;
    let maxX = -Infinity;
    for (const a of alive) {
      const r = this.alienRect(a);
      minX = Math.min(minX, r.x);
      maxX = Math.max(maxX, r.x + r.w);
    }
    if ((this.dir > 0 && maxX + STEP_X > W - MARGIN) || (this.dir < 0 && minX - STEP_X < MARGIN)) {
      this.fy += STEP_Y;
      this.dir = -this.dir;
    } else {
      this.fx += STEP_X * this.dir;
    }
    this.frame ^= 1;

    if (this.clock - this.lastMarch > 0.07) {
      sfx.march(this.sound, this.marchStep++);
      this.lastMarch = this.clock;
    }

    let bottom = 0;
    for (const a of alive) {
      const r = this.alienRect(a);
      bottom = Math.max(bottom, r.y + r.h);
      for (const sh of this.shields) sh.erase(r.x, r.y, r.w, r.h);
    }
    // Gelandet → Invasion, sofort Game Over
    if (bottom >= PLAYER_Y) {
      this.lives = 1;
      this.die();
    }
  }

  // ---------- Bomben ----------

  private updateBombs(dt: number) {
    this.bombT -= dt;
    const maxBombs = Math.min(2 + Math.floor(this.wave / 2), 5);
    if (this.bombT <= 0 && this.bombs.length < maxBombs) {
      this.dropBomb();
      this.bombT = rand(0.5, 1.3) * Math.max(0.45, 1 - (this.wave - 1) * 0.08);
    }

    const player = { x: this.px + 1, y: PLAYER_Y + 1, w: PLAYER_W - 2, h: 7 };
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.t += dt;
      const ny = b.y + b.speed * dt;
      let gone = false;
      for (let y = Math.floor(b.y) + 1; y <= Math.floor(ny) && !gone; y++) {
        if (this.shieldHit(b.x, y + 6)) gone = true;
      }
      b.y = ny;
      if (!gone && overlap(player, { x: b.x - 1, y: b.y, w: 3, h: 7 })) {
        this.die();
        return;
      }
      if (!gone && b.y + 7 >= GROUND_Y) {
        gone = true;
        this.effects.push({ x: b.x - 3, y: GROUND_Y - 6, t: 0, life: 0.25, sprite: SPR.splatGround });
      }
      if (gone) this.bombs.splice(i, 1);
    }
  }

  private dropBomb() {
    // Nur das unterste Alien jeder Spalte kann werfen
    const bottoms = new Map<number, Alien>();
    for (const a of this.aliens) {
      if (!a.alive) continue;
      const cur = bottoms.get(a.col);
      if (!cur || a.row > cur.row) bottoms.set(a.col, a);
    }
    const shooters = [...bottoms.values()];
    if (!shooters.length) return;

    const center = (a: Alien) => {
      const r = this.alienRect(a);
      return r.x + r.w / 2;
    };
    let shooter: Alien;
    if (Math.random() < 0.4) {
      const pc = this.px + PLAYER_W / 2;
      shooter = shooters.reduce((best, a) => (Math.abs(center(a) - pc) < Math.abs(center(best) - pc) ? a : best));
    } else {
      shooter = shooters[Math.floor(Math.random() * shooters.length)];
    }
    const r = this.alienRect(shooter);
    this.bombs.push({
      x: r.x + (r.w >> 1),
      y: r.y + r.h,
      speed: Math.min(170, 95 + this.wave * 8),
      kind: Math.random() < 0.5 ? 0 : 1,
      t: 0,
    });
  }

  // ---------- UFO ----------

  private updateUfo(dt: number) {
    if (!this.ufo) {
      this.ufoT -= dt;
      if (this.ufoT <= 0) {
        this.ufoT = rand(18, 28);
        if (this.aliens.filter((a) => a.alive).length > 7) {
          const dir = Math.random() < 0.5 ? 1 : -1;
          this.ufo = { x: dir > 0 ? -UFO_W : W, dir };
        }
      }
      return;
    }
    const u = this.ufo;
    u.x += u.dir * UFO_SPEED * dt;
    if (u.x < -UFO_W - 2 || u.x > W + 2) this.ufo = null;
  }

  private hitUfo() {
    const u = this.ufo!;
    const pts = UFO_POINTS[(this.shotsFired - 1) % UFO_POINTS.length];
    this.addScore(pts);
    this.effects.push({ x: u.x + 1, y: UFO_Y - 1, t: 0, life: 0.3, sprite: SPR.ufoBoom });
    this.effects.push({ x: u.x + UFO_W / 2, y: UFO_Y, t: 0, life: 1.5, text: String(pts), color: C.RED });
    sfx.ufoHit(this.sound);
    this.ufo = null;
    this.ufoT = rand(18, 28);
  }

  // ---------- Darstellung ----------

  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = C.BLACK;
    g.fillRect(0, 0, W, H);
    for (const s of this.stars) {
      g.fillStyle = s.color;
      g.fillRect(s.x, s.y, 1, 1);
    }

    drawText(g, 'SCORE', 8, 4, { color: C.DIM });
    drawText(g, pad(this.score), 44, 4, { color: C.WHITE });
    drawText(g, `HI ${pad(Math.max(this.env.hiScore, this.score))}`, W / 2, 4, { color: C.YELLOW, align: 'center' });
    drawText(g, `WAVE ${this.wave}`, W - 8, 4, { color: C.CYAN, align: 'right' });

    if (this.ufo) g.drawImage(SPR.ufo, Math.round(this.ufo.x), UFO_Y);

    for (const a of this.aliens) {
      if (!a.alive) continue;
      const r = this.alienRect(a);
      g.drawImage(SPR.aliens[a.type][this.frame], r.x, r.y);
    }

    for (const sh of this.shields) sh.render(g);

    const px = Math.round(this.px);
    if (this.phase === 'dying') {
      if (this.phaseT < 1.2) g.drawImage(SPR.playerDeath[Math.floor(this.phaseT * 10) % 2], px, PLAYER_Y);
    } else {
      g.drawImage(SPR.player, px, PLAYER_Y);
    }

    if (this.shot) {
      g.fillStyle = C.WHITE;
      g.fillRect(this.shot.x, this.shot.y, 1, SHOT_H);
    }
    for (const b of this.bombs) {
      g.drawImage(SPR.bombs[b.kind][Math.floor(b.t * 10) % 2], b.x - 1, Math.round(b.y));
    }

    for (const e of this.effects) {
      if (e.sprite) g.drawImage(e.sprite, Math.round(e.x), Math.round(e.y));
      else if (e.text) drawText(g, e.text, e.x, e.y, { color: e.color, align: 'center' });
    }

    g.fillStyle = C.GREEN;
    g.fillRect(0, GROUND_Y, W, 1);
    drawText(g, 'LIVES', 8, GROUND_Y + 8, { color: C.DIM });
    for (let i = 0; i < Math.min(this.lives, 8); i++) g.drawImage(SPR.player, 44 + i * 17, GROUND_Y + 7);
    drawText(g, 'ESC = HALL', W - 8, H - 12, { color: '#3e3566', align: 'right' });

    if (this.phase === 'ready') {
      this.message(g, `WAVE ${this.wave}`, C.CYAN, 'GET READY');
    } else if (this.phase === 'cleared') {
      this.message(g, 'WAVE CLEARED!', C.GREEN, `NEXT: WAVE ${this.wave + 1}`);
    }
  }

  private message(g: CanvasRenderingContext2D, text: string, color: string, sub: string) {
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(0, 172, W, 34);
    drawText(g, text, W / 2, 176, { scale: 2, color, align: 'center', glow: true });
    drawText(g, sub, W / 2, 195, { color: C.YELLOW, align: 'center' });
  }
}
