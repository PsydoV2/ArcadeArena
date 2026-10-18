import { Autopilot } from '../../src/engine/autopilot';
import type { GameDefinition } from '../../src/engine/shell';
import { Sound } from '../../src/engine/sound';
import { SCREEN_H, SCREEN_W } from '../../src/engine/types';
import { brickBlasterGame } from '../../src/games/brick-blaster';
import { cityDefenderGame } from '../../src/games/city-defender';
import { cosmicSiegeGame } from '../../src/games/cosmic-siege';
import { gardenGuardGame } from '../../src/games/garden-guard';
import { gemCascadeGame } from '../../src/games/gem-cascade';
import { mazeMuncherGame } from '../../src/games/maze-muncher';
import { moonLanderGame } from '../../src/games/moon-lander';
import { neonSerpentGame } from '../../src/games/neon-serpent';
import { paddleDuelGame } from '../../src/games/paddle-duel';
import { roadHopperGame } from '../../src/games/road-hopper';
import { rockBusterGame } from '../../src/games/rock-buster';
import { starRunGame } from '../../src/games/star-run';
// more-imports

/**
 * Spielt jedes Spiel ein paar Sekunden im Demo-Modus vor und legt ein Bild als WebP-Daten-URL ab.
 * Sekunden pro Spiel so gewählt, dass gerade etwas los ist.
 */

const STEP = 1 / 60;
const SCALE = 2;
const SILENT = new Sound();

const GAMES: [string, GameDefinition, number][] = [
  ['cosmic-siege', cosmicSiegeGame, 9],
  ['star-run', starRunGame, 8],
  ['rock-buster', rockBusterGame, 6],
  ['city-defender', cityDefenderGame, 5],
  ['garden-guard', gardenGuardGame, 7],
  ['moon-lander', moonLanderGame, 6],
  ['maze-muncher', mazeMuncherGame, 9],
  ['neon-serpent', neonSerpentGame, 3],
  ['road-hopper', roadHopperGame, 7],
  ['brick-blaster', brickBlasterGame, 8],
  ['gem-cascade', gemCascadeGame, 45],
  ['paddle-duel', paddleDuelGame, 6],
  // more-shots
];

const src = document.createElement('canvas');
src.width = SCREEN_W;
src.height = SCREEN_H;
const g = src.getContext('2d')!;
const big = document.createElement('canvas');
big.width = SCREEN_W * SCALE;
big.height = SCREEN_H * SCALE;
const bg = big.getContext('2d')!;
bg.imageSmoothingEnabled = false;

/** Fester Zufall (mulberry32), damit dieselben Sekunden immer dasselbe Bild ergeben. */
function seed(n: number) {
  Math.random = () => {
    n = (n + 0x6d2b79f5) | 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const out: Record<string, string> = {};
// Kontaktbogen aller Bilder (4 × 3) zur schnellen Kontrolle
const sheet = document.createElement('canvas');
sheet.width = SCREEN_W * 4;
sheet.height = SCREEN_H * 3;
const sg = sheet.getContext('2d')!;
let n = 0;
for (const [id, def, seconds] of GAMES) {
  seed(7);
  const pilot = new Autopilot(def.info.controls);
  const round = def.createRound({ input: pilot, audio: SILENT, hiScore: 0 });
  for (let i = 0; i < seconds * 60 && !round.over; i++) {
    pilot.tick(STEP);
    round.update(STEP);
  }
  g.fillStyle = '#000';
  g.fillRect(0, 0, SCREEN_W, SCREEN_H);
  round.render(g);
  bg.drawImage(src, 0, 0, big.width, big.height);
  out[id] = big.toDataURL('image/webp', 0.9);
  sg.drawImage(src, (n % 4) * SCREEN_W, Math.floor(n / 4) * SCREEN_H);
  n++;
}
out.sheet = sheet.toDataURL('image/png');
document.getElementById('out')!.textContent = JSON.stringify(out);
