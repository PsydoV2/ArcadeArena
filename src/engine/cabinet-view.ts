import { RES, useHiRes } from './draw';
import { drawText, GLYPH_H, textWidth } from './font';
import type { Action, Input } from './input';
import * as C from './palette';
import type { Screen } from './screen';
import { SCREEN_H as H, SCREEN_W as W, type CabinetInfo, type Rect } from './types';

// Maße der Automatenfront in Spielpixeln, rund um den Bildschirm
/** Etwas Luft über dem Automaten. */
const MARGIN_TOP = 10;
const TOP_H = 6;
const MARQUEE_H = 34;
const BEZEL_X = 14;
const BEZEL_Y = 12;
const SIDE_W = 30;
/** So viel vom Bedienfeld ist mindestens noch zu sehen. */
const PANEL_H = 60;
const FRONT_W = W + 2 * (BEZEL_X + SIDE_W);
const FRONT_H = MARGIN_TOP + TOP_H + MARQUEE_H + BEZEL_Y + H + BEZEL_Y + PANEL_H;
/** Nachbarautomaten stehen etwas näher als in der Halle, damit man sie am Rand noch sieht. */
const NEIGHBOR_GAP = 70;
/** Wie stark das Bedienfeld nach vorn breiter wird (Perspektive). */
const PANEL_SPREAD = 0.45;
/** Stärke des Lichts, das der Bildschirm aufs Gehäuse wirft. */
const LIGHT = 0.6;
/** Die Lichtebene wird in 1/LIGHT_DOWN Auflösung gerechnet – sie ist ohnehin weich. */
const LIGHT_DOWN = 4;
const HALL_RADIUS = 18;

const BODY = '#1b1233';
const PANEL = '#2a1f52';
const LABEL = '#b8acd8';
const F = 1 / RES;

interface Button {
  x: number;
  y: number;
  color: string;
  action: Action;
}

/**
 * Die Ansicht direkt vor einem Automaten: Gehäuse mit Marquee, Blende und Bedienfeld rund um den Bildschirm,
 * Joystick und Knöpfe bewegen sich mit der Eingabe, das Bild wirft sein Licht aufs Gehäuse.
 * Dazu der Zoom aus der Halle an den Automaten heran (und zurück).
 */
export class CabinetView {
  /** Rückwand und Boden der Halle, hinter dem Bildschirm. */
  private back = document.createElement('canvas');
  /** Gehäuse vor dem Bildschirm, mit Loch für das Bild. */
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private bg: CanvasRenderingContext2D;
  /** Unbewegliche Teile des Gehäuses (neu gezeichnet bei Automaten- oder Größenwechsel). */
  private base = document.createElement('canvas');
  private light = document.createElement('canvas');
  /** Wo Licht hinfällt: Gehäuse, zum Rand hin schwächer. */
  private mask = document.createElement('canvas');
  /** Mittlere Farben des Bildes in grobem Raster. */
  private sample = document.createElement('canvas');

  private info: CabinetInfo | null = null;
  private neighbors: (CabinetInfo | undefined)[] = [];
  private zoom = 0;
  private from: Rect | null = null;
  /** CSS-Pixel pro Spielpixel: am Automaten bzw. in der Halle. */
  private s = 1;
  private hallS = 1;
  /** Fenstergröße in Spielpixeln. */
  private vw = 0;
  private vh = 0;
  /** Linke obere Ecke des Bildschirms in Spielpixeln. */
  private hx = 0;
  private hy = 0;
  private stick = { x: 0, y: 0 };
  private buttons: Button[] = [];
  private start = { x: 0, y: 0 };

  constructor(
    root: HTMLElement,
    private screen: Screen,
    private input: Input,
  ) {
    this.back.className = 'cabinet-back';
    this.canvas.className = 'cabinet';
    root.prepend(this.back);
    root.append(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    this.bg = this.back.getContext('2d')!;
    this.sample.width = 16;
    this.sample.height = 12;
    window.addEventListener('resize', () => this.layout());
    this.layout();
  }

  /** Vor welchem Automaten man steht (Marquee, Farben, Bedienfeld) und wer links und rechts daneben steht. */
  show(info: CabinetInfo, neighbors: (CabinetInfo | undefined)[] = []): void {
    this.info = info;
    this.neighbors = neighbors;
    this.paint();
  }

  /**
   * 0 = Halle (nur der Bildschirm), 1 = man steht am Automaten, dazwischen der Zoom.
   * `from` ist das kleine Bildschirmchen des Automaten in Hallenpixeln – dort setzt der Zoom an.
   */
  setZoom(zoom: number, from: Rect | null = null): void {
    this.zoom = Math.max(0, Math.min(1, zoom));
    this.from = from;
    this.apply();
  }

  /** Nach `screen.present()` aufrufen: bewegliche Teile und Licht. */
  render(): void {
    if (this.zoom <= 0 || !this.info) return;
    const g = this.g;
    g.clearRect(0, 0, this.vw, this.vh);
    g.drawImage(this.base, 0, 0, this.vw, this.vh);
    this.drawLight(g);
    this.drawControls(g);

    // Seltenes, kurzes Flackern der Marquee-Röhre
    const t = performance.now() / 1000;
    if (t % 13 > 12.75 && Math.floor(t * 24) % 2 === 0) {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(this.hx - BEZEL_X + 3, this.hy - BEZEL_Y - MARQUEE_H + 3, W + 2 * BEZEL_X - 6, MARQUEE_H - 6);
    }
  }

  // ---------- Größe und Lage ----------

  private layout() {
    const iw = innerWidth;
    const ih = innerHeight;
    // Halle: möglichst groß – gerade für ältere Augen wichtiger als exakt ganzzahlige Pixel
    this.hallS = Math.min((iw - 16) / W, (ih - 16) / H);
    // Am Automaten: Marquee oben und ein Stück Bedienfeld unten müssen mit drauf
    this.s = Math.min(ih / FRONT_H, (iw - 16) / FRONT_W);
    this.vw = Math.ceil(iw / this.s);
    this.vh = Math.ceil(ih / this.s);
    this.hx = Math.round((this.vw - W) / 2);
    this.hy = Math.max(0, Math.floor((this.vh - FRONT_H) / 2)) + MARGIN_TOP + TOP_H + MARQUEE_H + BEZEL_Y;

    for (const c of [this.canvas, this.back, this.base]) {
      c.width = this.vw * RES;
      c.height = this.vh * RES;
    }
    for (const c of [this.canvas, this.back]) {
      c.style.width = `${this.vw * this.s}px`;
      c.style.height = `${this.vh * this.s}px`;
    }
    for (const c of [this.light, this.mask]) {
      c.width = Math.ceil(this.vw / LIGHT_DOWN);
      c.height = Math.ceil(this.vh / LIGHT_DOWN);
    }
    useHiRes(this.g);
    useHiRes(this.bg);
    useHiRes(this.base.getContext('2d')!);
    this.paint();
    this.apply();
  }

  private apply() {
    const frame = this.screen.frame;
    const hallLeft = (innerWidth - W * this.hallS) / 2;
    const hallTop = (innerHeight - H * this.hallS) / 2;
    const zoom = this.info ? this.zoom : 0;

    if (zoom <= 0) {
      this.screen.place(hallLeft, hallTop, this.hallS, HALL_RADIUS);
      layer(frame, '', 1);
      layer(this.canvas, '', 0);
      layer(this.back, '', 0);
      return;
    }
    if (zoom >= 1) {
      this.screen.place(this.hx * this.s, this.hy * this.s, this.s, 3 * this.s);
      layer(frame, '', 1);
      layer(this.canvas, '', 1);
      layer(this.back, '', 1);
      return;
    }

    // Unterwegs zeigt der Bildschirm noch die Halle; Halle und Gehäuse werden gemeinsam vergrößert,
    // so dass das Bildschirmchen des Automaten in der Halle genau ins Loch des Gehäuses wächst.
    this.screen.place(hallLeft, hallTop, this.hallS, HALL_RADIUS);
    const e = zoom < 0.5 ? 4 * zoom ** 3 : 1 - (-2 * zoom + 2) ** 3 / 2;
    const from = this.from ?? { x: W / 2 - 11, y: H / 2 - 5, w: 22, h: 10 };
    const p0x = hallLeft + (from.x + from.w / 2) * this.hallS;
    const p0y = hallTop + (from.y + from.h / 2) * this.hallS;
    const qx = (this.hx + W / 2) * this.s;
    const qy = (this.hy + H / 2) * this.s;
    const full = (W * this.s) / (from.w * this.hallS);
    // Logarithmisch zoomen, sonst wirkt es am Ende wie ein Ruck
    const k = full ** e;
    const px = p0x + (qx - p0x) * e;
    const py = p0y + (qy - p0y) * e;
    layer(frame, `translate(${px + k * (hallLeft - p0x) - hallLeft}px,${py + k * (hallTop - p0y) - hallTop}px) scale(${k})`, 1 - smooth(0.5, 0.92, e));
    const c = k / full;
    layer(this.canvas, `translate(${px - c * qx}px,${py - c * qy}px) scale(${c})`, smooth(0.25, 0.7, e));
    layer(this.back, '', smooth(0.55, 1, e));
  }

  // ---------- Zeichnen ----------

  private paint() {
    const info = this.info;
    if (!info) return;
    this.paintBack(info);

    const g = this.base.getContext('2d')!;
    g.clearRect(0, 0, this.vw, this.vh);
    // Nachbarn etwas abgedunkelt – der eigene Automat steht im Mittelpunkt. Sie gehören zum Hintergrund,
    // der erst am Ende des Zooms einblendet: ihr Abstand ist geschummelt und passt nicht zur Halle.
    const step = FRONT_W + NEIGHBOR_GAP;
    this.neighbors.forEach((n, i) => n && this.drawFront(g, n, this.hx + (i === 0 ? -step : step), false));
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(5,3,10,0.45)';
    g.fillRect(0, 0, this.vw, this.vh);
    g.restore();
    this.bg.drawImage(this.base, 0, 0, this.vw, this.vh);
    g.clearRect(0, 0, this.vw, this.vh);
    this.drawFront(g, info, this.hx, true);
    this.paintMask();
    this.drawGlass(g);
  }

  /** Dunkle Rückwand mit dem Schein des Automaten, unten ein Stück Teppich. */
  private paintBack(info: CabinetInfo) {
    const g = this.bg;
    const { vw, vh } = this;
    for (let y = 0; y < vh; y += 2) {
      g.fillStyle = C.shade('#140c2c', -0.6 * (y / vh));
      g.fillRect(0, y, vw, 2);
    }
    const glow = g.createRadialGradient(vw / 2, this.hy, 0, vw / 2, this.hy, vw * 0.6);
    glow.addColorStop(0, C.alpha(info.color, 0.14));
    glow.addColorStop(1, C.alpha(info.color, 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, vw, vh);

    const floorY = this.hy + H + BEZEL_Y + 14;
    g.fillStyle = '#0c0719';
    g.fillRect(0, floorY, vw, vh - floorY);
    g.fillStyle = '#1e1438';
    g.fillRect(0, floorY, vw, F);
    // Konfetti im Teppich, nach vorn größer
    const colors = [C.MAGENTA, C.CYAN, C.YELLOW, C.GREEN];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 160; i++) {
      const y = floorY + 2 + rnd() * (vh - floorY);
      const size = 0.5 + ((y - floorY) / (vh - floorY + 1)) * 1.5;
      g.fillStyle = C.alpha(colors[i % colors.length], 0.22);
      g.fillRect(Math.round(rnd() * vw), Math.round(y), size, size / 2);
    }
  }

  /** Gehäusefront: Seitenwände, Marquee, Blende und Bedienfeld. `own`: der Automat, an dem man spielt. */
  private drawFront(g: CanvasRenderingContext2D, info: CabinetInfo, hx: number, own: boolean) {
    const hy = this.hy;
    const vh = this.vh;
    const color = info.color;
    const bx0 = hx - BEZEL_X;
    const bx1 = hx + W + BEZEL_X;
    const L = bx0 - SIDE_W;
    const R = bx1 + SIDE_W;
    const top = hy - BEZEL_Y - MARQUEE_H - TOP_H;
    const mqY = top + TOP_H;
    const bzY = mqY + MARQUEE_H;
    const bzB = hy + H + BEZEL_Y;

    // Seitenwände: innen zur Blende hin dunkler, außen die Stirnkante mit farbiger T-Leiste
    for (let i = 0; i < SIDE_W; i++) {
      const k = i / SIDE_W;
      g.fillStyle = C.shade(BODY, 0.12 - 0.55 * k);
      g.fillRect(L + i, top, 1, vh - top);
      g.fillRect(R - 1 - i, top, 1, vh - top);
    }
    for (const x of [L, R - 3]) {
      g.fillStyle = C.shade(color, -0.45);
      g.fillRect(x, top, 3, vh - top);
      g.fillStyle = C.alpha(color, 0.9);
      g.fillRect(x + F, top, 2, vh - top);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(x + 1, top, F, vh - top);
    }

    // Deckel
    box(g, L, top, R - L, TOP_H, '#2a1d4a');
    g.fillStyle = C.alpha(color, 0.9);
    g.fillRect(L, top, R - L, 1.5);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(L, top + F, R - L, F);

    // Marquee: hinterleuchtetes Schild mit dem Titel als Neonschrift
    box(g, bx0, mqY, bx1 - bx0, MARQUEE_H, '#0b0716');
    const ix = bx0 + 3;
    const iy = mqY + 3;
    const iw = bx1 - bx0 - 6;
    const ih = MARQUEE_H - 6;
    for (let r = 0; r < ih; r += F) {
      const t = (r / ih) * 2 - 1;
      g.fillStyle = C.shade(color, -0.82 + 0.32 * (1 - t * t));
      g.fillRect(ix, iy + r, iw, F);
    }
    g.fillStyle = C.alpha(color, 0.7);
    g.fillRect(ix, iy + 2, iw, F);
    g.fillRect(ix, iy + ih - 2.5, iw, F);
    g.fillStyle = C.alpha(info.accent, 0.8);
    for (let x = ix + 4; x < ix + iw - 3; x += 6) {
      g.fillRect(x, iy + 0.5, 1, F);
      g.fillRect(x, iy + ih - 1, 1, F);
    }
    const scale = textWidth(info.title, 3) <= iw - 24 ? 3 : 2;
    const tx = hx + W / 2;
    const ty = iy + (ih - GLYPH_H * scale) / 2;
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      drawText(g, info.title, tx + ox, ty + oy, { scale, color, align: 'center', glow: true });
    }
    drawText(g, info.title, tx, ty, { scale, color: C.shade(color, 0.7), align: 'center' });
    // Chromleiste unter dem Marquee
    g.fillStyle = '#4a3880';
    g.fillRect(bx0, bzY - 1.5, bx1 - bx0, 1.5);
    g.fillStyle = '#8a78c0';
    g.fillRect(bx0, bzY - 1.5, bx1 - bx0, F);

    // Blende um die Röhre
    box(g, bx0, bzY, bx1 - bx0, bzB - bzY, '#0d0819', '#1e1436', '#05030a');
    g.fillStyle = C.alpha(color, 0.3);
    g.fillRect(hx - 5, hy - 5, W + 10, F);
    g.fillRect(hx - 5, hy + H + 4.5, W + 10, F);
    g.fillRect(hx - 5, hy - 5, F, H + 10);
    g.fillRect(hx + W + 4.5, hy - 5, F, H + 10);
    g.fillStyle = '#05030a';
    g.fillRect(hx - 2, hy - 2, W + 4, H + 4);
    drawText(g, 'ARCADE ARENA', hx + W / 2, hy + H + (BEZEL_Y - GLYPH_H) / 2, { color: C.shade(C.MAGENTA, -0.35), align: 'center' });
    if (own) {
      g.clearRect(hx, hy, W, H);
    } else {
      // Nachbar: dunkles Bild mit etwas Schein in seiner Farbe
      g.fillStyle = '#07040e';
      g.fillRect(hx, hy, W, H);
      g.fillStyle = C.alpha(color, 0.07);
      for (let y = hy; y < hy + H; y += 3) g.fillRect(hx, y, W, 1.5);
    }
    // Abgerundete Ecken der Röhre
    const r = 4;
    g.fillStyle = '#05030a';
    for (let j = 0; j < r; j += F) {
      const dy = r - j - F / 2;
      const inset = Math.round((r - Math.sqrt(r * r - dy * dy)) * RES) / RES;
      if (!inset) continue;
      g.fillRect(hx, hy + j, inset, F);
      g.fillRect(hx + W - inset, hy + j, inset, F);
      g.fillRect(hx, hy + H - j - F, inset, F);
      g.fillRect(hx + W - inset, hy + H - j - F, inset, F);
    }

    // Bedienfeld: schräg von oben gesehen, wird nach vorn breiter
    box(g, bx0 - 2, bzB, bx1 - bx0 + 4, 3, '#140d28');
    const y0 = bzB + 3;
    for (let y = y0; y < vh; y += F) {
      const d = Math.floor((y - y0) * PANEL_SPREAD * RES) / RES;
      const l = L - 2 - d;
      const w = R - L + 4 + 2 * d;
      g.fillStyle = C.shade(PANEL, 0.14 * ((y - y0) / (vh - y0)));
      g.fillRect(l, y, w, F);
      g.fillStyle = C.alpha(color, 0.85);
      g.fillRect(l, y, 2.5, F);
      g.fillRect(l + w - 2.5, y, 2.5, F);
    }
    g.fillStyle = '#6a58a8';
    g.fillRect(L - 2, y0, R - L + 4, F);
    // Zierstreifen in Automatenfarbe
    for (const [sy, a] of [[y0 + 3, 0.35], [y0 + 4.5, 0.18]] as const) {
      const d = (sy - y0) * PANEL_SPREAD;
      g.fillStyle = C.alpha(color, a);
      g.fillRect(L + 1 - d, sy, R - L - 2 + 2 * d, 1);
    }
    if (own) this.layoutControls(g, info, hx, y0);
  }

  /** Lage von Joystick und Knöpfen nach den Steuerungshinweisen des Spiels, dazu die aufgedruckten Beschriftungen. */
  private layoutControls(g: CanvasRenderingContext2D, info: CabinetInfo, hx: number, y0: number) {
    const cx = hx + W / 2;
    const stick = info.controls.find((c) => c.type === 'stick');
    const buttons = info.controls.filter((c) => c.type === 'button');
    this.stick = { x: cx - 120, y: y0 + 33 };
    if (stick) {
      drawText(g, stick.label, this.stick.x, y0 + 41, { color: LABEL, align: 'center' });
      drawText(g, stick.keys, this.stick.x, y0 + 49, { color: C.DIM, align: 'center' });
    }
    const colors = [C.RED, C.YELLOW, C.BLUE];
    this.buttons = buttons.map((b, i) => {
      const x = cx + 50 + i * 36;
      const y = y0 + 31 - i * 2;
      drawText(g, b.label, x, y + 8, { color: LABEL, align: 'center' });
      drawText(g, b.keys, x, y + 16, { color: C.DIM, align: 'center' });
      return { x, y, color: colors[i % colors.length], action: b.keys.includes('SHIFT') ? 'b' : 'a' };
    });
    this.start = { x: cx - 14, y: y0 + 13 };
    drawText(g, 'START', this.start.x + 9, this.start.y - 3, { color: LABEL });
    drawText(g, 'ENTER', this.start.x + 9, this.start.y + 5, { color: C.DIM });
  }

  /** Glasreflex und Schatten der Blende über dem Bild. */
  private drawGlass(g: CanvasRenderingContext2D) {
    const { hx, hy } = this;
    g.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = 0; y < H * 0.6; y++) {
      const w = 80 * (1 - y / (H * 0.6));
      const x = Math.max(hx, hx + 46 - y * 0.55);
      g.fillRect(x, hy + y, Math.min(w, hx + W - x), 1);
    }
    g.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = 0; y < H * 0.4; y++) {
      const x = hx + 140 - y * 0.55;
      if (x > hx) g.fillRect(x, hy + y, 12, 1);
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(hx, hy, W, 1.5);
    g.fillRect(hx, hy, 1, H);
  }

  /** Wohin das Licht des Bildes fällt: aufs Gehäuse, mit dem Abstand zum Bildschirm schwächer. */
  private paintMask() {
    const g = this.mask.getContext('2d')!;
    const { width: lw, height: lh } = this.mask;
    const cx = (this.hx + W / 2) / LIGHT_DOWN;
    const cy = (this.hy + H / 2) / LIGHT_DOWN;
    const radius = (W * 1.05) / LIGHT_DOWN;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, lw, lh);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    grad.addColorStop(0.75, 'rgba(255,255,255,0.2)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, lw, lh);
    g.globalCompositeOperation = 'destination-in';
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, 0, 0, lw, lh);
    g.globalCompositeOperation = 'source-over';
  }

  private drawLight(g: CanvasRenderingContext2D) {
    const sg = this.sample.getContext('2d')!;
    sg.imageSmoothingEnabled = true;
    sg.clearRect(0, 0, 16, 12);
    sg.drawImage(this.screen.bloom, 0, 0, 16, 12);

    const lg = this.light.getContext('2d')!;
    const { width: lw, height: lh } = this.light;
    const cx = (this.hx + W / 2) / LIGHT_DOWN;
    const cy = (this.hy + H / 2) / LIGHT_DOWN;
    const rw = (W * 2.2) / LIGHT_DOWN;
    const rh = (H * 2.2) / LIGHT_DOWN;
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, lw, lh);
    lg.imageSmoothingEnabled = true;
    lg.drawImage(this.sample, cx - rw / 2, cy - rh / 2, rw, rh);
    lg.globalCompositeOperation = 'destination-in';
    lg.drawImage(this.mask, 0, 0);

    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = LIGHT;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.light, 0, 0, this.vw, this.vh);
    g.restore();
  }

  /** Joystick und Knöpfe – sie folgen Tastatur und Gamepad. */
  private drawControls(g: CanvasRenderingContext2D) {
    const input = this.input;
    const { x: sx, y: sy } = this.stick;
    const dx = ((input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0)) * 5;
    const dy = ((input.held('down') ? 1 : 0) - (input.held('up') ? 1 : 0)) * 2.5;
    ellipse(g, sx, sy, 11, 4.5, '#0b0716');
    ellipse(g, sx, sy - F, 8, 3, '#1a1130');
    // Kugel und ihr Schatten aufs Bedienfeld
    const bx = sx + dx;
    const by = sy - 15 + dy;
    ellipse(g, sx + dx * 0.6, sy + 0.5, 6, 2.2, 'rgba(0,0,0,0.4)');
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const x = Math.round((sx + (bx - sx) * k) * RES) / RES;
      const y = Math.round((sy - 1 + (by - sy + 1) * k) * RES) / RES;
      g.fillStyle = '#9a90b8';
      g.fillRect(x - 1.25, y, 2.5, 1);
      g.fillStyle = '#e0d8f8';
      g.fillRect(x - 0.75, y, F, 1);
    }
    ellipse(g, bx, by, 6.5, 6.5, C.shade(C.RED, -0.5));
    ellipse(g, bx - 0.5, by - 0.75, 5.5, 5.5, C.RED);
    ellipse(g, bx - 2, by - 2.5, 1.75, 1.25, '#ffd0d8');

    for (const b of this.buttons) drawButton(g, b.x, b.y, 9, b.color, input.held(b.action));
    const blink = performance.now() % 1000 < 500;
    drawButton(g, this.start.x, this.start.y, 5, blink ? C.YELLOW : C.shade(C.YELLOW, -0.55), input.held('start'));
  }
}

function layer(el: HTMLElement, transform: string, opacity: number) {
  el.style.transform = transform;
  el.style.opacity = String(opacity);
  el.style.visibility = opacity > 0 ? 'visible' : 'hidden';
}

/** 0 bis a, weich ansteigend bis 1 bei b. */
function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Pixelgenaue gefüllte Ellipse im feinen Raster. */
function ellipse(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string) {
  g.fillStyle = color;
  for (let y = -ry; y < ry; y += F) {
    const m = (y + F / 2) / ry;
    const half = rx * Math.sqrt(Math.max(0, 1 - m * m));
    const x0 = Math.round((cx - half) * RES) / RES;
    const x1 = Math.round((cx + half) * RES) / RES;
    if (x1 > x0) g.fillRect(x0, Math.round((cy + y) * RES) / RES, x1 - x0, F);
  }
}

/** Arcade-Knopf schräg von oben: Fassung, Kappe mit Seitenwand, Glanz; gedrückt sinkt er ein und leuchtet. */
function drawButton(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, pressed: boolean) {
  const ry = r * 0.5;
  if (pressed) ellipse(g, x, y, r * 1.45, ry * 1.6, C.alpha(color, 0.3));
  ellipse(g, x, y, r, ry, '#0b0716');
  const cap = r * 0.82;
  const lift = pressed ? r * 0.06 : r * 0.24;
  ellipse(g, x, y - F, cap, cap * 0.5, C.shade(color, -0.5));
  ellipse(g, x, y - lift, cap, cap * 0.5, pressed ? C.shade(color, 0.35) : color);
  ellipse(g, x - cap * 0.35, y - lift - cap * 0.18, cap * 0.28, cap * 0.12, C.shade(color, 0.7));
}

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
) {
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  g.fillStyle = light;
  g.fillRect(x, y, w, F);
  g.fillRect(x, y, F, h);
  g.fillStyle = dark;
  g.fillRect(x, y + h - F, w, F);
  g.fillRect(x + w - F, y, F, h);
}
