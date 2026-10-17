import { SCREEN_H, SCREEN_W } from './types';

export interface Screen {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  /** Nach dem Zeichnen aufrufen: aktualisiert das Neon-Glühen. */
  present(): void;
}

/**
 * Canvas mit fester Auflösung, so groß wie möglich skaliert, plus CRT-Effekte:
 * Bloom (weiches Leuchten heller Pixel), Scanlines und Vignette.
 */
export function createScreen(root: HTMLElement): Screen {
  const frame = document.createElement('div');
  frame.className = 'crt';
  const canvas = document.createElement('canvas');
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  const bloom = document.createElement('canvas');
  bloom.className = 'crt-bloom';
  bloom.width = SCREEN_W / 2;
  bloom.height = SCREEN_H / 2;
  const overlay = document.createElement('div');
  overlay.className = 'crt-overlay';
  frame.append(canvas, bloom, overlay);
  root.append(frame);

  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const bg = bloom.getContext('2d')!;

  const fit = () => {
    // Möglichst groß – gerade für ältere Augen wichtiger als exakt ganzzahlige Pixel
    const s = Math.min((innerWidth - 16) / SCREEN_W, (innerHeight - 16) / SCREEN_H);
    frame.style.width = `${Math.floor(SCREEN_W * s)}px`;
    frame.style.height = `${Math.floor(SCREEN_H * s)}px`;
    overlay.style.backgroundSize = `100% ${Math.max(2, s)}px, 100% 100%`;
    bloom.style.filter = `blur(${Math.max(2, s * 2.2)}px) brightness(1.6)`;
  };
  fit();
  window.addEventListener('resize', fit);

  return {
    canvas,
    g,
    present() {
      bg.drawImage(canvas, 0, 0, bloom.width, bloom.height);
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
