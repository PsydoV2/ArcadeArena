import type { Action, Controls } from './input';
import type { ControlHint } from './types';

type Axes = 'h' | 'hv' | '4way';

/**
 * Einfacher "Demo-Spieler" für den Attract-Mode: wechselt in zufälligen Abständen
 * die Richtung und hält Feuer gedrückt. Leitet sein Verhalten aus der Tastenbelegung ab.
 */
export class Autopilot implements Controls {
  private dirs = new Set<Action>();
  private hits = new Set<Action>();
  private t = 0;
  private axes: Axes;
  private fire: boolean;

  constructor(controls: ControlHint[]) {
    const stick = controls.find((c) => c.type === 'stick')?.keys ?? '';
    this.fire = controls.some((c) => c.type === 'button' && c.keys === 'SPACE');
    this.axes = !stick.includes('↑') ? 'h' : this.fire ? 'hv' : '4way';
  }

  tick(dt: number): void {
    this.hits.clear();
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.4 + Math.random();
    this.dirs.clear();
    const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

    if (this.axes === '4way') {
      this.dirs.add(pick<Action>(['up', 'down', 'left', 'right']));
    } else {
      const h = pick<Action | null>(['left', 'right', null]);
      if (h) this.dirs.add(h);
      if (this.axes === 'hv') {
        const v = pick<Action | null>(['up', 'down', null, null]);
        if (v) this.dirs.add(v);
      }
    }
    for (const d of this.dirs) this.hits.add(d);
  }

  held(a: Action): boolean {
    if (a === 'a') return this.fire;
    return this.dirs.has(a);
  }

  pressed(a: Action): boolean {
    return this.hits.has(a);
  }
}
