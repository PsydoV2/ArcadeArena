import { fillCircle, RES, strokeRect, useHiRes } from '../engine/draw';
import { drawText, textWidth } from '../engine/font';
import { ScoreBoard, type ScoreEntry } from '../engine/highscores';
import type { Input } from '../engine/input';
import type { Music } from '../engine/music';
import * as C from '../engine/palette';
import { sfx } from '../engine/sfx';
import { toggleFullscreen } from '../engine/screen';
import { DEAD_LOOP, type LoopHandle, type Sound } from '../engine/sound';
import { SCREEN_H as H, SCREEN_W as W, type CabinetInfo } from '../engine/types';
import { RECORDS } from './records';

/** Kachelgröße der Halle. */
const T = 16;
const MAP_W = 28;
const PER_ROW = 6;
const FIRST_COL = 5;
const COL_STEP = 3;
const ROW_STEP = 7;
const CAB_W = 30;
const CAB_H = 46;
const WALK_SPEED = 74;
const PANEL_Y = 216;
const DOOR_COLS = [13, 14];

const BODY = '#1b1233';

export interface HallEnv {
  g: CanvasRenderingContext2D;
  input: Input;
  sound: Sound;
  /** Plattenspieler am DJ-Pult (fehlt auf der Landingpage). */
  music?: Music;
}

export interface HallOptions {
  /** Landingpage: die Figur läuft von selbst von Automat zu Automat. */
  demo?: boolean;
  /** Durch die Tür hinausgehen (z. B. zurück zur Startseite). */
  onLeave?: () => void;
}

/** Ein aufgestellter Automat. */
interface Spot {
  info: CabinetInfo;
  index: number;
  /** Linke obere Kachel der Standfläche (2×2 Kacheln). */
  tx: number;
  ty: number;
  /** Linke obere Ecke des Sprites in Pixeln. */
  x: number;
  y: number;
  /** Kleiner Bildschirm mit der Demo (80×36). */
  screen: HTMLCanvasElement;
}

/** Etwas, das nach Tiefe sortiert gezeichnet wird (Einrichtung, Automaten, Figur). */
interface Drawable {
  baseline: number;
  draw: (g: CanvasRenderingContext2D) => void;
}

interface Point {
  x: number;
  y: number;
}

/** DJ-Pult mit Plattenspieler, gegenüber der Preistheke. */
const DECK_W = 6;

const DIRS = { down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/** Die begehbare Spielhalle (Draufsicht): zu einem Automaten laufen und Enter drücken. */
export class Hall {
  private t = 0;
  private toast: { text: string; t: number } | null = null;
  private best: (ScoreEntry | undefined)[] = [];
  private hum: LoopHandle = DEAD_LOOP;
  private blipT = 2;

  private mapH: number;
  private solid: boolean[][];
  private spots: Spot[];
  private props: Drawable[] = [];
  private floor: HTMLCanvasElement;

  /** Füße der Figur in Weltkoordinaten. */
  private player: Point;
  private face = DIRS.up;
  private walking = false;
  private stepT = 0;
  private path: Point[] = [];
  private pending: Spot | 'deck' | null = null;
  private idleT = 0;
  private cam: Point = { x: 0, y: 0 };
  private near: Spot | null = null;
  private atDoor = false;
  private hover: Spot | null = null;
  private deck = { tx: 0, ty: 0 };
  private nearDeck = false;
  private hoverDeck = false;
  private shownRecord = -1;

  constructor(
    private cabinets: CabinetInfo[],
    private env: HallEnv,
    private onLaunch: (c: CabinetInfo) => void,
    private opts: HallOptions = {},
  ) {
    const rows = Math.max(1, Math.ceil(cabinets.length / PER_ROW));
    this.mapH = 2 + rows * ROW_STEP + 6;
    this.solid = Array.from({ length: this.mapH }, () => Array(MAP_W).fill(false));
    this.spots = cabinets.map((info, index) => {
      const tx = FIRST_COL + (index % PER_ROW) * COL_STEP;
      const ty = 2 + Math.floor(index / PER_ROW) * ROW_STEP;
      const screen = document.createElement('canvas');
      screen.width = 80 * RES;
      screen.height = 36 * RES;
      useHiRes(screen.getContext('2d')!);
      return { info, index, tx, ty, x: tx * T + 1, y: (ty + 2) * T - CAB_H, screen };
    });
    this.buildWalls();
    this.buildProps();
    this.floor = this.renderFloor();
    this.player = { x: (DOOR_COLS[0] + 1) * T, y: (this.mapH - 3) * T + 8 };
    this.cam = this.camTarget();
    this.resume();
  }

  /** Nach der Rückkehr aus einem Spiel: Highscores neu einlesen. */
  resume(): void {
    this.best = this.cabinets.map((c) => new ScoreBoard(c.id).list()[0]);
    this.path = [];
    this.pending = null;
  }

  /** Figur direkt vor einen Automaten stellen (Startlink /play/?game=<id>). */
  standAt(id: string): void {
    const s = this.spots.find((spot) => spot.info.id === id);
    if (!s) return;
    this.player = this.frontOf(s);
    this.face = DIRS.up;
    this.cam = this.camTarget();
  }

  // ---------- Aufbau ----------

  private block(tx: number, ty: number, w: number, h: number) {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (this.solid[y]) this.solid[y][x] = true;
  }

  private buildWalls() {
    this.block(0, 0, MAP_W, 2);
    this.block(0, 0, 1, this.mapH);
    this.block(MAP_W - 1, 0, 1, this.mapH);
    this.block(0, this.mapH - 1, MAP_W, 1);
    // Tür unten in der Mitte bleibt offen
    for (const c of DOOR_COLS) this.solid[this.mapH - 1][c] = false;
    for (const s of this.spots) this.block(s.tx, s.ty, 2, 2);
  }

  private buildProps() {
    const bottom = this.mapH - 1;
    // Wechselautomat und Snackautomat an der Rückwand
    this.addProp(1, 2, 2, 2, (g, x, y) => this.drawChanger(g, x, y));
    this.addProp(MAP_W - 3, 2, 2, 2, (g, x, y) => this.drawSnacks(g, x, y));
    // Preistheke links unten, Sofa rechts unten, Pflanzen
    this.addProp(2, bottom - 5, 6, 2, (g, x, y) => this.drawCounter(g, x, y));
    this.addProp(MAP_W - 8, bottom - 2, 5, 1, (g, x, y) => this.drawSofa(g, x, y));
    this.deck = { tx: MAP_W - 2 - DECK_W, ty: bottom - 5 };
    this.addProp(this.deck.tx, this.deck.ty, DECK_W, 2, (g, x, y) => this.drawDeck(g, x, y));
    for (const tx of [1, MAP_W - 2, DOOR_COLS[0] - 3, DOOR_COLS[1] + 3]) {
      this.addProp(tx, bottom - 1, 1, 1, (g, x, y) => this.drawPlant(g, x, y));
    }
  }

  private addProp(tx: number, ty: number, w: number, h: number, draw: (g: CanvasRenderingContext2D, x: number, y: number) => void) {
    this.block(tx, ty, w, h);
    const x = tx * T;
    const y = ty * T;
    this.props.push({ baseline: (ty + h) * T, draw: (g) => draw(g, x, y) });
  }

  private get mapPxW() {
    return MAP_W * T;
  }

  private get mapPxH() {
    return this.mapH * T;
  }

  // ---------- Aktualisieren ----------

  update(dt: number): void {
    const { input, sound } = this.env;
    this.t += dt;
    if (this.toast && (this.toast.t -= dt) <= 0) this.toast = null;

    this.handleMouse();
    this.move(dt);
    this.findNear();

    // Zum angeklickten Automaten gelaufen? Dann gleich starten.
    if (this.pending && !this.path.length) {
      if (this.pending === 'deck') {
        if (this.nearDeck) this.useDeck();
      } else if (this.near === this.pending) {
        this.launch(this.pending);
      }
      this.pending = null;
    }

    if (!this.opts.demo && (input.pressed('start') || input.pressed('a'))) {
      if (this.near) this.launch(this.near);
      else if (this.nearDeck) this.useDeck();
      else if (this.atDoor && this.opts.onLeave) this.opts.onLeave();
    }
    if (!this.opts.demo && this.nearDeck && input.pressed('b') && this.env.music?.playing) {
      this.env.music.stop();
      sfx.blip(sound);
      this.say('MUSIC OFF');
    }
    this.announceRecord();

    if (input.keyPressed('KeyM')) {
      const muted = sound.toggleMute();
      if (!muted) sfx.blip(sound);
      this.say(muted ? 'SOUND OFF' : 'SOUND ON');
    }
    if (input.keyPressed('KeyF')) toggleFullscreen();
    const notice = input.takePadNotice();
    if (notice) {
      sfx.confirm(sound);
      this.say(notice);
    }

    const target = this.camTarget();
    const k = Math.min(1, dt * 6);
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
    this.updateAmbience(dt);
  }

  private move(dt: number) {
    const input = this.env.input;
    let dx = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    let dy = (input.held('down') ? 1 : 0) - (input.held('up') ? 1 : 0);

    if (dx || dy) {
      // Tastatur hat Vorrang vor einem angeklickten Ziel
      this.path = [];
      this.pending = null;
    } else if (this.path.length) {
      const next = this.path[0];
      const ex = next.x - this.player.x;
      const ey = next.y - this.player.y;
      if (Math.hypot(ex, ey) < 2) {
        this.path.shift();
      } else {
        dx = Math.abs(ex) > 1 ? Math.sign(ex) : 0;
        dy = Math.abs(ey) > 1 ? Math.sign(ey) : 0;
      }
    } else if (this.opts.demo) {
      this.idleT += dt;
      if (this.idleT > 2.5) {
        this.idleT = 0;
        const s = this.spots[Math.floor(Math.random() * this.spots.length)];
        this.walkTo(this.frontOf(s));
      }
    }

    this.walking = !!(dx || dy);
    if (!this.walking) return;
    if (dx) this.face = dx > 0 ? DIRS.right : DIRS.left;
    else this.face = dy > 0 ? DIRS.down : DIRS.up;

    const step = (WALK_SPEED * dt) / Math.hypot(dx, dy);
    const nx = this.player.x + dx * step;
    if (this.free(nx, this.player.y)) this.player.x = nx;
    const ny = this.player.y + dy * step;
    if (this.free(this.player.x, ny)) this.player.y = ny;

    this.stepT -= dt;
    if (this.stepT <= 0) {
      this.stepT = 0.28;
      this.env.sound.tone({ freq: 110, dur: 0.03, type: 'triangle', vol: 0.06, jitter: 0.1 });
    }
  }

  /** Passt die Figur (Füße als kleine Box) an diese Stelle? */
  private free(x: number, y: number): boolean {
    for (const px of [x - 5, x + 5]) {
      for (const py of [y - 4, y]) {
        const tx = Math.floor(px / T);
        const ty = Math.floor(py / T);
        if (ty < 0 || ty >= this.mapH || tx < 0 || tx >= MAP_W || this.solid[ty][tx]) return false;
      }
    }
    return true;
  }

  private frontOf(s: Spot): Point {
    return { x: (s.tx + 1) * T, y: (s.ty + 2) * T + 10 };
  }

  private findNear() {
    const p = this.player;
    let best: Spot | null = null;
    let bestD = Infinity;
    for (const s of this.spots) {
      const dx = Math.abs(p.x - this.frontOf(s).x);
      if (dx <= 17 && p.y >= (s.ty + 2) * T && p.y <= (s.ty + 2) * T + 22 && dx < bestD) {
        best = s;
        bestD = dx;
      }
    }
    if (best && best !== this.near && !this.opts.demo) sfx.blip(this.env.sound);
    this.near = best;
    const d = this.deckFront();
    const atDeck = !best && Math.abs(p.x - d.x) <= 40 && p.y >= d.y - 10 && p.y <= d.y + 12;
    if (atDeck && !this.nearDeck && !this.opts.demo) sfx.blip(this.env.sound);
    this.nearDeck = atDeck;
    this.atDoor = p.y >= (this.mapH - 2) * T && DOOR_COLS.includes(Math.floor(p.x / T));
  }

  // ---------- Maus und Wegfindung ----------

  private handleMouse() {
    if (this.opts.demo) return;
    const { mouse } = this.env.input;
    const wx = mouse.x + Math.round(this.cam.x);
    const wy = mouse.y + Math.round(this.cam.y);
    this.hover = this.spots.find((s) => wx >= s.x && wx < s.x + CAB_W && wy >= s.y && wy < s.y + CAB_H) ?? null;
    const dx = this.deck.tx * T;
    const dy = this.deck.ty * T;
    this.hoverDeck = !this.hover && wx >= dx && wx < dx + DECK_W * T && wy >= dy - 12 && wy < dy + 2 * T;
    this.env.g.canvas.style.cursor = this.hover || this.hoverDeck ? 'pointer' : 'default';
    if (!mouse.clicked) return;
    if (this.hoverDeck) {
      if (this.nearDeck) {
        this.useDeck();
      } else {
        this.walkTo(this.deckFront());
        this.pending = 'deck';
      }
    } else if (this.hover) {
      if (this.near === this.hover) {
        this.launch(this.hover);
      } else {
        this.walkTo(this.frontOf(this.hover));
        this.pending = this.hover;
      }
    } else if (mouse.y < (this.near || this.nearDeck ? PANEL_Y : H)) {
      this.walkTo({ x: wx, y: wy });
      this.pending = null;
    }
  }

  /** Breitensuche über die Kacheln, danach als Wegpunkte (Kachelmitten) ablaufen. */
  private walkTo(target: Point) {
    const start = { x: Math.floor(this.player.x / T), y: Math.floor((this.player.y - 2) / T) };
    const goal = { x: Math.floor(target.x / T), y: Math.floor((target.y - 2) / T) };
    if (goal.y < 0 || goal.y >= this.mapH || goal.x < 0 || goal.x >= MAP_W || this.solid[goal.y][goal.x]) return;
    const id = (x: number, y: number) => y * MAP_W + x;
    const prev = new Map<number, number>([[id(start.x, start.y), -1]]);
    const queue = [start];
    while (queue.length) {
      const c = queue.shift()!;
      if (c.x === goal.x && c.y === goal.y) break;
      for (const d of Object.values(DIRS)) {
        const n = { x: c.x + d.x, y: c.y + d.y };
        if (n.y < 0 || n.y >= this.mapH || n.x < 0 || n.x >= MAP_W || this.solid[n.y][n.x] || prev.has(id(n.x, n.y))) continue;
        prev.set(id(n.x, n.y), id(c.x, c.y));
        queue.push(n);
      }
    }
    if (!prev.has(id(goal.x, goal.y))) return;
    const path: Point[] = [];
    for (let cur = id(goal.x, goal.y); cur !== id(start.x, start.y) && cur >= 0; cur = prev.get(cur)!) {
      path.unshift({ x: (cur % MAP_W) * T + T / 2, y: Math.floor(cur / MAP_W) * T + 10 });
    }
    // Der letzte Wegpunkt ist das genaue Ziel
    path.push({ x: target.x, y: target.y });
    this.path = path;
  }

  private launch(s: Spot) {
    if (this.opts.demo) return;
    if (!s.info.create) {
      sfx.buzz(this.env.sound);
      this.say(`${s.info.title} - COMING SOON`);
      return;
    }
    this.face = DIRS.up;
    sfx.confirm(this.env.sound);
    this.onLaunch(s.info);
  }

  private deckFront(): Point {
    return { x: (this.deck.tx + DECK_W / 2) * T, y: (this.deck.ty + 2) * T + 10 };
  }

  /** Enter am DJ-Pult: Platte auflegen bzw. die nächste. */
  private useDeck() {
    const music = this.env.music;
    if (!music || this.opts.demo) return;
    this.face = DIRS.up;
    if (music.playing) music.next();
    else music.play();
    this.shownRecord = -1;
  }

  /** Neue Platte (auch wenn sie von selbst wechselt) kurz oben einblenden. */
  private announceRecord() {
    const music = this.env.music;
    if (!music?.playing) {
      this.shownRecord = -1;
      return;
    }
    if (music.index === this.shownRecord) return;
    this.shownRecord = music.index;
    this.say(`♪ ${music.current.title} ♪`);
  }

  private say(text: string) {
    this.toast = { text, t: 2 };
  }

  private camTarget(): Point {
    // Unten bleibt Platz für Infofeld bzw. Hinweisleiste
    const viewH = this.near || this.nearDeck ? PANEL_Y : H - 16;
    const x = Math.max(0, Math.min(this.mapPxW - W, this.player.x - W / 2));
    const y = Math.max(0, Math.min(this.mapPxH - viewH, this.player.y - viewH / 2 - 10));
    return { x, y };
  }

  /** Leises Gemurmel der Halle und ab und zu ein Piepen von anderen Automaten. */
  private updateAmbience(dt: number) {
    const { sound } = this.env;
    if (!this.hum.alive) this.hum = sound.loop({ noise: true, freq: 180, vol: 0.05 });
    this.blipT -= dt;
    // Läuft eine Platte, passen die zufälligen Piepser nicht dazu
    if (this.blipT > 0 || this.env.music?.playing) return;
    this.blipT = 0.6 + Math.random() * 2.2;
    const notes = [262, 294, 330, 392, 440, 523, 587, 659, 784];
    const pick = <V>(xs: V[]) => xs[Math.floor(Math.random() * xs.length)];
    const vol = 0.012 + Math.random() * 0.015;
    const type = pick<OscillatorType>(['square', 'triangle']);
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      sound.tone({ freq: pick(notes), dur: 0.06 + Math.random() * 0.1, type, vol, delay: i * 0.09 });
    }
  }

  // ---------- Zeichnen ----------

  render(): void {
    const g = this.env.g;
    g.fillStyle = '#05030a';
    g.fillRect(0, 0, W, H);

    const cx = Math.round(this.cam.x);
    const cy = Math.round(this.cam.y);
    g.save();
    g.translate(-cx, -cy);
    g.drawImage(this.floor, 0, 0, this.mapPxW, this.mapPxH);
    this.drawSign(g);

    // Lichtkegel vor dem Automaten, an dem man steht
    const lit = this.near ?? this.hover;
    if (lit) {
      g.fillStyle = C.alpha(lit.info.color, 0.16);
      const f = this.frontOf(lit);
      for (let k = 0; k < 12; k++) g.fillRect(f.x - 20 + k, f.y - 10 + k * 1.5, 40 - k * 2, 1.5);
    } else if (this.nearDeck || this.hoverDeck) {
      g.fillStyle = C.alpha(this.deckColor, 0.16);
      const f = this.deckFront();
      for (let k = 0; k < 12; k++) g.fillRect(f.x - 44 + k, f.y - 10 + k * 1.5, 88 - k * 2, 1.5);
    }

    // Nach Tiefe sortiert: was weiter unten steht, verdeckt das Dahinterliegende
    const drawables: Drawable[] = [
      ...this.props,
      ...this.spots
        .filter((s) => s.x + CAB_W > cx - 4 && s.x < cx + W + 4 && s.y < cy + H && s.y + CAB_H > cy)
        .map((s) => ({ baseline: (s.ty + 2) * T, draw: (gg: CanvasRenderingContext2D) => this.drawCabinet(gg, s) })),
      { baseline: this.player.y, draw: (gg: CanvasRenderingContext2D) => this.drawPlayer(gg) },
    ];
    drawables.sort((a, b) => a.baseline - b.baseline).forEach((d) => d.draw(g));

    // Namensschild über dem Automaten unter der Maus
    if (this.hover && this.hover !== this.near) {
      const s = this.hover;
      const tw = textWidth(s.info.title);
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillRect(s.x + CAB_W / 2 - tw / 2 - 3, s.y - 12, tw + 6, 11);
      drawText(g, s.info.title, s.x + CAB_W / 2, s.y - 10, { color: s.info.color, align: 'center' });
    }
    if (this.hoverDeck && !this.nearDeck) {
      const x = (this.deck.tx + DECK_W / 2) * T;
      const y = this.deck.ty * T - 26;
      const tw = textWidth('RECORD PLAYER');
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillRect(x - tw / 2 - 3, y - 2, tw + 6, 11);
      drawText(g, 'RECORD PLAYER', x, y, { color: this.deckColor, align: 'center' });
    }
    g.restore();

    if (this.near) this.drawPanel(g, this.near);
    else if (this.nearDeck) this.drawDeckPanel(g);
    else this.drawHint(g);

    if (this.toast) {
      g.fillStyle = 'rgba(0,0,0,0.8)';
      g.fillRect(0, 4, W, 15);
      drawText(g, this.toast.text, W / 2, 8, { color: C.YELLOW, align: 'center' });
    }
  }

  private drawSign(g: CanvasRenderingContext2D) {
    // Seltenes, kurzes Flackern – Atmosphäre, aber nicht hektisch
    const flicker = this.t % 9 > 8.7 && Math.floor(this.t * 20) % 2 === 0;
    const x = this.mapPxW / 2;
    // Schildträger mit Neonrahmen und Schrauben
    box(g, x - 82, 2, 164, 19, '#0e0820');
    g.fillStyle = C.alpha(C.MAGENTA, flicker ? 0.03 : 0.08);
    g.fillRect(x - 80, 4, 160, 15);
    g.fillStyle = C.alpha(C.MAGENTA, flicker ? 0.15 : 0.5);
    g.fillRect(x - 80.5, 3.5, 161, F);
    g.fillRect(x - 80.5, 19, 161, F);
    g.fillStyle = '#5a5078';
    for (const bx of [x - 81, x + 80]) {
      g.fillRect(bx, 4, F, F);
      g.fillRect(bx, 18, F, F);
    }
    drawText(g, 'ARCADE ARENA', x, 6, { scale: 2, color: flicker ? '#5a1a58' : C.MAGENTA, align: 'center', glow: !flicker });
  }

  private drawCabinet(g: CanvasRenderingContext2D, s: Spot) {
    const { x, y } = s;
    const color = s.info.color;
    const active = s === this.near || s === this.hover;

    // Demo auf den kleinen Bildschirm rendern
    const sg = s.screen.getContext('2d')!;
    sg.fillStyle = C.BLACK;
    sg.fillRect(0, 0, 80, 36);
    s.info.attract?.(sg, 0, 0, 80, 36, this.t + s.index * 0.7);

    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x + 1, y + CAB_H, CAB_W - 2, 2);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.fillRect(x + 3, y + CAB_H + 2, CAB_W - 6, 1);

    // Gehäuse: Seitenwände mit Licht links und Schatten rechts, farbige Kantenleisten
    box(g, x, y + 9, CAB_W, CAB_H - 9, BODY);
    g.fillStyle = '#271a48';
    g.fillRect(x + F, y + 9, 1.5, CAB_H - 9);
    g.fillStyle = '#110a22';
    g.fillRect(x + CAB_W - 2, y + 9, 1.5, CAB_H - 9);
    g.fillStyle = C.alpha(color, 0.75);
    g.fillRect(x, y + 9, F, CAB_H - 9);
    g.fillRect(x + CAB_W - F, y + 9, F, CAB_H - 9);

    // Deckel und leuchtendes Marquee mit Zierband
    box(g, x, y, CAB_W, 3, '#2a1d4a');
    g.fillStyle = C.alpha(color, 0.9);
    g.fillRect(x + 1, y + 3, CAB_W - 2, 6);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(x + 1.5, y + 3.5, CAB_W - 3, F);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(x + 1.5, y + 4, CAB_W - 3, F);
    g.fillStyle = C.shade(color, -0.4);
    g.fillRect(x + 1, y + 7, CAB_W - 2, 1.5);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    for (let k = 2; k < CAB_W - 2; k += 2) g.fillRect(x + k + 0.5, y + 7.5, F, F);
    g.fillStyle = C.shade(color, -0.6);
    g.fillRect(x + 1, y + 8.5, CAB_W - 2, F);

    // Bildschirm mit abgerundetem Rahmen, Röhrenschein und Glasreflex
    g.fillStyle = '#08050f';
    g.fillRect(x + 3, y + 11, 24, 14);
    g.fillStyle = BODY;
    for (const [cx, cy] of [[x + 3, y + 11], [x + 27 - F, y + 11], [x + 3, y + 25 - F], [x + 27 - F, y + 25 - F]]) {
      g.fillRect(cx, cy, F, F);
    }
    g.fillStyle = '#2a1d4a';
    g.fillRect(x + 3.5, y + 25, 23, F);
    g.fillStyle = C.alpha(color, 0.3);
    g.fillRect(x + 3.5, y + 12.5, 23, F);
    g.fillRect(x + 3.5, y + 23, 23, F);
    g.drawImage(s.screen, x + 4, y + 13, 22, 10);
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.fillRect(x + 4.5, y + 13, 6, F);
    g.fillRect(x + 4, y + 13.5, F, 3);

    // Bedienfeld: schräge Oberseite, Joystick mit Kugelgriff, Knöpfe mit Glanz
    box(g, x + 1, y + 26.5, CAB_W - 2, 3, '#4a3880');
    box(g, x + 1, y + 29.5, CAB_W - 2, 2.5, '#2a1f52');
    g.fillStyle = '#120b24';
    g.fillRect(x + 6, y + 28, 3, 1);
    g.fillStyle = '#8a80a8';
    g.fillRect(x + 7, y + 25.5, 1, 3);
    g.fillStyle = '#d8d0f0';
    g.fillRect(x + 7, y + 25.5, F, 3);
    g.fillStyle = C.RED;
    g.fillRect(x + 7, y + 24, 1, F);
    g.fillRect(x + 6.5, y + 24.5, 2, 1);
    g.fillRect(x + 7, y + 25.5, 1, F);
    g.fillStyle = '#ffd0d8';
    g.fillRect(x + 7, y + 24.5, F, F);
    button(g, x + 16, y + 27.5, C.YELLOW);
    button(g, x + 20, y + 27.5, C.RED);
    button(g, x + 24, y + 27.5, C.WHITE);

    // Lautsprechergitter
    g.fillStyle = '#0b0716';
    for (let k = 0; k < 9; k++) {
      g.fillRect(x + 8 + k * 1.5, y + 32.5, F, F);
      g.fillRect(x + 8.5 + k * 1.5, y + 33.5, F, F);
    }

    // Münztür mit beleuchteten Einwurfschlitzen
    box(g, x + 10, y + 35, 10, 8, '#0b0716', '#2a1d4a', '#05030a');
    const slot = active && this.t % 1 < 0.5 ? C.WHITE : C.RED;
    for (const sx of [x + 11.5, x + 16]) {
      box(g, sx, y + 36.5, 2.5, 4, '#2a2046');
      g.fillStyle = C.alpha(slot, 0.3);
      g.fillRect(sx + F, y + 37, 1.5, 3);
      g.fillStyle = slot;
      g.fillRect(sx + 1, y + 37, F, 3);
    }

    // Sockel
    g.fillStyle = '#0d0820';
    g.fillRect(x + F, y + CAB_H - 2, CAB_W - 1, 2);
    g.fillStyle = '#2a1d4a';
    g.fillRect(x + F, y + CAB_H - 2, CAB_W - 1, F);

    if (active) {
      const pulse = 0.55 + 0.45 * Math.sin(this.t * 5);
      strokeRect(g, x - 2, y - 2, CAB_W + 4, CAB_H + 4, C.alpha(color, pulse));
    }
  }

  /** Eigene Spielfigur: Kappe, T-Shirt, 4 Richtungen, 2 Laufphasen. */
  private drawPlayer(g: CanvasRenderingContext2D) {
    const x = Math.round(this.player.x) - 6;
    const y = Math.round(this.player.y) - 16;
    const f = this.walking ? Math.floor(this.t * 7) % 2 : 0;
    const face = this.face;
    const side = face === DIRS.left || face === DIRS.right;
    // Seitenansicht ist nach rechts gezeichnet, nach links wird gespiegelt
    const flip = face === DIRS.left;
    const px = (cx: number, cy: number, w: number, h: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(x + (flip ? 12 - cx - w : cx), y + cy, w, h);
    };
    const SKIN = '#f0c8a0';
    const SKIN_D = '#d09a78';
    const HAIR = '#5a3a1a';
    const HAIR_L = '#7a5228';
    const JEANS = '#3a3a8a';
    const JEANS_D = '#2a2a66';
    const SHIRT_D = '#c8702a';
    const SHIRT_L = '#ffc07a';
    const CAP_D = '#2ab8c8';
    const CAP_L = '#b8fbff';
    const EYE = '#1a1020';
    const MOUTH = '#b06a5a';

    px(1.5, 15.5, 9, 1, 'rgba(0,0,0,0.35)');
    px(2.5, 15, 7, F, 'rgba(0,0,0,0.2)');
    // Beine mit Schuhen
    const legs: [number, number][] = [
      [3, f ? 2 : 3],
      [7, f ? 3 : 2],
    ];
    for (const [lx, len] of legs) {
      px(lx, 12, 2, len, JEANS);
      px(lx + 1.5, 12, F, len, JEANS_D);
      px(lx, 12 + len, 2, 1, '#1a1a2a');
      px(lx, 12 + len, 1, F, '#4a4a66');
    }
    // T-Shirt mit Schatten, Saum und Brustlogo
    px(2, 7, 8, 5, C.ORANGE);
    px(2, 7, F, 4.5, SHIRT_L);
    px(9.5, 7, F, 5, SHIRT_D);
    px(2, 11.5, 8, F, SHIRT_D);
    if (face === DIRS.down) {
      px(4.5, 7, 3, F, SKIN_D);
      px(5.5, 8.5, 1, 1, C.MAGENTA);
      px(5.5, 8.5, F, F, '#ffb0f8');
    }
    // Arme schwingen beim Laufen
    if (side) {
      px(6, 7, 2, 1.5, SHIRT_D);
      px(6, 8 + f, 2, 3, SKIN);
      px(7.5, 8 + f, F, 3, SKIN_D);
    } else {
      px(1, 7, 1, 1.5, C.ORANGE);
      px(10, 7, 1, 1.5, SHIRT_D);
      px(1, 8 + f, 1, 3, SKIN);
      px(10, 8 + (1 - f), 1, 3, SKIN);
      px(10.5, 8 + (1 - f), F, 3, SKIN_D);
    }
    // Kopf
    if (face === DIRS.up) {
      px(3, 3, 6, 4, HAIR);
      px(4, 4, F, 2, HAIR_L);
      px(6, 3.5, F, 2.5, HAIR_L);
      px(7.5, 4, F, 2, HAIR_L);
      px(2.5, 4, F, 1.5, SKIN_D);
      px(9, 4, F, 1.5, SKIN_D);
    } else {
      px(3, 3, 6, 4, SKIN);
      px(8.5, 3, F, 4, SKIN_D);
      px(3.5, 6.5, 5, F, SKIN_D);
      if (face === DIRS.down) {
        px(3, 3, F, 2, HAIR);
        px(8.5, 3, F, 2, HAIR);
        px(4, 4.5, 1, 1, EYE);
        px(7, 4.5, 1, 1, EYE);
        px(4, 4.5, F, F, C.WHITE);
        px(7, 4.5, F, F, C.WHITE);
        px(3.5, 5.5, F, F, '#f0a090');
        px(8, 5.5, F, F, '#f0a090');
        px(5.5, 6, 1, F, MOUTH);
      } else {
        px(3, 3, 2, 3, HAIR);
        px(3.5, 3.5, F, 2, HAIR_L);
        px(5, 4, 1, 1.5, SKIN_D);
        px(7.5, 4.5, F, 1, EYE);
        px(9, 4.5, F, 1, SKIN);
        px(7.5, 6, 1, F, MOUTH);
      }
    }
    // Kappe mit Schirm
    px(3, 0, 6, 3, C.CYAN);
    px(3.5, 0.5, 2, F, CAP_L);
    px(5.5, 0, 1, F, CAP_D);
    px(3, 2.5, 6, F, CAP_D);
    if (face === DIRS.down) {
      px(2, 3, 8, 1, CAP_D);
      px(2, 3, 8, F, C.CYAN);
    } else if (side) {
      px(8, 2, 3.5, 1, CAP_D);
      px(8, 2, 3, F, C.CYAN);
    } else {
      px(4.5, 2, 3, F, CAP_D);
      px(5.5, 2, 1, F, HAIR);
    }
  }

  /** Infofeld unten, wenn man vor einem Automaten steht. */
  private drawPanel(g: CanvasRenderingContext2D, s: Spot) {
    const info = s.info;
    g.fillStyle = '#08050f';
    g.fillRect(0, PANEL_Y, W, H - PANEL_Y);
    g.fillStyle = C.alpha(info.color, 0.8);
    g.fillRect(0, PANEL_Y, W, 1);

    g.fillStyle = '#2c2050';
    g.fillRect(6, PANEL_Y + 6, 86, 42);
    g.drawImage(s.screen, 9, PANEL_Y + 9, 80, 36);
    const best = this.best[s.index];
    drawText(g, `HI ${best?.name ?? '---'} ${best?.score ?? 0}`, 49, PANEL_Y + 54, { color: info.accent, align: 'center' });

    drawText(g, info.title, 102, PANEL_Y + 6, { scale: 2, color: info.color, glow: true });
    drawText(g, info.tagline, 102, PANEL_Y + 24, { color: C.WHITE });
    drawText(g, info.controls.map((c) => `${c.keys} ${c.label}`).join('   '), 102, PANEL_Y + 36, { color: '#b8acd8' });
    if (this.t % 1 < 0.7) {
      const label = this.env.input.padActive ? 'A = PLAY' : 'ENTER = PLAY';
      drawText(g, label, W - 8, PANEL_Y + 52, { scale: 2, color: C.YELLOW, align: 'right', glow: true });
    }
  }

  /** Infofeld am DJ-Pult. */
  private drawDeckPanel(g: CanvasRenderingContext2D) {
    const music = this.env.music;
    const playing = !!music?.playing;
    const color = this.deckColor;
    const pad = this.env.input.padActive;
    g.fillStyle = '#08050f';
    g.fillRect(0, PANEL_Y, W, H - PANEL_Y);
    g.fillStyle = C.alpha(color, 0.8);
    g.fillRect(0, PANEL_Y, W, 1);

    g.fillStyle = '#2c2050';
    g.fillRect(6, PANEL_Y + 6, 86, 42);
    g.fillStyle = '#08050f';
    g.fillRect(9, PANEL_Y + 9, 80, 36);
    this.drawRecord(g, 49, PANEL_Y + 27, 16, color, playing);
    drawText(g, playing ? music!.current.era : 'NO RECORD', 49, PANEL_Y + 54, { color, align: 'center' });

    drawText(g, 'RECORD PLAYER', 102, PANEL_Y + 6, { scale: 2, color, glow: true });
    if (playing) {
      drawText(g, `♪ ${music!.current.title}`, 102, PANEL_Y + 24, { color: C.WHITE });
      drawText(g, pad ? 'A NEXT RECORD   B STOP' : 'ENTER NEXT RECORD   SHIFT STOP', 102, PANEL_Y + 36, { color: '#b8acd8' });
    } else {
      drawText(g, 'GROOVES FROM THE 70S, 80S AND 90S', 102, PANEL_Y + 24, { color: C.WHITE });
      drawText(g, 'KEEPS PLAYING SOFTLY IN EVERY GAME', 102, PANEL_Y + 36, { color: '#b8acd8' });
    }
    if (this.t % 1 < 0.7) {
      const label = `${pad ? 'A' : 'ENTER'} = ${playing ? 'NEXT' : 'PLAY'}`;
      drawText(g, label, W - 8, PANEL_Y + 52, { scale: 2, color: C.YELLOW, align: 'right', glow: true });
    }
  }

  private drawHint(g: CanvasRenderingContext2D) {
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(0, H - 16, W, 16);
    let text = '←↑→↓ WALK UP TO A MACHINE   M = SOUND   F = FULLSCREEN';
    let color = '#b8acd8';
    if (this.atDoor && this.opts.onLeave) {
      text = `${this.env.input.padActive ? 'A' : 'ENTER'} = LEAVE THE ARCADE`;
      color = C.YELLOW;
    } else if (this.opts.demo) {
      text = 'WALK UP TO A MACHINE AND PRESS ENTER';
    }
    drawText(g, text, W / 2, H - 11, { color, align: 'center' });
  }

  // ---------- Boden, Wände und Einrichtung ----------

  private renderFloor(): HTMLCanvasElement {
    const w = this.mapPxW;
    const h = this.mapPxH;
    const c = document.createElement('canvas');
    c.width = w * RES;
    c.height = h * RES;
    const g = c.getContext('2d')!;
    useHiRes(g);

    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const fine = (v: number) => Math.floor(v * RES) / RES;

    // Klassischer Spielhallen-Teppich: feines Gewebe mit Neon-Konfetti
    g.fillStyle = '#140a28';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < (w * h) / 6; i++) {
      g.fillStyle = rnd() < 0.5 ? '#1a0f33' : '#0f0720';
      g.fillRect(fine(rnd() * w), fine(rnd() * h), F, F);
    }
    const colors = [C.CYAN, C.MAGENTA, C.YELLOW, C.GREEN];
    for (let i = 0; i < (w * h) / 170; i++) {
      const x = fine(rnd() * w);
      const y = fine(rnd() * h);
      g.fillStyle = C.alpha(colors[Math.floor(rnd() * colors.length)], 0.18 + rnd() * 0.12);
      stamp(g, CONFETTI[Math.floor(rnd() * CONFETTI.length)], x, y);
    }

    // Farbiger Lichtschein der Bildschirme auf dem Teppich vor jedem Automaten
    for (const s of this.spots) {
      const cx = s.x + CAB_W / 2;
      const cy = s.y + CAB_H + 6;
      g.fillStyle = C.alpha(s.info.color, 0.03);
      for (let k = 1; k <= 3; k++) {
        const rx = 6 * k + 3;
        const ry = 2.5 * k;
        for (let dy = -ry; dy < ry; dy += F) {
          const half = fine(rx * Math.sqrt(1 - ((dy + F / 2) / ry) ** 2));
          g.fillRect(cx - half, cy + dy, half * 2, F);
        }
      }
    }

    // Rückwand: Vertäfelung mit Fugen und Maserung, zwei Neonröhren, Sockelleiste
    g.fillStyle = '#1a1030';
    g.fillRect(0, 0, w, 2 * T);
    for (let x = 0; x < w; x += 24) {
      g.fillStyle = '#0f0820';
      g.fillRect(x, 0, F, 2 * T - 5);
      g.fillStyle = '#271a44';
      g.fillRect(x + F, 0, F, 2 * T - 5);
      g.fillStyle = '#1e1338';
      for (let k = 0; k < 3; k++) g.fillRect(x + 5 + k * 6.5, 2 + (k % 2) * 3, F, 2 * T - 12);
    }
    tube(g, 0, 2 * T - 4.5, w, F, C.CYAN);
    tube(g, 0, 2 * T - 2.5, w, F, C.MAGENTA);
    g.fillStyle = '#0a0614';
    g.fillRect(0, 2 * T - 1, w, 1);

    // Seitenwände und Vorderwand mit feiner Struktur und Kante zum Raum
    const wall = (x: number, y: number, ww: number, hh: number) => {
      g.fillStyle = '#1a1030';
      g.fillRect(x, y, ww, hh);
      g.fillStyle = '#150c2a';
      for (let k = y + 4; k < y + hh; k += 8) g.fillRect(x, k, ww, F);
    };
    wall(0, 2 * T, T, h - 2 * T);
    wall(w - T, 2 * T, T, h - 2 * T);
    wall(0, h - T, w, T);
    g.fillStyle = '#2a1d4a';
    g.fillRect(0, h - T, w, F);
    tube(g, T - 1, 2 * T, F, h - 3 * T, C.CYAN, 0.6);
    tube(g, w - T + F, 2 * T, F, h - 3 * T, C.CYAN, 0.6);

    // Glastür mit Griffstangen, Fußmatte und Ausgangsschild
    const dx = DOOR_COLS[0] * T;
    const dy = h - T;
    box(g, dx, dy, 2 * T, T, '#0a1830', '#2a4a7a', '#05101e');
    for (const px of [dx + 1.5, dx + T + F]) {
      box(g, px, dy + 1.5, T - 2, T - 1.5, '#16284a', '#0e1c36', '#2a4470');
      g.fillStyle = 'rgba(200,230,255,0.18)';
      for (let k = 0; k < 6; k++) g.fillRect(px + 2 + k * F, dy + 2 + k, F, 1);
      g.fillStyle = '#8a90b0';
      g.fillRect(px + 2, dy + 8, T - 6, F);
      g.fillStyle = '#c8cce0';
      g.fillRect(px + 2, dy + 8, 2, F);
    }
    g.fillStyle = '#05101e';
    g.fillRect(dx + T - F, dy + 1, 1, T - 1);

    box(g, dx - 2, dy - 12, 2 * T + 4, 10, '#3a2a1a', '#5a4028', '#24180e');
    g.fillStyle = '#5a3a2a';
    for (let k = 1; k < 2 * T + 3; k += 1.5) g.fillRect(dx - 2 + k, dy - 11, F, 8);
    g.fillStyle = '#2a1c10';
    g.fillRect(dx - 1, dy - 11, 2 * T + 2, F);
    g.fillRect(dx - 1, dy - 3.5, 2 * T + 2, F);

    box(g, dx - 34, dy + 3, 28, 11, '#0a2a14', '#14401e', '#04140a');
    g.fillStyle = C.alpha(C.GREEN, 0.35);
    g.fillRect(dx - 33, dy + 4, 26, F);
    g.fillRect(dx - 33, dy + 12.5, 26, F);
    drawText(g, 'EXIT', dx - 20, dy + 5, { color: C.GREEN, align: 'center', glow: true });
    return c;
  }

  private get deckColor(): string {
    const music = this.env.music;
    return music?.playing ? music.current.color : C.CYAN;
  }

  /** Schallplatte von oben, dreht sich, solange Musik läuft. */
  private drawRecord(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, spinning: boolean) {
    fillCircle(g, cx, cy, r, '#1a1626');
    fillCircle(g, cx, cy, r - 1, '#0c0a14');
    // Rillen
    if (r > 8) {
      fillCircle(g, cx, cy, Math.round(r * 0.85), '#110e1a');
      fillCircle(g, cx, cy, Math.round(r * 0.85) - F, '#0c0a14');
      fillCircle(g, cx, cy, Math.round(r * 0.7), '#14111e');
      fillCircle(g, cx, cy, Math.round(r * 0.7) - F, '#0c0a14');
    }
    fillCircle(g, cx, cy, Math.max(1, Math.round(r * 0.35)), color);
    g.fillStyle = C.BLACK;
    g.fillRect(cx + F / 2, cy + F / 2, F, F);
    // Lichtreflex, der sich mitdreht
    const a = spinning ? this.t * 3.5 : 0.8;
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let k = 0.45; k <= 0.95; k += 0.05) {
      const fx = Math.round((cx + 0.5 + Math.cos(a) * r * k) * RES) / RES;
      const fy = Math.round((cy + 0.5 + Math.sin(a) * r * k) * RES) / RES;
      g.fillRect(fx, fy, F, F);
    }
  }

  /** DJ-Pult: zwei Boxen, Plattenspieler und eine Kiste mit Platten. */
  private drawDeck(g: CanvasRenderingContext2D, x: number, y: number) {
    const w = DECK_W * T;
    const music = this.env.music;
    const playing = !!music?.playing;
    const color = this.deckColor;
    // Kurzer Ausschlag der Membranen auf jedem Schlag
    const pump = playing ? Math.max(0, 1 - (music!.beat % 1) * 3) : 0;

    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x, y + 2 * T, w, 3);
    for (const sx of [x + 1, x + w - 17]) {
      box(g, sx, y - 14, 16, 46, '#16102a', '#2a2046', '#0a0618');
      box(g, sx, y - 14, 16, 2, '#2a2046');
      fillCircle(g, sx + 7.5, y - 3.5, 3, '#3a2a68');
      fillCircle(g, sx + 7.5, y - 3.5, 1, '#5a4a88');
      const r = pump > 0.4 ? 7 : 6;
      fillCircle(g, sx + 7.5, y + 14.5, r, '#2c2050');
      fillCircle(g, sx + 7.5, y + 14.5, r - 1, '#221840');
      fillCircle(g, sx + 7.5, y + 14.5, r - 2.5, '#2c2050');
      fillCircle(g, sx + 7.5, y + 14.5, 2, C.alpha(color, 0.35 + pump * 0.65));
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(sx + 4.5, y + 9.5, 2, F);
      g.fillRect(sx + 3.5, y + 10, F, 2);
      // Schrauben in den Ecken
      g.fillStyle = '#4a3a78';
      for (const [bx, by] of [[sx + 1.5, y - 11], [sx + 14, y - 11], [sx + 1.5, y + 29.5], [sx + 14, y + 29.5]]) g.fillRect(bx, by, F, F);
    }

    // Tisch zwischen den Boxen
    const tx = x + 18;
    const tw = w - 36;
    box(g, tx, y + 8, tw, 2 * T - 8, '#2a1a4a');
    box(g, tx, y - 8, tw, 16, '#3a2a68');
    g.fillStyle = C.alpha(color, 0.8);
    g.fillRect(tx, y + 8, tw, 1);
    g.fillStyle = C.alpha(color, 0.35);
    g.fillRect(tx, y + 9, tw, F);
    drawText(g, 'RECORDS', tx + tw / 2, y + 16, { color, align: 'center' });

    // Plattenspieler mit Tonarm
    box(g, tx + 2, y - 7, 32, 14, '#0e0a1a', '#05030a', '#2a2046');
    this.drawRecord(g, tx + 15, y, 6, color, playing);
    g.fillStyle = '#b8acd8';
    g.fillRect(tx + 29, y - 5, 2, 2);
    g.fillStyle = '#f4f1ff';
    g.fillRect(tx + 29, y - 5, F, F);
    g.fillStyle = '#b8acd8';
    const end = playing ? { x: tx + 19, y: y - 1 } : { x: tx + 30, y: y + 5 };
    for (let k = 0; k <= 1; k += 0.05) {
      const fx = Math.round((tx + 30 + (end.x - tx - 30) * k) * RES) / RES;
      const fy = Math.round((y - 4 + (end.y - y + 4) * k) * RES) / RES;
      g.fillRect(fx, fy, F, F);
    }
    g.fillRect(end.x - F, end.y, 1, 1);
    // Pitch-Regler und Startknopf
    g.fillStyle = '#2a2046';
    g.fillRect(tx + 31.5, y + 1, F, 5);
    g.fillStyle = C.alpha(color, 0.9);
    g.fillRect(tx + 31, y + 3, 1.5, F);
    g.fillStyle = playing ? C.GREEN : '#1a4a22';
    g.fillRect(tx + 4, y + 4.5, 1, 1);

    // Plattenkiste – die aufgelegte Platte fehlt darin
    RECORDS.forEach((rec, i) => {
      const out = playing && music!.index === i;
      const yy = y - 6 + (i % 2);
      g.fillStyle = out ? '#1a1030' : C.alpha(rec.color, 0.85);
      g.fillRect(tx + 38 + i * 3, yy, 2, 12);
      if (!out) {
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(tx + 38 + i * 3, yy, F, 12);
      }
    });
    box(g, tx + 36, y + 2, 21, 5, '#5a3a2a', '#7a5238', '#3a2418');
    g.fillStyle = '#3a2418';
    g.fillRect(tx + 37, y + 4, 19, F);

    // Aufsteigende Noten, solange Musik läuft
    if (playing) {
      for (let k = 0; k < 3; k++) {
        const p = (this.t * 0.5 + k / 3) % 1;
        // Deckkraft in Stufen, weil der Font pro Farbe einen eigenen Zeichensatz anlegt
        const nx = x + w / 2 + Math.sin((p + k) * 6) * 26;
        drawText(g, '♪', nx, y - 18 - p * 26, { color: C.alpha(color, Math.round((1 - p) * 5) / 5), align: 'center' });
      }
    }
  }

  private drawChanger(g: CanvasRenderingContext2D, x: number, y: number) {
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x + 2, y + 32, 28, 3);
    box(g, x + 2, y - 10, 28, 42, '#6a6488', '#8a84a8', '#46405e');
    box(g, x + 2, y - 10, 28, 3, '#4a4466');
    g.fillStyle = '#7c76a0';
    g.fillRect(x + 3, y - 7, 1, 38.5);
    // Anzeige
    box(g, x + 6, y - 2, 20, 9, '#0b0716', '#2a2640', '#8a84a8');
    drawText(g, '25', x + 16, y, { color: C.YELLOW, align: 'center' });
    // Münzschale mit ein paar Münzen
    box(g, x + 9, y + 11, 14, 5, '#2a2640', '#1a1630', '#8a84a8');
    for (let k = 0; k < 3; k++) {
      const mx = x + 10.5 + k * 3.5;
      g.fillStyle = '#c8a020';
      g.fillRect(mx, y + 13, 2.5, 2);
      g.fillStyle = C.YELLOW;
      g.fillRect(mx, y + 13, 2, 1.5);
      g.fillStyle = '#fff6b0';
      g.fillRect(mx + F, y + 13, 1, F);
    }
    // Geldscheinschlitz mit blinkender Leuchte
    box(g, x + 8, y + 20, 16, 8, '#2a2640', '#3a3458', '#1a1630');
    g.fillStyle = '#05030a';
    g.fillRect(x + 10, y + 23, 12, F);
    g.fillStyle = '#6a6488';
    g.fillRect(x + 10, y + 23.5, 12, F);
    g.fillStyle = this.t % 1.2 < 0.6 ? C.GREEN : '#1a4a22';
    g.fillRect(x + 21, y + 25.5, 1, 1);
    g.fillStyle = '#4a4466';
    for (const [bx, by] of [[x + 3.5, y - 6], [x + 28, y - 6], [x + 3.5, y + 30], [x + 28, y + 30]]) g.fillRect(bx, by, F, F);
  }

  private drawSnacks(g: CanvasRenderingContext2D, x: number, y: number) {
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x + 2, y + 32, 28, 3);
    box(g, x + 2, y - 12, 28, 44, '#8a1a3a', '#b8305a', '#5a0e24');
    g.fillStyle = '#a82448';
    g.fillRect(x + 2.5, y - 11.5, 27, 2);
    // Sichtfenster mit Spiralen und Snacks
    box(g, x + 5, y - 8, 18, 30, '#0a1a2a', '#05101a', '#1a3a5a');
    const items = [C.YELLOW, C.ORANGE, C.GREEN, C.CYAN, C.RED, C.WHITE];
    for (let r = 0; r < 4; r++) {
      g.fillStyle = '#1a2a40';
      g.fillRect(x + 5.5, y - 1 + r * 7, 17, F);
      for (let k = 0; k < 3; k++) {
        const c = items[(r * 3 + k) % items.length];
        const ix = x + 7 + k * 6;
        const iy = y - 6 + r * 7;
        box(g, ix, iy, 4, 4, c, C.shade(c, 0.5), C.shade(c, -0.45));
        g.fillStyle = C.shade(c, -0.25);
        g.fillRect(ix + 1, iy + 1.5, 2, 1);
        g.fillStyle = '#6a7a9a';
        for (let j = 0; j < 4; j++) g.fillRect(ix + F + j, iy + 4.5, F, 1);
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.09)';
    for (let j = 0; j < 27; j++) {
      g.fillRect(x + 20.5 - j * F, y - 7.5 + j, F, 1);
      g.fillRect(x + 22 - j * F, y - 7.5 + j, F, 1);
    }
    // Tastenfeld und Münzeinwurf
    box(g, x + 25, y - 4, 3, 10, '#d8d0f0', '#ffffff', '#9a90b8');
    g.fillStyle = '#5a5070';
    for (let r = 0; r < 4; r++) for (let k = 0; k < 2; k++) g.fillRect(x + 25.5 + k * 1.5, y - 3 + r * 2, F, F);
    box(g, x + 25, y + 8, 3, 5, '#2a0a18');
    g.fillStyle = C.RED;
    g.fillRect(x + 26.5, y + 9, F, 3);
    // Ausgabeschacht
    box(g, x + 6, y + 24, 16, 5, '#0b0716', '#05030a', '#3a1428');
    g.fillStyle = '#3a3458';
    g.fillRect(x + 6.5, y + 24.5, 15, F);
  }

  private drawCounter(g: CanvasRenderingContext2D, x: number, y: number) {
    const w = 6 * T;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x, y + 2 * T, w, 3);
    box(g, x, y + 6, w, 2 * T - 6, '#2a1a4a', '#3a2a68', '#160c2c');
    for (let k = 1; k < 6; k++) {
      g.fillStyle = '#1a1030';
      g.fillRect(x + k * 16, y + 9, F, 2 * T - 11);
      g.fillStyle = '#3a2a68';
      g.fillRect(x + k * 16 + F, y + 9, F, 2 * T - 11);
    }
    // Vitrine mit Preisen: Bälle, Geschenke, Sterne
    g.fillStyle = 'rgba(160,220,255,0.10)';
    g.fillRect(x + 2, y - 4, w - 4, 10);
    const prizes = [C.MAGENTA, C.YELLOW, C.GREEN, C.ORANGE, C.CYAN, C.RED, C.WHITE, C.MAGENTA];
    prizes.forEach((p, i) => {
      const px = x + 6 + i * 11;
      const py = y + (i % 2 ? 0 : 2);
      const kind = i % 3;
      if (kind === 0) {
        fillCircle(g, px + 2.5, py + 2, 2, p);
        g.fillStyle = C.shade(p, -0.4);
        g.fillRect(px + 1, py + 2.5, 4, F);
        g.fillStyle = C.WHITE;
        g.fillRect(px + 1.5, py + 1, F, F);
      } else if (kind === 1) {
        box(g, px, py, 6, 5, p, C.shade(p, 0.45), C.shade(p, -0.45));
        g.fillStyle = C.WHITE;
        g.fillRect(px + 2.5, py, 1, 5);
        g.fillRect(px, py + 2, 6, F);
        g.fillRect(px + 1.5, py - 1, 1, 1);
        g.fillRect(px + 3.5, py - 1, 1, 1);
      } else {
        g.fillStyle = p;
        stamp(g, STAR, px, py - 0.5);
      }
    });
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let k = 0; k < 4; k++) {
      for (let j = 0; j < 8; j++) g.fillRect(x + 10 + k * 24 - j * F, y - 3.5 + j, F, 1);
    }
    g.fillStyle = C.alpha(C.CYAN, 0.7);
    g.fillRect(x + 2, y - 4, w - 4, F);
    g.fillStyle = C.alpha(C.CYAN, 0.3);
    g.fillRect(x + 2, y - 3.5, w - 4, F);
    g.fillRect(x + 2, y - 4, F, 10);
    g.fillRect(x + w - 2.5, y - 4, F, 10);
    // Leuchtende Thekenkante
    g.fillStyle = C.shade(C.YELLOW, 0.6);
    g.fillRect(x, y + 5.5, w, F);
    g.fillStyle = C.YELLOW;
    g.fillRect(x, y + 6, w, F);
    g.fillStyle = C.shade(C.YELLOW, -0.4);
    g.fillRect(x, y + 6.5, w, F);
    drawText(g, 'PRIZES', x + w / 2, y + 16, { color: C.YELLOW, align: 'center' });
  }

  private drawSofa(g: CanvasRenderingContext2D, x: number, y: number) {
    const w = 5 * T;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x + 2, y + T, w - 4, 3);
    // Rückenlehne mit Knopfheftung
    box(g, x, y - 8, w, 10, '#7a1f6a', '#9a2a88', '#5a1450');
    g.fillStyle = '#5a1450';
    for (let k = 0; k < 8; k++) g.fillRect(x + 7 + k * 9.5, y - 4 + (k % 2) * 2, F, F);
    g.fillStyle = '#8a2a7a';
    g.fillRect(x + 1, y - 7, w - 2, F);
    // Zwei Sitzkissen mit Paspel
    const sw = (w - 8) / 2;
    for (const sx of [x + 4, x + 4 + sw]) {
      box(g, sx, y + 2, sw, 10, '#a02a8a', '#c84aa8', '#7a1f6a');
      g.fillStyle = '#b8389c';
      g.fillRect(sx + 1, y + 3, sw - 2, 1.5);
    }
    g.fillStyle = '#d86ac0';
    g.fillRect(x + 4, y + 2, w - 8, F);
    // Armlehnen
    box(g, x, y - 2, 5, 16, '#7a1f6a', '#9a2a88', '#5a1450');
    box(g, x + w - 5, y - 2, 5, 16, '#7a1f6a', '#9a2a88', '#5a1450');
    g.fillStyle = '#9a2a88';
    g.fillRect(x + 1, y - 2, 3, 1.5);
    g.fillRect(x + w - 4, y - 2, 3, 1.5);
  }

  private drawPlant(g: CanvasRenderingContext2D, x: number, y: number) {
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x + 2, y + T, 12, 2);
    // Terrakottatopf mit Rand und Zierband
    box(g, x + 3, y + 6, 10, 10, '#8a4a2a', '#a85a32', '#5a2a18');
    g.fillStyle = '#6a3420';
    g.fillRect(x + 3.5, y + 10, 9, F);
    g.fillStyle = '#a85a32';
    g.fillRect(x + 3.5, y + 10.5, 9, F);
    box(g, x + 2, y + 5, 12, 2, '#a85a32', '#d07a48', '#7a4024');
    // Kaktus mit Rippen, Armen, Stacheln und Blüte
    const GREEN = '#2a9a4a';
    const LIGHT = '#5ad86a';
    const DARK = '#1a6a32';
    box(g, x + 6, y - 11, 4, 16.5, GREEN, LIGHT, DARK);
    g.fillStyle = '#238a40';
    g.fillRect(x + 7.5, y - 10, F, 14.5);
    box(g, x + 3, y - 4, 3, 2, GREEN, LIGHT, DARK);
    box(g, x + 1.5, y - 8, 2, 6, GREEN, LIGHT, DARK);
    box(g, x + 10, y - 6, 2.5, 2, GREEN, LIGHT, DARK);
    box(g, x + 11.5, y - 10, 2, 6, GREEN, LIGHT, DARK);
    g.fillStyle = '#d8ffd8';
    for (const [sx, sy] of [[5.5, -9], [10, -8], [5.5, -3], [10, 0], [1, -6.5], [13.5, -8.5], [7, -6], [8.5, -1.5]]) {
      g.fillRect(x + sx, y + sy, F, F);
    }
    g.fillStyle = C.MAGENTA;
    g.fillRect(x + 7, y - 12.5, 2, 1);
    g.fillRect(x + 7.5, y - 13, 1, 2);
    g.fillStyle = C.YELLOW;
    g.fillRect(x + 7.5, y - 12.5, 1, F);
  }
}

/** Ein feiner Pixel. */
const F = 1 / RES;

/** Kasten mit feiner Kante: Licht oben und links, Schatten unten und rechts. */
function box(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  base: string,
  light = C.shade(base, 0.25),
  dark = C.shade(base, -0.4),
): void {
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  g.fillStyle = light;
  g.fillRect(x, y, w, F);
  g.fillRect(x, y, F, h);
  g.fillStyle = dark;
  g.fillRect(x, y + h - F, w, F);
  g.fillRect(x + w - F, y, F, h);
}

/** Runder Arcade-Knopf mit Glanzpunkt und dunklem Rand. */
function button(g: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(x + F, y, 1, 1.5);
  g.fillRect(x, y + F, 2, F);
  g.fillStyle = C.shade(color, -0.5);
  g.fillRect(x + F, y + 1.5, 1, F);
  g.fillStyle = C.shade(color, 0.6);
  g.fillRect(x + F, y, F, F);
}

/** Neonröhre: heller Kern, farbiger Rand und weicher Schein. */
function tube(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, a = 1): void {
  const horizontal = w > h;
  g.fillStyle = C.alpha(color, 0.25 * a);
  if (horizontal) {
    g.fillRect(x, y - F, w, F);
    g.fillRect(x, y + 2 * F, w, F);
  } else {
    g.fillRect(x - F, y, F, h);
    g.fillRect(x + 2 * F, y, F, h);
  }
  g.fillStyle = C.alpha(C.shade(color, 0.6), a);
  g.fillRect(x, y, horizontal ? w : F, horizontal ? F : h);
  g.fillStyle = C.alpha(color, 0.85 * a);
  if (horizontal) g.fillRect(x, y + F, w, F);
  else g.fillRect(x + F, y, F, h);
}

/** Zeichnet ein Muster aus '#' als feine Pixel in der aktuellen Füllfarbe. */
function stamp(g: CanvasRenderingContext2D, rows: string[], x: number, y: number): void {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === '#') g.fillRect(x + i * F, y + j * F, F, F);
  });
}

/** Konfetti-Formen im Teppich (feines Raster). */
const CONFETTI = [
  ['.##.', '#..#', '#..#', '.##.'],
  ['..#..', '.#.#.', '#####'],
  ['#...#...', '.#.#.#.#', '..#...#.'],
  ['..#..', '..#..', '##.##', '..#..', '..#..'],
  ['..##', '.##.', '####', '.##.', '##..'],
  ['#.#', '...', '.#.'],
  ['######'],
  ['#', '#', '#', '#', '#', '#'],
];

const STAR = ['....##....', '....##....', '...####...', '##########', '.########.', '..######..', '..##..##..', '.##....##.'];
