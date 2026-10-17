export type Action = 'left' | 'right' | 'up' | 'down' | 'a' | 'b' | 'start' | 'back';

/** Einheitliche Belegung für alle Spiele: Pfeile/WASD + 2 Aktionstasten. */
const BINDINGS: Record<Action, string[]> = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  a: ['Space'],
  b: ['ShiftLeft', 'ShiftRight'],
  start: ['Enter', 'NumpadEnter'],
  back: ['Escape'],
};

const PREVENT_DEFAULT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Tab']);

export class Input {
  private down = new Set<string>();
  private hit = new Set<string>();
  /** Seit dem letzten Tick getippte Zeichen (Großbuchstaben). */
  typed: string[] = [];
  mouse = { x: 0, y: 0, moved: false, clicked: false };
  /** Wird bei jeder Nutzergeste aufgerufen (nötig, um WebAudio freizuschalten). */
  onGesture?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.hit.add(e.code);
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) this.typed.push(e.key.toUpperCase());
      }
      this.down.add(e.code);
      this.onGesture?.();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());

    const toScreen = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) * canvas.width) / r.width;
      this.mouse.y = ((e.clientY - r.top) * canvas.height) / r.height;
    };
    canvas.addEventListener('mousemove', (e) => {
      toScreen(e);
      this.mouse.moved = true;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      toScreen(e);
      this.mouse.clicked = true;
      this.onGesture?.();
    });
  }

  /** Taste gehalten. */
  held(a: Action): boolean {
    return BINDINGS[a].some((c) => this.down.has(c));
  }

  /** Taste in diesem Tick neu gedrückt. */
  pressed(a: Action): boolean {
    return BINDINGS[a].some((c) => this.hit.has(c));
  }

  /** Bestimmte physische Taste in diesem Tick gedrückt (KeyboardEvent.code). */
  keyPressed(code: string): boolean {
    return this.hit.has(code);
  }

  /** Nach jedem Update-Tick aufrufen. */
  endTick(): void {
    this.hit.clear();
    this.typed.length = 0;
    this.mouse.moved = false;
    this.mouse.clicked = false;
  }
}
