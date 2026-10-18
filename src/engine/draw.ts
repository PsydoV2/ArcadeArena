export type Sprite = HTMLCanvasElement;

/** Interne Pixel pro Spielpixel: jeder Spielpixel besteht aus RES×RES feineren Pixeln. */
export const RES = 2;

const pixelArt = new WeakSet<HTMLCanvasElement>();
const hiRes = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/**
 * Markiert eine (danach unveränderte) Canvas als Pixel-Art: auf hochauflösenden
 * Kontexten wird sie per Scale2x mit geglätteten Diagonalen gezeichnet.
 */
export function pixelArtCanvas<T extends HTMLCanvasElement>(c: T): T {
  pixelArt.add(c);
  return c;
}

/** Scale2x (EPX): jeder Pixel wird zu 2×2, Treppenstufen an Diagonalen werden aufgefüllt. */
function scale2x(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const out = document.createElement('canvas');
  out.width = w * 2;
  out.height = h * 2;
  if (!w || !h) return out;
  const p = new Uint32Array(src.getContext('2d')!.getImageData(0, 0, w, h).data.buffer);
  const img = new ImageData(w * 2, h * 2);
  const q = new Uint32Array(img.data.buffer);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : p[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = p[y * w + x];
      const a = at(x, y - 1);
      const b = at(x + 1, y);
      const c = at(x - 1, y);
      const d = at(x, y + 1);
      const i = y * 4 * w + x * 2;
      q[i] = c === a && c !== d && a !== b ? a : e;
      q[i + 1] = a === b && a !== c && b !== d ? b : e;
      q[i + w * 2] = d === c && d !== b && c !== a ? c : e;
      q[i + w * 2 + 1] = b === d && b !== a && d !== c ? d : e;
    }
  }
  out.getContext('2d')!.putImageData(img, 0, 0);
  return out;
}

/**
 * Stellt einen Kontext auf RES-fache Auflösung um. Gezeichnet wird weiter in Spielpixeln,
 * Pixel-Art-Canvases werden dabei automatisch durch ihre Scale2x-Fassung ersetzt.
 */
export function useHiRes(g: CanvasRenderingContext2D): void {
  g.setTransform(RES, 0, 0, RES, 0, 0);
  g.imageSmoothingEnabled = false;
  const draw = g.drawImage.bind(g) as (...args: unknown[]) => void;
  g.drawImage = ((img: CanvasImageSource, ...a: number[]) => {
    if (!(img instanceof HTMLCanvasElement) || !pixelArt.has(img)) return draw(img, ...a);
    let hd = hiRes.get(img);
    if (!hd) hiRes.set(img, (hd = scale2x(img)));
    if (a.length === 2) return draw(hd, a[0], a[1], img.width, img.height);
    if (a.length === 4) return draw(hd, ...a);
    const [sx, sy, sw, sh, dx, dy, dw, dh] = a;
    return draw(hd, sx * 2, sy * 2, sw * 2, sh * 2, dx, dy, dw, dh);
  }) as typeof g.drawImage;
}

/** Wie viele echte Pixel ein Spielpixel auf diesem Kontext hat. */
function density(g: CanvasRenderingContext2D): number {
  return g.getTransform().a || 1;
}

/**
 * Erzeugt ein Sprite aus Zeilen mit '.' (leer) und Farbzeichen.
 * Einfarbig: '#' wird in `colors` gezeichnet. Mehrfarbig: `colors` ordnet Zeichen Farben zu.
 */
export function makeSprite(rows: string[], colors: string | Record<string, string>): Sprite {
  const c = document.createElement('canvas');
  c.width = rows[0].length;
  c.height = rows.length;
  const g = c.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = typeof colors === 'string' ? (row[x] === '#' ? colors : undefined) : colors[row[x]];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  });
  return pixelArtCanvas(c);
}

/** Pixelgenaue Linie (Bresenham), vorher auf die Canvas-Fläche zugeschnitten. */
export function line(
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
): void {
  // Gerechnet wird im feinen Raster: Diagonalen bekommen kleinere Stufen, die Linie bleibt 1 Spielpixel breit
  const k = density(g);
  x0 *= k;
  y0 *= k;
  x1 *= k;
  y1 *= k;
  const maxX = g.canvas.width - 1;
  const maxY = g.canvas.height - 1;
  const code = (x: number, y: number) => (x < 0 ? 1 : x > maxX ? 2 : 0) | (y < 0 ? 4 : y > maxY ? 8 : 0);
  let c0 = code(x0, y0);
  let c1 = code(x1, y1);
  // Cohen-Sutherland-Clipping
  while (c0 | c1) {
    if (c0 & c1) return;
    const c = c0 || c1;
    let x: number;
    let y: number;
    if (c & 8) {
      x = x0 + ((x1 - x0) * (maxY - y0)) / (y1 - y0);
      y = maxY;
    } else if (c & 4) {
      x = x0 + ((x1 - x0) * -y0) / (y1 - y0);
      y = 0;
    } else if (c & 2) {
      y = y0 + ((y1 - y0) * (maxX - x0)) / (x1 - x0);
      x = maxX;
    } else {
      y = y0 + ((y1 - y0) * -x0) / (x1 - x0);
      x = 0;
    }
    if (c === c0) {
      x0 = x;
      y0 = y;
      c0 = code(x0, y0);
    } else {
      x1 = x;
      y1 = y;
      c1 = code(x1, y1);
    }
  }

  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  g.fillStyle = color;
  for (;;) {
    g.fillRect(x / k, y / k, 1, 1);
    if (x === xe && y === ye) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Pixelgenauer gefüllter Kreis (ohne Kantenglättung). */
export function fillCircle(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  g.fillStyle = color;
  const k = density(g);
  if (k !== 1) {
    // Im feinen Raster runder; Mittelpunkt ist die Mitte des Spielpixels (cx, cy)
    const R = (r + 0.5) * k;
    const mx = (cx + 0.5) * k;
    const my = (cy + 0.5) * k;
    for (let y = Math.floor(my - R); y < my + R; y++) {
      const dy = y + 0.5 - my;
      if (Math.abs(dy) >= R) continue;
      const half = Math.sqrt(R * R - dy * dy);
      const x0 = Math.round(mx - half);
      const x1 = Math.round(mx + half);
      if (x1 > x0) g.fillRect(x0 / k, y / k, (x1 - x0) / k, 1 / k);
    }
    return;
  }
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy) + 0.5);
    g.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
}

/** 1 Pixel breiter Rahmen. */
export function strokeRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x, y, 1, h);
  g.fillRect(x + w - 1, y, 1, h);
}
