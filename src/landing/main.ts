import './landing.css';
import { Autopilot } from '../engine/autopilot';
import { RES, useHiRes } from '../engine/draw';
import { SCREEN_H, SCREEN_W } from '../engine/types';
import type { Input } from '../engine/input';
import type { GameDefinition, Round } from '../engine/shell';
import { Sound } from '../engine/sound';
import { registerServiceWorker } from '../engine/pwa';
import { initConsentBanner } from '../engine/consent';
import { cosmicSiegeGame } from '../games/cosmic-siege';
import { mazeMuncherGame } from '../games/maze-muncher';
import { CABINETS } from '../games/registry';
import { starRunGame } from '../games/star-run';
import { brickBlasterGame } from '../games/brick-blaster';
import { neonSerpentGame } from '../games/neon-serpent';
import { rockBusterGame } from '../games/rock-buster';
import { paddleDuelGame } from '../games/paddle-duel';
import { roadHopperGame } from '../games/road-hopper';
import { cityDefenderGame } from '../games/city-defender';
import { gemCascadeGame } from '../games/gem-cascade';
import { moonLanderGame } from '../games/moon-lander';
import { gardenGuardGame } from '../games/garden-guard';
// more-imports
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
  const hall = new Hall(CABINETS, { g, input: idleInput, sound: SILENT }, () => {}, { demo: true });
  return { update: (dt) => hall.update(dt), render: () => hall.render(), visible: false };
}

function gamePreview(canvas: HTMLCanvasElement, def: GameDefinition): Preview {
  const g = canvas.getContext('2d')!;
  let round: Round;
  let pilot: Autopilot;
  let t = 0;
  const restart = () => {
    pilot = new Autopilot(def.info.controls);
    round = def.createRound({ input: pilot, audio: SILENT, hiScore: 0 });
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
  'brick-blaster': brickBlasterGame,
  'neon-serpent': neonSerpentGame,
  'rock-buster': rockBusterGame,
  'paddle-duel': paddleDuelGame,
  'road-hopper': roadHopperGame,
  'city-defender': cityDefenderGame,
  'gem-cascade': gemCascadeGame,
  'moon-lander': moonLanderGame,
  'garden-guard': gardenGuardGame,
  // more-previews
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
  // Wie im Spiel: feines Raster mit RES×RES Pixeln pro Spielpixel
  canvas.width = SCREEN_W * RES;
  canvas.height = SCREEN_H * RES;
  useHiRes(canvas.getContext('2d')!);
  const preview = kind === 'hall' ? hallPreview(canvas) : gamePreview(canvas, GAMES[kind]);
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

registerServiceWorker();
initConsentBanner(
  document.querySelector<HTMLElement>('[data-consent-banner]')!,
  document.querySelectorAll<HTMLElement>('[data-consent-open]'),
);
