import { SCREEN_H, SCREEN_W } from './types';

export type Action ='left' | 'right' | 'up' | 'down' | 'a' | 'b' | 'start' | 'back';

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

/**
 * Gamepad-Belegung nach dem Standard-Layout (Xbox/PlayStation/Switch Pro):
 * Steuerkreuz oder linker Stick, A/X = Aktion 1, B/Y = Aktion 2, Start, Select/Back = Esc.
 */
const PAD_BUTTONS: Partial<Record<number, Action>> = {
  0: 'a',
  1: 'b',
  2: 'a',
  3: 'b',
  8: 'back',
  9: 'start',
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right',
};
const STICK_DEADZONE = 0.5;

const PREVENT_DEFAULT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Tab']);

/** Was eine Spielrunde von der Steuerung braucht – Tastatur, Gamepad oder Autopilot im Demo-Modus. */
export interface Controls {
  held(a: Action): boolean;
  pressed(a: Action): boolean;
}

export class Input implements Controls {
  private down = new Set<string>();
  private hit = new Set<string>();
  private padDown = new Set<Action>();
  private padHit = new Set<Action>();
  private padNotice: string | null = null;
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
    window.addEventListener('gamepadconnected', () => (this.padNotice = 'GAMEPAD CONNECTED'));
    window.addEventListener('gamepaddisconnected', () => (this.padNotice = 'GAMEPAD DISCONNECTED'));

    const toScreen = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) * SCREEN_W) / r.width;
      this.mouse.y = ((e.clientY - r.top) * SCREEN_H) / r.height;
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

  /** Gamepads abfragen – vor jedem Update-Tick aufrufen (die Gamepad-API kennt keine Events für Tasten). */
  pollPads(): void {
    const now = new Set<Action>();
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad?.connected) continue;
      pad.buttons.forEach((b, i) => {
        const action = PAD_BUTTONS[i];
        if (action && b.pressed) now.add(action);
      });
      const [x = 0, y = 0] = pad.axes;
      if (x < -STICK_DEADZONE) now.add('left');
      if (x > STICK_DEADZONE) now.add('right');
      if (y < -STICK_DEADZONE) now.add('up');
      if (y > STICK_DEADZONE) now.add('down');
    }
    this.padHit.clear();
    for (const a of now) if (!this.padDown.has(a)) this.padHit.add(a);
    this.padDown = now;
    if (this.padHit.size) this.onGesture?.();
  }

  /** Taste gehalten (Tastatur oder Gamepad). */
  held(a: Action): boolean {
    return this.padDown.has(a) || BINDINGS[a].some((c) => this.down.has(c));
  }

  /** Taste in diesem Tick neu gedrückt (Tastatur oder Gamepad). */
  pressed(a: Action): boolean {
    return this.padHit.has(a) || BINDINGS[a].some((c) => this.hit.has(c));
  }

  /** Ist mindestens ein Gamepad angeschlossen? (für passende Hinweistexte) */
  get padActive(): boolean {
    return (navigator.getGamepads?.() ?? []).some((p) => p?.connected);
  }

  /** Nur Gamepad: in diesem Tick neu gedrückt. */
  padPressed(a: Action): boolean {
    return this.padHit.has(a);
  }

  /** Bestimmte physische Taste in diesem Tick gedrückt (KeyboardEvent.code). */
  keyPressed(code: string): boolean {
    return this.hit.has(code);
  }

  /** Meldung über an- oder abgesteckte Gamepads (einmalig abholen). */
  takePadNotice(): string | null {
    const n = this.padNotice;
    this.padNotice = null;
    return n;
  }

  /** Nach jedem Update-Tick aufrufen. */
  endTick(): void {
    this.hit.clear();
    this.padHit.clear();
    this.typed.length = 0;
    this.mouse.moved = false;
    this.mouse.clicked = false;
  }
}
