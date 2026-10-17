import { SCREEN_H, SCREEN_W } from './types';

export interface Screen {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
}

/** Canvas mit fester Auflösung, ganzzahlig hochskaliert, plus CRT-Overlay. */
export function createScreen(root: HTMLElement): Screen {
  const frame = document.createElement('div');
  frame.className = 'crt';
  const canvas = document.createElement('canvas');
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  const overlay = document.createElement('div');
  overlay.className = 'crt-overlay';
  frame.append(canvas, overlay);
  root.append(frame);

  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;

  const fit = () => {
    const fitScale = Math.min((innerWidth - 16) / SCREEN_W, (innerHeight - 16) / SCREEN_H);
    // Ganzzahlig für scharfe Pixel; nur bei sehr kleinen Fenstern verkleinern
    const s = fitScale >= 1 ? Math.floor(fitScale) : fitScale;
    frame.style.width = `${SCREEN_W * s}px`;
    frame.style.height = `${SCREEN_H * s}px`;
    overlay.style.backgroundSize = `100% ${Math.max(2, Math.round(s))}px, 100% 100%`;
  };
  fit();
  window.addEventListener('resize', fit);

  return { canvas, g };
}
