import type { CabinetInfo } from '../engine/types';
import { brickBlaster } from './brick-blaster';
import { cityDefender } from './city-defender';
import { cosmicSiege } from './cosmic-siege';
import { gemCascade } from './gem-cascade';
import { mazeMuncher } from './maze-muncher';
import { neonSerpent } from './neon-serpent';
import { paddleDuel } from './paddle-duel';
import { roadHopper } from './road-hopper';
import { rockBuster } from './rock-buster';
import { starRun } from './star-run';

/** Reihenfolge der Automaten in der Halle. Neue Spiele hier eintragen. */
export const CABINETS: CabinetInfo[] = [cosmicSiege, mazeMuncher, starRun, brickBlaster, neonSerpent, rockBuster, paddleDuel, roadHopper, cityDefender, gemCascade];
