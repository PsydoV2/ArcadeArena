import { fillCircle, strokeRect } from '../engine/draw';
import { drawText } from '../engine/font';
import { ScoreBoard, type ScoreEntry } from '../engine/highscores';
import type { Input } from '../engine/input';
import * as C from '../engine/palette';
import { sfx } from '../engine/sfx';
import { toggleFullscreen } from '../engine/screen';
import { DEAD_LOOP, type LoopHandle, type Sound } from '../engine/sound';
import { SCREEN_H as H, SCREEN_W as W, type CabinetInfo } from '../engine/types';

const CAB_W = 104;
const CAB_TOP = 40;
const CAB_BOTTOM = 236;
const GAP = 20;

const BODY = '#1b1233';
const PANEL = '#2b1d4d';
const DARK = '#0b0716';

export interface HallEnv {
  g: CanvasRenderingContext2D;
  input: Input;
  sound: Sound;
}

/** Die Spielhalle: Automaten nebeneinander, Auswahl per Pfeiltasten + Enter oder Mausklick. */
export class Hall {
  private sel = 0;
  private t = 0;
  private toast: { text: string; t: number } | null = null;
  private best: (ScoreEntry | undefined)[] = [];
  private room = renderRoom();
  private hum: LoopHandle = DEAD_LOOP;
  private blipT = 2;

  constructor(
    private cabinets: CabinetInfo[],
    private env: HallEnv,
    private onLaunch: (c: CabinetInfo) => void,
  ) {
    this.resume();
  }

  /** Nach der Rückkehr aus einem Spiel: Highscores neu einlesen. */
  resume(): void {
    this.best = this.cabinets.map((c) => new ScoreBoard(c.id).list()[0]);
  }

  update(dt: number): void {
    const { input, sound } = this.env;
    this.t += dt;
    if (this.toast && (this.toast.t -= dt) <= 0) this.toast = null;

    const n = this.cabinets.length;
    if (input.pressed('left') && this.sel > 0) {
      this.sel--;
      sfx.blip(sound);
    }
    if (input.pressed('right') && this.sel < n - 1) {
      this.sel++;
      sfx.blip(sound);
    }

    const hover = this.hitTest(input.mouse.x, input.mouse.y);
    if (input.mouse.moved && hover >= 0 && hover !== this.sel) {
      this.sel = hover;
      sfx.blip(sound);
    }
    if (input.mouse.clicked) {
      if (hover >= 0) {
        this.sel = hover;
        this.launch(hover);
      }
    } else if (input.pressed('start') || input.pressed('a')) {
      this.launch(this.sel);
    }

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
    this.env.g.canvas.style.cursor = hover >= 0 ? 'pointer' : 'default';
    this.updateAmbience(dt);
  }

  /** Leises Gemurmel der Halle und ab und zu ein Piepen von anderen Automaten. */
  private updateAmbience(dt: number) {
    const { sound } = this.env;
    if (!this.hum.alive) this.hum = sound.loop({ noise: true, freq: 180, vol: 0.05 });
    this.blipT -= dt;
    if (this.blipT > 0) return;
    this.blipT = 0.6 + Math.random() * 2.2;
    const notes = [262, 294, 330, 392, 440, 523, 587, 659, 784];
    const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
    const vol = 0.012 + Math.random() * 0.015;
    const type = pick<OscillatorType>(['square', 'triangle']);
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      sound.tone({ freq: pick(notes), dur: 0.06 + Math.random() * 0.1, type, vol, delay: i * 0.09 });
    }
  }

  render(): void {
    const g = this.env.g;
    g.drawImage(this.room, 0, 0);
    this.drawSign(g);
    this.cabinets.forEach((c, i) => this.drawCabinet(g, c, i));

    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, 244, W, 15);
    if (this.toast) {
      drawText(g, this.toast.text, W / 2, 248, { color: C.YELLOW, align: 'center' });
    } else {
      const c = this.cabinets[this.sel];
      drawText(g, c.tagline, W / 2, 248, { color: c.color, align: 'center' });
    }
    const help = this.env.input.padActive
      ? '←→ CHOOSE   A / START = PLAY   SELECT = BACK'
      : '←→ CHOOSE   ENTER = PLAY   M = SOUND   F = FULLSCREEN';
    drawText(g, help, W / 2, 270, {
      color: '#9a8ac8',
      align: 'center',
    });
  }

  private launch(i: number) {
    const c = this.cabinets[i];
    if (!c.create) {
      sfx.buzz(this.env.sound);
      this.say(`${c.title} - COMING SOON`);
      return;
    }
    sfx.confirm(this.env.sound);
    this.onLaunch(c);
  }

  private say(text: string) {
    this.toast = { text, t: 2 };
  }

  private cabX(i: number) {
    const n = this.cabinets.length;
    return Math.round((W - (n * CAB_W + (n - 1) * GAP)) / 2) + i * (CAB_W + GAP);
  }

  private hitTest(x: number, y: number): number {
    if (y < CAB_TOP - 3 || y > CAB_BOTTOM) return -1;
    return this.cabinets.findIndex((_, i) => x >= this.cabX(i) && x < this.cabX(i) + CAB_W);
  }

  private drawSign(g: CanvasRenderingContext2D) {
    // Seltenes, kurzes Flackern – Atmosphäre, aber nicht hektisch
    const flicker = this.t % 9 > 8.7 && Math.floor(this.t * 20) % 2 === 0;
    g.fillStyle = C.alpha(C.MAGENTA, 0.06);
    g.fillRect(100, 6, W - 200, 26);
    drawText(g, 'ARCADE ARENA', W / 2, 12, {
      scale: 2,
      color: flicker ? '#5a1a58' : C.MAGENTA,
      align: 'center',
      glow: !flicker,
    });
  }

  private drawCabinet(g: CanvasRenderingContext2D, c: CabinetInfo, i: number) {
    const x = this.cabX(i);
    const y = CAB_TOP;
    const selected = i === this.sel;
    const lit = !!c.create;

    // Lichtkegel auf dem Boden
    if (selected) {
      g.fillStyle = C.alpha(c.color, 0.16);
      for (let k = 0; k < 8; k++) g.fillRect(x - 8 + k * 2, CAB_BOTTOM + k * 2, CAB_W + 16 - k * 4, 2);
    }

    // Gehäuse
    g.fillStyle = '#2a1d4a';
    g.fillRect(x, y - 3, CAB_W, 3);
    g.fillStyle = BODY;
    g.fillRect(x, y + 20, CAB_W, CAB_BOTTOM - y - 20);
    g.fillStyle = C.alpha(c.color, lit ? 0.8 : 0.35);
    g.fillRect(x, y + 20, 2, CAB_BOTTOM - y - 20);
    g.fillRect(x + CAB_W - 2, y + 20, 2, CAB_BOTTOM - y - 20);

    // Marquee
    g.fillStyle = '#0f0820';
    g.fillRect(x + 2, y, CAB_W - 4, 20);
    g.fillStyle = C.alpha(c.color, lit ? 0.22 : 0.08);
    g.fillRect(x + 3, y + 1, CAB_W - 6, 18);
    strokeRect(g, x + 2, y, CAB_W - 4, 20, c.color);
    drawText(g, c.title, x + CAB_W / 2, y + 7, { color: lit ? C.WHITE : '#b8acd8', align: 'center', glow: lit });

    // Bildschirm
    g.fillStyle = DARK;
    g.fillRect(x + 8, y + 24, 88, 72);
    strokeRect(g, x + 8, y + 24, 88, 72, '#2c2050');
    const sx = x + 12;
    const sy = y + 28;
    g.fillStyle = C.BLACK;
    g.fillRect(sx, sy, 80, 64);
    g.save();
    g.beginPath();
    g.rect(sx, sy, 80, 64);
    g.clip();
    if (lit) this.drawAttract(g, c, i, sx, sy);
    else this.drawOutOfOrder(g, sx, sy);
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(sx + 3, sy + 2, 24, 1);

    // Bedienfeld mit Joystick und Knöpfen
    const py = y + 98;
    for (let k = 0; k < 30; k++) {
      const inset = Math.round(6 - (k * 6) / 30);
      g.fillStyle = k === 0 ? '#4a3680' : PANEL;
      g.fillRect(x + inset, py + k, CAB_W - inset * 2, 1);
    }
    const buttons = c.controls.filter((h) => h.type === 'button');
    const stickX = buttons.length ? x + 26 : x + CAB_W / 2;
    fillCircle(g, stickX, py + 22, 6, '#120a22');
    g.fillStyle = '#bdb6d6';
    g.fillRect(stickX - 1, py + 10, 2, 12);
    fillCircle(g, stickX, py + 10, 4, C.RED);
    g.fillStyle = C.WHITE;
    g.fillRect(stickX - 2, py + 8, 1, 1);
    const buttonColors = [C.YELLOW, C.RED];
    buttons.slice(0, 2).forEach((_, k) => {
      const bx = x + 58 + k * 20;
      fillCircle(g, bx, py + 18, 6, '#120a22');
      fillCircle(g, bx, py + 17, 5, buttonColors[k]);
      g.fillStyle = C.WHITE;
      g.fillRect(bx - 2, py + 14, 1, 1);
    });

    // Schild mit der Tastenbelegung
    g.fillStyle = '#0e0820';
    g.fillRect(x + 6, y + 132, CAB_W - 12, 30);
    strokeRect(g, x + 6, y + 132, CAB_W - 12, 30, C.alpha(c.color, 0.5));
    c.controls.forEach((h, k) => {
      drawText(g, `${h.keys} ${h.label}`, x + CAB_W / 2, y + 135 + k * 9, { color: C.WHITE, align: 'center' });
    });

    // Münztür
    g.fillStyle = DARK;
    g.fillRect(x + 30, y + 168, 44, 26);
    strokeRect(g, x + 30, y + 168, 44, 26, '#3a2a5a');
    const slotOn = lit && (!selected || this.t % 1 < 0.6);
    for (const ox of [38, 62]) {
      g.fillStyle = slotOn ? C.RED : '#4a1a26';
      g.fillRect(x + ox, y + 173, 4, 8);
    }
    drawText(g, 'COIN', x + CAB_W / 2, y + 184, { color: '#5a4a80', align: 'center' });

    if (selected) {
      const pulse = 0.55 + 0.45 * Math.sin(this.t * 4);
      strokeRect(g, x - 2, y - 5, CAB_W + 4, CAB_BOTTOM - y + 5, C.alpha(c.color, pulse));
      strokeRect(g, x - 3, y - 6, CAB_W + 6, CAB_BOTTOM - y + 7, C.alpha(c.color, pulse * 0.35));
    } else {
      g.fillStyle = 'rgba(5,3,12,0.45)';
      g.fillRect(x, y - 3, CAB_W, CAB_BOTTOM - y + 3);
    }
  }

  private drawAttract(g: CanvasRenderingContext2D, c: CabinetInfo, i: number, sx: number, sy: number) {
    const best = this.best[i];
    drawText(g, `HI ${best?.name ?? '---'} ${best?.score ?? 0}`, sx + 40, sy + 3, { color: c.accent, align: 'center' });
    c.attract?.(g, sx, sy + 13, 80, 36, this.t);
    if (this.t % 1 < 0.6) drawText(g, 'INSERT COIN', sx + 40, sy + 54, { color: C.WHITE, align: 'center' });
  }

  private drawOutOfOrder(g: CanvasRenderingContext2D, sx: number, sy: number) {
    for (let k = 0; k < 90; k++) {
      g.fillStyle = Math.random() < 0.5 ? '#2a2640' : '#16131f';
      g.fillRect(sx + Math.floor(Math.random() * 80), sy + Math.floor(Math.random() * 64), 2, 1);
    }
    g.fillStyle = C.YELLOW;
    g.fillRect(sx + 12, sy + 19, 56, 26);
    strokeRect(g, sx + 13, sy + 20, 54, 24, '#7a5a00');
    drawText(g, 'COMING', sx + 40, sy + 23, { color: C.BLACK, align: 'center' });
    drawText(g, 'SOON', sx + 40, sy + 33, { color: C.BLACK, align: 'center' });
  }
}

/** Wand und Boden einmalig vorzeichnen. */
function renderRoom(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;

  g.fillStyle = '#0a0616';
  g.fillRect(0, 0, W, CAB_BOTTOM);
  g.fillStyle = '#140c28';
  for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 1, CAB_BOTTOM);
  g.fillStyle = '#2a1650';
  g.fillRect(0, CAB_BOTTOM - 2, W, 2);

  g.fillStyle = '#0d0718';
  g.fillRect(0, CAB_BOTTOM, W, H - CAB_BOTTOM);
  g.fillStyle = '#1e1040';
  let gap = 3;
  for (let y = CAB_BOTTOM + 3; y < H; y += gap, gap *= 1.35) g.fillRect(0, Math.round(y), W, 1);
  // Fluchtlinien zum Punkt hinter der Wand
  const vy = CAB_BOTTOM - 40;
  for (let y = CAB_BOTTOM; y < H; y++) {
    const f = (y - vy) / (H - vy);
    for (let k = -10; k <= 10; k++) g.fillRect(Math.round(W / 2 + k * 44 * f), y, 1, 1);
  }
  return c;
}
