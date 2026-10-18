import { RES, useHiRes } from './draw';
import { SCREEN_H, SCREEN_W } from './types';

export interface Screen {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  /** Rahmen um Bild, Glühen und Scanlines (wird für Halle, Automat und Zoom verschoben). */
  frame: HTMLDivElement;
  /** Verkleinerte Kopie des letzten Bildes – auch Lichtquelle für das Automatengehäuse. */
  bloom: HTMLCanvasElement;
  /** Nach dem Zeichnen aufrufen: aktualisiert das Neon-Glühen. */
  present(): void;
  /** Bild an diese Stelle legen (CSS-Pixel); s = CSS-Pixel pro Spielpixel. */
  place(left: number, top: number, s: number, radius: number): void;
}

/**
 * Canvas mit fester Auflösung (intern RES-fach fein gerastert) plus CRT-Effekte:
 * Bloom (weiches Leuchten heller Pixel), Scanlines und Vignette. Wo und wie groß es liegt, bestimmt `place`.
 */
export function createScreen(root: HTMLElement): Screen {
  const frame = document.createElement('div');
  frame.className = 'crt';
  const canvas = document.createElement('canvas');
  canvas.width = SCREEN_W * RES;
  canvas.height = SCREEN_H * RES;
  const bloom = document.createElement('canvas');
  bloom.className = 'crt-bloom';
  bloom.width = SCREEN_W / 2;
  bloom.height = SCREEN_H / 2;
  const overlay = document.createElement('div');
  overlay.className = 'crt-overlay';
  frame.append(canvas, bloom, overlay);
  root.append(frame);

  const g = canvas.getContext('2d')!;
  useHiRes(g);
  const bg = bloom.getContext('2d')!;
  let placed = '';

  return {
    canvas,
    g,
    frame,
    bloom,
    present() {
      bg.drawImage(canvas, 0, 0, bloom.width, bloom.height);
    },
    place(left, top, s, radius) {
      const key = `${left} ${top} ${s} ${radius}`;
      if (key === placed) return;
      placed = key;
      frame.style.left = `${left}px`;
      frame.style.top = `${top}px`;
      frame.style.width = `${SCREEN_W * s}px`;
      frame.style.height = `${SCREEN_H * s}px`;
      frame.style.borderRadius = `${radius}px`;
      overlay.style.backgroundSize = `100% ${Math.max(2, s)}px, 100% 100%`;
      bloom.style.filter = `blur(${Math.max(2, s * 2.2)}px) brightness(1.6)`;
    },
  };
}

export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

/** CRT-Einschalteffekt: ein heller Streifen öffnet sich zum Bild (k von 0 bis 1). */
export function drawPowerOn(g: CanvasRenderingContext2D, k: number): void {
  const e = 1 - (1 - k) ** 3;
  const band = Math.max(2, Math.round(SCREEN_H * e));
  const top = Math.round((SCREEN_H - band) / 2);
  g.fillStyle = '#000';
  g.fillRect(0, 0, SCREEN_W, top);
  g.fillRect(0, top + band, SCREEN_W, SCREEN_H - top - band);
  g.fillStyle = `rgba(255,255,255,${(1 - e) * 0.7})`;
  g.fillRect(0, top, SCREEN_W, band);
}

let scratch: HTMLCanvasElement | null = null;

/** CRT-Ausschalteffekt: das Bild schnurrt zu einer hellen Linie zusammen, dann zu einem Punkt (k von 0 bis 1). */
export function drawPowerOff(g: CanvasRenderingContext2D, k: number): void {
  const c = g.canvas;
  if (!scratch) {
    scratch = document.createElement('canvas');
    scratch.width = c.width;
    scratch.height = c.height;
  }
  scratch.getContext('2d')!.drawImage(c, 0, 0);
  g.save();
  // In echten Pixeln arbeiten, damit die Linie am Ende hauchdünn wird
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  if (k < 0.6) {
    const e = k / 0.6;
    const h = Math.max(RES, Math.round(c.height * (1 - e) ** 2));
    const y = Math.round((c.height - h) / 2);
    g.drawImage(scratch, 0, y, c.width, h);
    g.fillStyle = `rgba(255,255,255,${e * 0.85})`;
    g.fillRect(0, y, c.width, h);
  } else {
    const e = (k - 0.6) / 0.4;
    const w = Math.max(RES, Math.round(c.width * (1 - e) ** 3));
    g.fillStyle = `rgba(255,255,255,${1 - e * 0.5})`;
    g.fillRect(Math.round((c.width - w) / 2), c.height / 2 - RES / 2, w, RES);
  }
  g.restore();
}
