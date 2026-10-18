import { RES, strokeRect, useHiRes } from '../engine/draw';
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
    g.drawImage(this.floor, 0, 0);
    this.drawSign(g);

    // Lichtkegel vor dem Automaten, an dem man steht
    const lit = this.near ?? this.hover;
    if (lit) {
      g.fillStyle = C.alpha(lit.info.color, 0.16);
      const f = this.frontOf(lit);
      for (let k = 0; k < 6; k++) g.fillRect(f.x - 20 + k * 2, f.y - 10 + k * 3, 40 - k * 4, 3);
    } else if (this.nearDeck || this.hoverDeck) {
      g.fillStyle = C.alpha(this.deckColor, 0.16);
      const f = this.deckFront();
      for (let k = 0; k < 6; k++) g.fillRect(f.x - 44 + k * 2, f.y - 10 + k * 3, 88 - k * 4, 3);
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
    g.fillStyle = C.alpha(C.MAGENTA, 0.08);
    g.fillRect(x - 84, 2, 168, 20);
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
    g.fillRect(x + 1, y + CAB_H, CAB_W - 2, 3);

    // Deckel und leuchtendes Marquee
    g.fillStyle = '#2a1d4a';
    g.fillRect(x, y, CAB_W, 3);
    g.fillStyle = C.alpha(color, 0.9);
    g.fillRect(x + 1, y + 3, CAB_W - 2, 6);
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillRect(x + 2, y + 4, CAB_W - 4, 1);
    g.fillStyle = BODY;
    g.fillRect(x, y + 9, CAB_W, CAB_H - 9);
    g.fillStyle = C.alpha(color, 0.6);
    g.fillRect(x, y + 9, 1, CAB_H - 9);
    g.fillRect(x + CAB_W - 1, y + 9, 1, CAB_H - 9);

    // Bildschirm mit laufender Demo
    g.fillStyle = '#08050f';
    g.fillRect(x + 3, y + 11, 24, 14);
    g.drawImage(s.screen, x + 4, y + 13, 22, 10);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(x + 5, y + 12, 7, 1);

    // Bedienfeld mit Joystick und Knöpfen
    g.fillStyle = '#3a2a68';
    g.fillRect(x + 1, y + 27, CAB_W - 2, 5);
    g.fillStyle = C.RED;
    g.fillRect(x + 7, y + 28, 2, 2);
    g.fillStyle = C.YELLOW;
    g.fillRect(x + 17, y + 29, 2, 2);
    g.fillStyle = C.RED;
    g.fillRect(x + 21, y + 29, 2, 2);

    // Münztür
    g.fillStyle = '#0b0716';
    g.fillRect(x + 10, y + 35, 10, 8);
    g.fillStyle = active && this.t % 1 < 0.5 ? C.WHITE : C.RED;
    g.fillRect(x + 12, y + 37, 1, 3);
    g.fillRect(x + 17, y + 37, 1, 3);

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
    const px = (cx: number, cy: number, w: number, h: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(x + cx, y + cy, w, h);
    };

    px(1, 15, 10, 2, 'rgba(0,0,0,0.4)');
    // Beine
    const legA = f ? 2 : 3;
    const legB = f ? 3 : 2;
    px(3, 12, 2, legA, '#3a3a8a');
    px(7, 12, 2, legB, '#3a3a8a');
    px(3, 12 + legA, 2, 1, '#1a1a2a');
    px(7, 12 + legB, 2, 1, '#1a1a2a');
    // Körper und Arme
    px(2, 7, 8, 5, C.ORANGE);
    if (face === DIRS.left || face === DIRS.right) {
      px(face.x > 0 ? 6 : 4, 8 + f, 2, 3, '#f0c8a0');
    } else {
      px(1, 8 + f, 1, 3, '#f0c8a0');
      px(10, 8 + (1 - f), 1, 3, '#f0c8a0');
    }
    // Kopf
    if (face === DIRS.up) {
      px(3, 3, 6, 4, '#5a3a1a');
    } else {
      px(3, 3, 6, 4, '#f0c8a0');
      if (face === DIRS.down) {
        px(4, 4, 1, 1, C.BLACK);
        px(7, 4, 1, 1, C.BLACK);
      } else {
        px(face.x > 0 ? 7 : 4, 4, 1, 1, C.BLACK);
        px(face.x > 0 ? 3 : 7, 3, 2, 3, '#5a3a1a');
      }
    }
    // Kappe mit Schirm
    px(3, 0, 6, 3, C.CYAN);
    if (face === DIRS.down) px(2, 3, 8, 1, '#2ab8c8');
    else if (face === DIRS.left) px(1, 2, 3, 1, '#2ab8c8');
    else if (face === DIRS.right) px(8, 2, 3, 1, '#2ab8c8');
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
    const c = document.createElement('canvas');
    c.width = this.mapPxW;
    c.height = this.mapPxH;
    const g = c.getContext('2d')!;

    // Klassischer Spielhallen-Teppich mit Neon-Mustern
    g.fillStyle = '#140a28';
    g.fillRect(0, 0, c.width, c.height);
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const colors = [C.CYAN, C.MAGENTA, C.YELLOW, C.GREEN];
    for (let i = 0; i < (c.width * c.height) / 170; i++) {
      const x = Math.floor(rnd() * c.width);
      const y = Math.floor(rnd() * c.height);
      g.fillStyle = C.alpha(colors[Math.floor(rnd() * colors.length)], 0.16 + rnd() * 0.1);
      const shape = Math.floor(rnd() * 4);
      if (shape === 0) g.fillRect(x, y, 3, 1);
      else if (shape === 1) g.fillRect(x, y, 1, 3);
      else if (shape === 2) {
        g.fillRect(x, y, 1, 1);
        g.fillRect(x + 1, y + 1, 1, 1);
        g.fillRect(x + 2, y, 1, 1);
      } else {
        g.fillRect(x, y, 2, 2);
      }
    }

    // Wände
    const wall = (x: number, y: number, w: number, h: number) => {
      g.fillStyle = '#1a1030';
      g.fillRect(x, y, w, h);
    };
    wall(0, 0, c.width, 2 * T);
    g.fillStyle = '#22163e';
    for (let x = 0; x < c.width; x += 24) g.fillRect(x, 0, 1, 2 * T);
    g.fillStyle = C.alpha(C.MAGENTA, 0.7);
    g.fillRect(0, 2 * T - 2, c.width, 1);
    g.fillStyle = C.alpha(C.CYAN, 0.5);
    g.fillRect(0, 2 * T - 4, c.width, 1);
    wall(0, 0, T, c.height);
    wall(c.width - T, 0, T, c.height);
    wall(0, c.height - T, c.width, T);
    g.fillStyle = C.alpha(C.CYAN, 0.4);
    g.fillRect(T - 1, 2 * T, 1, c.height - 3 * T);
    g.fillRect(c.width - T, 2 * T, 1, c.height - 3 * T);

    // Tür mit Fußmatte und Ausgangsschild
    const dx = DOOR_COLS[0] * T;
    const dy = c.height - T;
    g.fillStyle = '#0a1830';
    g.fillRect(dx, dy, 2 * T, T);
    g.fillStyle = '#16284a';
    g.fillRect(dx + 2, dy + 2, 2 * T - 4, T - 2);
    g.fillStyle = '#3a2a1a';
    g.fillRect(dx - 2, dy - 12, 2 * T + 4, 10);
    g.fillStyle = '#5a3a2a';
    for (let k = 0; k < 2 * T + 4; k += 3) g.fillRect(dx - 2 + k, dy - 11, 1, 8);
    // Leuchtendes Ausgangsschild an der Wand neben der Tür
    g.fillStyle = '#0a2a14';
    g.fillRect(dx - 34, dy + 3, 28, 11);
    drawText(g, 'EXIT', dx - 20, dy + 5, { color: C.GREEN, align: 'center', glow: true });
    return c;
  }

  private get deckColor(): string {
    const music = this.env.music;
    return music?.playing ? music.current.color : C.CYAN;
  }

  /** Gefüllter Pixelkreis. */
  private disc(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
    g.fillStyle = color;
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.8));
      g.fillRect(cx - w, cy + dy, 2 * w + 1, 1);
    }
  }

  /** Schallplatte von oben, dreht sich, solange Musik läuft. */
  private drawRecord(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, spinning: boolean) {
    this.disc(g, cx, cy, r, '#1a1626');
    this.disc(g, cx, cy, r - 1, '#0c0a14');
    if (r > 8) this.disc(g, cx, cy, Math.round(r * 0.7), '#14111e');
    this.disc(g, cx, cy, Math.max(1, Math.round(r * 0.35)), color);
    g.fillStyle = C.BLACK;
    g.fillRect(cx, cy, 1, 1);
    // Lichtreflex, der sich mitdreht
    const a = spinning ? this.t * 3.5 : 0.8;
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let k = 0.5; k <= 0.9; k += 0.1) {
      g.fillRect(Math.round(cx + Math.cos(a) * r * k), Math.round(cy + Math.sin(a) * r * k), 1, 1);
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
      g.fillStyle = '#16102a';
      g.fillRect(sx, y - 14, 16, 46);
      g.fillStyle = '#2a2046';
      g.fillRect(sx, y - 14, 16, 2);
      this.disc(g, sx + 8, y - 3, 3, '#3a2a68');
      this.disc(g, sx + 8, y + 15, pump > 0.4 ? 7 : 6, '#2c2050');
      this.disc(g, sx + 8, y + 15, 2, C.alpha(color, 0.35 + pump * 0.65));
    }

    // Tisch zwischen den Boxen
    const tx = x + 18;
    const tw = w - 36;
    g.fillStyle = '#2a1a4a';
    g.fillRect(tx, y + 8, tw, 2 * T - 8);
    g.fillStyle = '#3a2a68';
    g.fillRect(tx, y - 8, tw, 16);
    g.fillStyle = C.alpha(color, 0.8);
    g.fillRect(tx, y + 8, tw, 1);
    drawText(g, 'RECORDS', tx + tw / 2, y + 16, { color, align: 'center' });

    // Plattenspieler mit Tonarm
    g.fillStyle = '#0e0a1a';
    g.fillRect(tx + 2, y - 7, 32, 14);
    this.drawRecord(g, tx + 15, y, 6, color, playing);
    g.fillStyle = '#b8acd8';
    g.fillRect(tx + 29, y - 5, 2, 2);
    const end = playing ? { x: tx + 19, y: y - 1 } : { x: tx + 30, y: y + 5 };
    for (let k = 0; k <= 1; k += 0.1) {
      g.fillRect(Math.round(tx + 30 + (end.x - tx - 30) * k), Math.round(y - 4 + (end.y - y + 4) * k), 1, 1);
    }

    // Plattenkiste – die aufgelegte Platte fehlt darin
    RECORDS.forEach((rec, i) => {
      const out = playing && music!.index === i;
      g.fillStyle = out ? '#1a1030' : C.alpha(rec.color, 0.85);
      g.fillRect(tx + 38 + i * 3, y - 6 + (i % 2), 2, 12);
    });
    g.fillStyle = '#5a3a2a';
    g.fillRect(tx + 36, y + 2, 21, 5);

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
    g.fillStyle = '#6a6488';
    g.fillRect(x + 2, y - 10, 28, 42);
    g.fillStyle = '#4a4466';
    g.fillRect(x + 2, y - 10, 28, 3);
    g.fillStyle = '#0b0716';
    g.fillRect(x + 6, y - 2, 20, 9);
    drawText(g, '25', x + 16, y, { color: C.YELLOW, align: 'center' });
    g.fillStyle = C.YELLOW;
    g.fillRect(x + 10, y + 12, 12, 3);
    g.fillStyle = '#2a2640';
    g.fillRect(x + 8, y + 20, 16, 8);
  }

  private drawSnacks(g: CanvasRenderingContext2D, x: number, y: number) {
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x + 2, y + 32, 28, 3);
    g.fillStyle = '#8a1a3a';
    g.fillRect(x + 2, y - 12, 28, 44);
    g.fillStyle = '#0a1a2a';
    g.fillRect(x + 5, y - 8, 18, 30);
    const items = [C.YELLOW, C.ORANGE, C.GREEN, C.CYAN, C.RED, C.WHITE];
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 3; k++) {
        g.fillStyle = items[(r * 3 + k) % items.length];
        g.fillRect(x + 7 + k * 6, y - 6 + r * 7, 4, 4);
      }
    }
    g.fillStyle = '#d8d0f0';
    g.fillRect(x + 25, y - 4, 3, 10);
    g.fillStyle = '#0b0716';
    g.fillRect(x + 6, y + 24, 16, 5);
  }

  private drawCounter(g: CanvasRenderingContext2D, x: number, y: number) {
    const w = 6 * T;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x, y + 2 * T, w, 3);
    g.fillStyle = '#2a1a4a';
    g.fillRect(x, y + 6, w, 2 * T - 6);
    g.fillStyle = 'rgba(160,220,255,0.18)';
    g.fillRect(x + 2, y - 4, w - 4, 12);
    g.fillStyle = C.alpha(C.CYAN, 0.7);
    g.fillRect(x + 2, y - 4, w - 4, 1);
    // Preise in der Vitrine
    const prizes = [C.MAGENTA, C.YELLOW, C.GREEN, C.ORANGE, C.CYAN, C.RED, C.WHITE, C.MAGENTA];
    prizes.forEach((p, i) => {
      g.fillStyle = p;
      g.fillRect(x + 6 + i * 11, y + (i % 2 ? 0 : 2), 6, 5);
    });
    g.fillStyle = C.YELLOW;
    g.fillRect(x, y + 6, w, 1);
    drawText(g, 'PRIZES', x + w / 2, y + 16, { color: C.YELLOW, align: 'center' });
  }

  private drawSofa(g: CanvasRenderingContext2D, x: number, y: number) {
    const w = 5 * T;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x + 2, y + T, w - 4, 3);
    g.fillStyle = '#7a1f6a';
    g.fillRect(x, y - 8, w, 10);
    g.fillStyle = '#a02a8a';
    g.fillRect(x + 4, y + 2, w - 8, 10);
    g.fillStyle = '#7a1f6a';
    g.fillRect(x, y - 2, 5, 16);
    g.fillRect(x + w - 5, y - 2, 5, 16);
    g.fillStyle = '#c84aa8';
    g.fillRect(x + 4 + (w - 8) / 2, y + 2, 1, 10);
  }

  private drawPlant(g: CanvasRenderingContext2D, x: number, y: number) {
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x + 2, y + T, 12, 2);
    g.fillStyle = '#8a4a2a';
    g.fillRect(x + 3, y + 6, 10, 10);
    g.fillStyle = '#a85a32';
    g.fillRect(x + 2, y + 5, 12, 2);
    g.fillStyle = '#2a9a4a';
    g.fillRect(x + 6, y - 10, 4, 16);
    g.fillRect(x + 1, y - 6, 6, 4);
    g.fillRect(x + 9, y - 8, 6, 4);
    g.fillRect(x + 2, y - 1, 5, 3);
    g.fillStyle = '#5ad86a';
    g.fillRect(x + 7, y - 12, 2, 4);
    g.fillRect(x + 11, y - 9, 3, 1);
  }
}
