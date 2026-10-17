import './landing.css';
import { Autopilot } from '../engine/autopilot';
import type { Input } from '../engine/input';
import type { GameDefinition, Round } from '../engine/shell';
import { Sound } from '../engine/sound';
import { cosmicSiegeGame } from '../games/cosmic-siege';
import { mazeMuncherGame } from '../games/maze-muncher';
import { CABINETS } from '../games/registry';
import { starRunGame } from '../games/star-run';
import { Hall } from '../hall/hall';

/**
 * Live-Vorschauen auf der Landingpage: die echte Halle und echte Spielrunden im Demo-Modus.
 * Laufen nur, solange sie sichtbar sind; bei "Bewegung reduzieren" bleibt ein Standbild.
 */

const STEP = 1 / 60;
const DEMO_LENGTH = 45;
const SILENT = new Sound();
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Preview {
  update(dt: number): void;
  render(): void;
  visible: boolean;
}

/** Eingabe, die nie etwas drückt – die Halle auf der Landingpage reagiert nicht auf Tasten. */
const idleInput = {
  held: () => false,
  pressed: () => false,
  keyPressed: () => false,
  padPressed: () => false,
  takePadNotice: () => null,
  padActive: false,
  typed: [],
  mouse: { x: -1, y: -1, moved: false, clicked: false },
} as unknown as Input;

function hallPreview(canvas: HTMLCanvasElement): Preview {
  const g = canvas.getContext('2d')!;
  const hall = new Hall(CABINETS, { g, input: idleInput, sound: SILENT }, () => {});
  return { update: (dt) => hall.update(dt), render: () => hall.render(), visible: false };
}

function gamePreview(canvas: HTMLCanvasElement, def: GameDefinition): Preview {
  const g = canvas.getContext('2d')!;
  let round: Round;
  let pilot: Autopilot;
  let t = 0;
  const restart = () => {
    pilot = new Autopilot(def.info.controls);
    round = def.createRound({ input: pilot, audio: SILENT, hiScore: 5000 });
    t = 0;
  };
  restart();
  return {
    update(dt) {
      t += dt;
      pilot.tick(dt);
      round.update(dt);
      if (round.over || t > DEMO_LENGTH) restart();
    },
    render: () => round.render(g),
    visible: false,
  };
}

const GAMES: Record<string, GameDefinition> = {
  'cosmic-siege': cosmicSiegeGame,
  'maze-muncher': mazeMuncherGame,
  'star-run': starRunGame,
};

const previews: Preview[] = [];
const observer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const p = (e.target as HTMLCanvasElement & { preview?: Preview }).preview;
    if (p) p.visible = e.isIntersecting;
  }
});

for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-preview]')) {
  const kind = canvas.dataset.preview!;
  const preview = kind === 'hall' ? hallPreview(canvas) : gamePreview(canvas, GAMES[kind]);
  canvas.getContext('2d')!.imageSmoothingEnabled = false;
  (canvas as HTMLCanvasElement & { preview?: Preview }).preview = preview;
  previews.push(preview);

  if (reduceMotion) {
    // Ein paar Sekunden vorspulen, damit das Standbild nach Spiel aussieht
    for (let i = 0; i < 60 * 6; i++) preview.update(STEP);
    preview.render();
  } else {
    observer.observe(canvas);
  }
}

if (!reduceMotion) {
  let last = performance.now();
  let acc = 0;
  const frame = (now: number) => {
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    const active = previews.filter((p) => p.visible);
    while (acc >= STEP) {
      for (const p of active) p.update(STEP);
      acc -= STEP;
    }
    for (const p of active) p.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
