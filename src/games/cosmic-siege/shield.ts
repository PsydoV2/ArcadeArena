export const SHIELD_W = 24;
export const SHIELD_H = 16;

/** Deckungsblock als Pixelmaske, die nach und nach zerschossen wird. */
export class Shield {
  private mask = new Uint8Array(SHIELD_W * SHIELD_H);
  private canvas = document.createElement('canvas');
  private dirty = true;
  private rgb: [number, number, number];

  constructor(readonly x: number, readonly y: number, color: string) {
    const n = parseInt(color.slice(1), 16);
    this.rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    this.canvas.width = SHIELD_W;
    this.canvas.height = SHIELD_H;
    for (let y = 0; y < SHIELD_H; y++) {
      for (let x = 0; x < SHIELD_W; x++) {
        const corner = y < 4 && (x < 4 - y || x > SHIELD_W - 1 - (4 - y));
        const arch = (y >= 11 && x >= 7 && x <= 16) || (y === 10 && x >= 8 && x <= 15);
        this.mask[y * SHIELD_W + x] = corner || arch ? 0 : 1;
      }
    }
  }

  /** Trifft ein Geschoss an diesem Pixel? Dann wird ein Loch gesprengt. */
  hit(px: number, py: number): boolean {
    const lx = Math.round(px - this.x);
    const ly = Math.round(py - this.y);
    if (lx < 0 || ly < 0 || lx >= SHIELD_W || ly >= SHIELD_H || !this.mask[ly * SHIELD_W + lx]) return false;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy <= 4 + Math.random() * 6) this.clear(lx + dx, ly + dy);
      }
    }
    return true;
  }

  /** Aliens, die durch die Deckung marschieren, fressen sie weg. */
  erase(rx: number, ry: number, rw: number, rh: number): void {
    const x0 = Math.max(0, Math.floor(rx - this.x));
    const y0 = Math.max(0, Math.floor(ry - this.y));
    const x1 = Math.min(SHIELD_W, Math.ceil(rx + rw - this.x));
    const y1 = Math.min(SHIELD_H, Math.ceil(ry + rh - this.y));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.clear(x, y);
  }

  render(g: CanvasRenderingContext2D): void {
    if (this.dirty) {
      const img = new ImageData(SHIELD_W, SHIELD_H);
      for (let i = 0; i < this.mask.length; i++) {
        if (!this.mask[i]) continue;
        img.data.set([...this.rgb, 255], i * 4);
      }
      this.canvas.getContext('2d')!.putImageData(img, 0, 0);
      this.dirty = false;
    }
    g.drawImage(this.canvas, this.x, this.y);
  }

  private clear(x: number, y: number) {
    if (x < 0 || y < 0 || x >= SHIELD_W || y >= SHIELD_H) return;
    const i = y * SHIELD_W + x;
    if (this.mask[i]) {
      this.mask[i] = 0;
      this.dirty = true;
    }
  }
}
