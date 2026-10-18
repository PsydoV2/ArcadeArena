export const BLACK = '#000000';
export const WHITE = '#f4f1ff';
export const DIM = '#7a6eaa';
export const MAGENTA = '#ff3df2';
export const CYAN = '#3df5ff';
export const GREEN = '#5dff6a';
export const YELLOW = '#ffe23d';
export const ORANGE = '#ff9a3d';
export const RED = '#ff3d5a';
export const BLUE = '#4d7dff';

/** '#rrggbb' + Deckkraft → 'rgba(...)'. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Hellt eine Farbe auf (f > 0, Richtung Weiß) oder dunkelt sie ab (f < 0, Richtung Schwarz). */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f));
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(ch);
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
