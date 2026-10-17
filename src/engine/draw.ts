export type Sprite = HTMLCanvasElement;

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
  return c;
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
    g.fillRect(x, y, 1, 1);
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
