import type { CabinetInfo } from '../engine/types';
import { brickBlaster } from './brick-blaster';
import { cityDefender } from './city-defender';
import { cosmicSiege } from './cosmic-siege';
import { gardenGuard } from './garden-guard';
import { gemCascade } from './gem-cascade';
import { mazeMuncher } from './maze-muncher';
import { moonLander } from './moon-lander';
import { neonSerpent } from './neon-serpent';
import { paddleDuel } from './paddle-duel';
import { roadHopper } from './road-hopper';
import { rockBuster } from './rock-buster';
import { starRun } from './star-run';

/**
 * Aufstellung in der Halle: je 6 Automaten pro Reihe.
 * Obere Reihe an der Wand: Shooter. Mittlere Reihe: Labyrinth, Geschick und Puzzle.
 */
export const CABINETS: CabinetInfo[] = [
  cosmicSiege,
  starRun,
  rockBuster,
  cityDefender,
  gardenGuard,
  moonLander,
  mazeMuncher,
  neonSerpent,
  roadHopper,
  brickBlaster,
  gemCascade,
  paddleDuel,
];
